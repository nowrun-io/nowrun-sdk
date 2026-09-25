package gg.now.bridge;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.Application;
import android.app.Service;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.RemoteException;
import android.util.Log;

import gg.now.bridge.aidl.IClientService;
import gg.now.bridge.aidl.IProviderService;

import org.json.JSONException;
import org.json.JSONObject;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import java.lang.reflect.Method;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Bridge to the client app. Add the SDK as a dependency and call, once, from your
 * Activity or Application:
 *
 *   ProviderService.start(this, new MyFunctions());
 *
 * The service and the <queries> entry the bind needs are declared in this library's
 * manifest and merged into your app, so there is nothing to add to your own.
 *
 * Every public method of that object becomes callable by the client. Report state
 * with ProviderService.notifyStateChange("{...}") whenever your app changes.
 *
 * Annotate a method with @Describe("...") to add a "functionDescription" to its entry in the
 * contract, or a parameter to add a plain "description" to its own - purely documentation for
 * whoever picks a call to make, an LLM most often; nothing here reads it back.
 *
 * Minifying apps: the functions object is reached only by reflection, so R8 needs a
 * keep rule for it. See consumer-rules.pro.
 *
 * Calls do not block the client: invoke() only reports whether the call was accepted,
 * then the function runs on a worker thread and its result is sent back separately.
 * Calls run concurrently, so a slow function does not delay others - which means the
 * object you expose must be safe to call from several threads at once.
 *
 * Connecting is resilient: if the client app is missing it retries once a second up to ten
 * times, connects the moment the client is installed, and state reported while
 * disconnected is delivered once it is. Nothing here is app specific.
 */
public class ProviderService extends Service {

    private static final String TAG = "ProviderService";

    private static final String CLIENT_PACKAGE = "gg.now.player";
    private static final String CLIENT_SERVICE = "gg.now.player.bridge.ClientService";

    private static final long BIND_RETRY_MS = 1000L;
    private static final int MAX_BIND_RETRIES = 10;

    /** Switching between two activities of the same app must not look like leaving it. */
    private static final long BACKGROUND_GRACE_MS = 500L;

    /**
     * Set to run calls yourself instead of letting the SDK invoke methods on the target.
     *
     * Reflection can only reach compiled Java methods. An app whose functions live
     * somewhere else - a JavaScript runtime, a script, a table loaded at startup - sets a
     * runner and a contract, and is otherwise treated exactly like any other app.
     */
    public interface FunctionRunner {

        /**
         * Starts one call and returns at once. argsJson is a JSON object already keyed by
         * the contract's own argument names and converted to its declared types.
         *
         * Return false if the call cannot be started; the client hears that as a failure.
         * Otherwise the answer goes back later through sendResult(), the same route a
         * reflected function's return value takes. Nothing waits for it, so a call may take
         * as long as it needs.
         */
        boolean startCall(String requestId, String function, String argsJson);
    }

    /**
     * Documents one reflected method or parameter for whoever is choosing a call - usually
     * an LLM reading the contract, not a person typing it in.
     *
     * Optional: a method or parameter carrying none simply gets no "functionDescription" or
     * "description" field in the contract. A method's own name/description are keyed
     * "functionName"/"functionDescription"; a parameter's stay plain "name"/"description" -
     * the two levels are deliberately not the same keys. A declared contract (FunctionRunner
     * path) puts those same keys straight in its own JSON instead.
     */
    @Retention(RetentionPolicy.RUNTIME)
    @Target({ElementType.METHOD, ElementType.PARAMETER})
    public @interface Describe {
        String value();
    }

    /**
     * The classes an interface or abstract class may be sent as. Only needed for ones declared
     * elsewhere: a subclass nested inside the type itself - a Kotlin sealed class's, say - is
     * found without it. Each is listed in the contract with its fields.
     *
     *   @Subtypes({Circle.class, Square.class})
     *   public abstract class Shape { ... }
     */
    @Retention(RetentionPolicy.RUNTIME)
    @Target(ElementType.TYPE)
    public @interface Subtypes {
        Class<?>[] value();
    }

    /** What the client may call: a declared contract and its runner, or a reflected object. */
    private static volatile FunctionRunner declaredRunner;
    private static volatile String declaredContract;
    private static volatile Object reflectedTarget;

    private static volatile ProviderService instance;
    /** State reported while disconnected, delivered on the next registration. */
    private static volatile String pendingState;

    /** Registration follows the foreground: the user's current app is the connected one. */
    private static final Handler MAIN_HANDLER = new Handler(Looper.getMainLooper());
    private static volatile boolean foreground;
    /** The activity in front right now, or null. Tracked directly: a counter can drift. */
    private static volatile Activity resumedActivity;
    private static boolean watchingForeground;

    /** Leaving the foreground is confirmed after a beat, so activity swaps do not flap. */
    private static final Runnable CONFIRM_BACKGROUND = new Runnable() {
        @Override
        public void run() {
            if (resumedActivity != null || !foreground) {
                return;
            }
            foreground = false;
            ProviderService service = instance;
            if (service != null) {
                // Dropping the binding is the signal: the client sees its last
                // provider let go and shows nothing connected.
                service.unbindClient();
            }
        }
    };

    /**
     * Functions run here so invoke() can return without waiting. A pool, not a single
     * thread: a slow call must not hold up the quick ones behind it. Threads are retired
     * when idle, so an app that is never called keeps none.
     *
     * Bounded on purpose. A client can ask for as many calls as it likes, and each one a
     * reflected function holds a thread for as long as it runs; without a ceiling a runaway
     * caller would make threads until the process died. Past the ceiling calls queue, and
     * past the queue they are refused - which invoke() reports, rather than dropping them.
     *
     * This is why an exposed object must be safe to call from several threads at once.
     */
    private static final int MAX_CONCURRENT_CALLS = 8;
    private static final int MAX_QUEUED_CALLS = 32;
    private static final ExecutorService CALL_EXECUTOR = newCallExecutor();

    private IClientService client;
    private boolean boundToClient;
    private int bindRetriesLeft = MAX_BIND_RETRIES;

    // ---- Public API -------------------------------------------------------------------------

    /**
     * For an app whose functions are not compiled Java methods - a JavaScript runtime, a
     * script, a table loaded at startup. contractJson is the list reflection would have
     * produced, and runner is how one of them is started:
     * {"functions":[{"functionName":"greet","args":[{"name":"who","type":"String"}],"returns":"String"}]}
     *
     * Argument types may be String (the default), boolean, int, long, short, byte, float,
     * double, number, JSONObject, JSONArray, or any of those followed by []. Any other name is
     * a type of the app's own, described by the "fields" and "values" it declares - see
     * ArgumentReader.toDeclaredValue(). Calling this again republishes, which is how a changed
     * surface reaches a connected client.
     */
    public static void start(Context context, String contractJson, FunctionRunner runner) {
        declaredContract = (contractJson == null || contractJson.trim().isEmpty()) ? null : contractJson;
        declaredRunner = runner;
        start(context, (Object) null);
    }

    /**
     * Exposes a plain object: its public methods are the functions, read by reflection.
     *
     * Safe to call whenever the runtime is ready, not only from onCreate(): where the
     * process stands is asked of the system rather than inferred from a resume that may
     * already have happened.
     */
    public static void start(Context context, Object target) {
        reflectedTarget = target;
        watchForegroundChanges(context);

        ProviderService running = instance;
        if (running != null && running.client != null) {
            running.registerWithClient();
            return;
        }
        context.startService(new Intent(context.getApplicationContext(), ProviderService.class));
    }

    public static void notifyStateChange(String stateJson) {
        ProviderService service = instance;
        if (service == null || service.client == null) {
            pendingState = stateJson;
            return;
        }
        service.sendStateToClient(stateJson);
    }

    /**
     * Hands the client the answer to an earlier invoke(). For a FunctionRunner, which starts a
     * call and returns before it finishes: whatever runs the function calls this when it has
     * an answer, quoting the requestId it was given.
     */
    public static void sendResult(String requestId, String result) {
        ProviderService service = instance;
        if (service == null) {
            Log.w(TAG, "not running, dropping result for " + requestId);
            return;
        }
        service.sendResultToClient(requestId, result);
    }

    // ---- Service lifecycle ------------------------------------------------------------------

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        bindClient();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        bindRetriesLeft = MAX_BIND_RETRIES;
        bindClient();
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        instance = null;
        MAIN_HANDLER.removeCallbacks(bindRetry);
        unbindClient();
    }

    // ---- Foreground tracking ----------------------------------------------------------------

    /**
     * Whether this process is in front of the user right now. Reported by the system, so it
     * is right however late the bridge is started. A process that is foreground for another
     * reason - a foreground service, with nothing on screen - reads as in front until the
     * next pause corrects it, which costs one binding rather than a stuck one.
     */
    private static boolean isProcessInForeground() {
        ActivityManager.RunningAppProcessInfo processState = new ActivityManager.RunningAppProcessInfo();
        ActivityManager.getMyMemoryState(processState);
        return processState.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND;
    }

    private static void watchForegroundChanges(Context context) {
        if (watchingForeground) {
            return;
        }
        Context applicationContext = context.getApplicationContext();
        if (!(applicationContext instanceof Application)) {
            return;
        }
        watchingForeground = true;

        // The callbacks below only report transitions from here on, and the bridge may be
        // started after the activity has already resumed - a React Native app builds its
        // runtime asynchronously, so by then the only resume there was going to be has been
        // and gone. Ask the system where this process stands rather than waiting for one.
        foreground = isProcessInForeground();

        ((Application) applicationContext).registerActivityLifecycleCallbacks(
                new Application.ActivityLifecycleCallbacks() {
            @Override
            public void onActivityResumed(Activity activity) {
                resumedActivity = activity;
                MAIN_HANDLER.removeCallbacks(CONFIRM_BACKGROUND);
                foreground = true;

                ProviderService service = instance;
                if (service == null) {
                    // Not running, or killed while this app was in the background.
                    Context appContext = activity.getApplicationContext();
                    appContext.startService(new Intent(appContext, ProviderService.class));
                    return;
                }
                // Every resume claims the client, so the app in front is the connected one.
                service.bindClient();
                service.registerWithClient();
            }

            @Override
            public void onActivityPaused(Activity activity) {
                if (resumedActivity == activity) {
                    resumedActivity = null;
                }
                MAIN_HANDLER.postDelayed(CONFIRM_BACKGROUND, BACKGROUND_GRACE_MS);
            }

            @Override
            public void onActivityDestroyed(Activity activity) {
                if (resumedActivity == activity) {
                    resumedActivity = null;
                }
            }

            @Override
            public void onActivityCreated(Activity activity, Bundle state) {
            }

            @Override
            public void onActivityStarted(Activity activity) {
            }

            @Override
            public void onActivityStopped(Activity activity) {
            }

            @Override
            public void onActivitySaveInstanceState(Activity activity, Bundle state) {
            }
        });
    }

    // ---- Client connection ------------------------------------------------------------------

    private final ServiceConnection clientConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            client = IClientService.Stub.asInterface(service);
            bindRetriesLeft = MAX_BIND_RETRIES;
            registerWithClient();
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            client = null;
        }

        @Override
        public void onBindingDied(ComponentName name) {
            unbindClient();
            bindClient();
        }

        @Override
        public void onNullBinding(ComponentName name) {
            unbindClient();
            scheduleBindRetry();
        }
    };

    private final Runnable bindRetry = new Runnable() {
        @Override
        public void run() {
            bindClient();
        }
    };

    private void bindClient() {
        if (boundToClient || !foreground) {
            // Only the app in front of the user binds the client.
            return;
        }
        Intent toClient = new Intent().setComponent(new ComponentName(CLIENT_PACKAGE, CLIENT_SERVICE));
        try {
            boundToClient = bindService(toClient, clientConnection, BIND_AUTO_CREATE);
        } catch (SecurityException e) {
            boundToClient = false;
        }
        if (!boundToClient) {
            unbindClient();
            scheduleBindRetry();
        }
    }

    private void unbindClient() {
        client = null;
        try {
            unbindService(clientConnection);
        } catch (IllegalArgumentException ignored) {
            // Was never bound.
        }
        boundToClient = false;
    }

    private void scheduleBindRetry() {
        if (bindRetriesLeft <= 0) {
            Log.w(TAG, "client app unavailable, gave up after " + MAX_BIND_RETRIES + " attempts");
            return;
        }
        bindRetriesLeft--;
        Log.w(TAG, "client app unavailable, retrying in " + BIND_RETRY_MS + "ms ("
                + bindRetriesLeft + " attempts left)");
        MAIN_HANDLER.removeCallbacks(bindRetry);
        MAIN_HANDLER.postDelayed(bindRetry, BIND_RETRY_MS);
    }

    private void registerWithClient() {
        IClientService connected = client;
        if (connected == null || !foreground) {
            // Only the app the user is actually looking at claims the client.
            return;
        }
        try {
            connected.registerFunctions(getPackageName(), currentContract(), binder);
        } catch (RemoteException e) {
            Log.w(TAG, "registerFunctions failed", e);
            return;
        }
        String state = pendingState;
        if (state != null) {
            sendStateToClient(state);
        }
    }

    private void sendStateToClient(String stateJson) {
        try {
            Log.i(TAG, "sending state change: " + stateJson);
            client.onStateChange(getPackageName(), stateJson);
            pendingState = null;
        } catch (RemoteException e) {
            Log.w(TAG, "onStateChange failed, holding it until reconnect", e);
            pendingState = stateJson;
        }
    }

    private void sendResultToClient(String requestId, String result) {
        IClientService connected = client;
        if (connected == null) {
            Log.w(TAG, "not connected, dropping result for " + requestId);
            return;
        }
        try {
            connected.sendResult(getPackageName(), requestId, result);
        } catch (RemoteException e) {
            Log.w(TAG, "sendResult failed for " + requestId, e);
        }
    }

    // ---- Calls ------------------------------------------------------------------------------

    private final IProviderService.Stub binder = new IProviderService.Stub() {

        @Override
        public String getFunctions() {
            return currentContract();
        }

        @Override
        public boolean invoke(final String requestId, final String function, Bundle args) {
            if (!isFunctionExposed(function)) {
                Log.w(TAG, "rejected " + requestId + ": no function " + function);
                return false;
            }

            // The caller's Bundle is only valid for the length of this transaction.
            final Bundle ownedArgs = detachArguments(args);

            // Checked before anything starts, so a bad call is refused rather than run. The
            // reason goes ahead on sendResult() - invoke() can only answer yes or no - and the
            // client, seeing INVALID_ARGUMENTS there, refuses the call as never having happened.
            String problem = argumentProblem(function, ownedArgs);
            if (problem != null) {
                Log.w(TAG, "rejected " + requestId + ": " + problem);
                sendResult(requestId, failure("INVALID_ARGUMENTS", problem));
                return false;
            }

            try {
                CALL_EXECUTOR.execute(new Runnable() {
                    @Override
                    public void run() {
                        Log.i(TAG, "running function: " + function + " (" + requestId + ")");
                        runAcceptedCall(requestId, function, ownedArgs);
                    }
                });
            } catch (RejectedExecutionException e) {
                Log.w(TAG, "refused " + requestId + ": already running "
                        + MAX_CONCURRENT_CALLS + " calls with " + MAX_QUEUED_CALLS + " waiting");
                return false;
            }
            // Accepted and running; the answer follows on sendResult().
            return true;
        }
    };

    private static String currentContract() {
        return declaredContract != null ? Contract.ofDeclared(declaredContract) : Contract.ofTarget(reflectedTarget);
    }

    private static boolean isFunctionExposed(String function) {
        if (declaredContract != null) {
            // Answered honestly rather than waved through: invoke() promises the client a
            // false for a function that does not exist.
            return Contract.functionNames(declaredContract).contains(function);
        }
        Object target = reflectedTarget;
        return target != null && Contract.methodNamed(target, function) != null;
    }

    /**
     * Why these arguments do not suit the function, or null if they do. Read exactly as the
     * call itself will read them, but nothing is run.
     */
    private static String argumentProblem(String function, Bundle args) {
        try {
            if (declaredRunner != null) {
                ArgumentReader.forDeclaredFunction(Contract.argumentsOf(declaredContract, function), args);
            } else if (reflectedTarget != null) {
                Method method = Contract.methodNamed(reflectedTarget, function);
                if (method != null) {
                    ArgumentReader.forMethod(method, args);
                }
            }
            return null;
        } catch (IllegalArgumentException e) {
            return e.getMessage();
        } catch (JSONException e) {
            return "could not read the arguments for " + function;
        }
    }

    /**
     * Runs one accepted call. The only difference between a Java app and one whose
     * functions live elsewhere: a method can be invoked and its return value is the answer,
     * while a runner is handed the call and answers later. Everything either side of this -
     * accepting, naming the arguments, returning the result - is the same for both.
     */
    private static void runAcceptedCall(String requestId, String function, Bundle args) {
        FunctionRunner runner = declaredRunner;
        if (runner == null) {
            sendResult(requestId, invokeReflectedMethod(function, args));
            return;
        }

        String argsJson;
        try {
            argsJson = ArgumentReader.forDeclaredFunction(Contract.argumentsOf(declaredContract, function), args);
        } catch (JSONException e) {
            sendResult(requestId, failure("INVALID_ARGUMENTS", "could not read the arguments for " + function));
            return;
        } catch (IllegalArgumentException e) {
            // A value that arrived but could not be read. Saying so beats passing the call
            // on without it: the runner would see a required argument simply missing.
            sendResult(requestId, failure("INVALID_ARGUMENTS", e.getMessage()));
            return;
        }

        if (!runner.startCall(requestId, function, argsJson)) {
            sendResult(requestId, failure("APP_FUNCTION_FAILED", function + " could not be started"));
        }
        // Otherwise it is running, and the answer arrives on sendResult() later.
    }

    private static String invokeReflectedMethod(String function, Bundle args) {
        Object target = reflectedTarget;
        if (target == null) {
            return failure("UNKNOWN_FUNCTION", "No functions registered");
        }
        Method method = Contract.methodNamed(target, function);
        if (method == null) {
            return failure("UNKNOWN_FUNCTION", "Unknown function: " + function);
        }
        try {
            return String.valueOf(method.invoke(target, ArgumentReader.forMethod(method, args)));
        } catch (IllegalArgumentException e) {
            return failure("INVALID_ARGUMENTS", e.getMessage());
        } catch (ReflectiveOperationException e) {
            Log.w(TAG, function + " failed", e);
            return failure("APP_FUNCTION_FAILED", function + " failed");
        }
    }

    /** A failed call, in the shape the client reads a failure from: a code and why. */
    private static String failure(String code, String message) {
        try {
            return new JSONObject().put("success", false)
                    .put("error", new JSONObject().put("code", code).put("message", message))
                    .toString();
        } catch (JSONException impossible) {
            return "error: " + message;
        }
    }

    /** Detaches the arguments from the transaction's parcel before it is recycled. */
    private static Bundle detachArguments(Bundle args) {
        if (args == null) {
            return new Bundle();
        }
        Bundle copy = new Bundle(args);
        copy.setClassLoader(ProviderService.class.getClassLoader());
        // Force the read now, while the caller's data is still alive.
        copy.size();
        return copy;
    }

    private static ExecutorService newCallExecutor() {
        ThreadPoolExecutor executor = new ThreadPoolExecutor(
                MAX_CONCURRENT_CALLS, MAX_CONCURRENT_CALLS,
                60L, TimeUnit.SECONDS,
                new LinkedBlockingQueue<Runnable>(MAX_QUEUED_CALLS),
                new ThreadFactory() {
                    private final AtomicInteger threadCount = new AtomicInteger();

                    @Override
                    public Thread newThread(Runnable runnable) {
                        Thread thread = new Thread(runnable, "bridge-call-" + threadCount.incrementAndGet());
                        thread.setDaemon(true);
                        return thread;
                    }
                });
        // Nothing is kept alive for an app that is idle.
        executor.allowCoreThreadTimeOut(true);
        return executor;
    }
}
