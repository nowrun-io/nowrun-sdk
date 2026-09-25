package gg.now.bridge;

import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.lang.annotation.Annotation;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.lang.reflect.Type;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static gg.now.bridge.JavaTypes.SUBTYPE_KEY;
import static gg.now.bridge.JavaTypes.componentTypeOf;
import static gg.now.bridge.JavaTypes.dataFieldsOf;
import static gg.now.bridge.JavaTypes.knownSubtypesOf;
import static gg.now.bridge.JavaTypes.nameOf;
import static gg.now.bridge.JavaTypes.rawClassOf;
import static gg.now.bridge.JavaTypes.typeArgument;

/**
 * The contract a provider publishes - the functions a client may call, with their arguments -
 * built by reflection from an exposed object, or taken from the JSON an app declared.
 */
final class Contract {

    private static final String TAG = "ProviderService";

    private static final String EMPTY = "{\"functions\":[]}";

    /** Last declared contract whose names were read, so a call does not re-read unchanged JSON. */
    private static volatile String namedContract;
    private static volatile Set<String> namedFunctions = Collections.emptySet();

    private Contract() {
    }

    /** The contract of an exposed object: one function per public method. Null exposes none. */
    static String ofTarget(Object target) {
        JSONObject contract = new JSONObject();
        try {
            JSONArray functions = new JSONArray();
            if (target != null) {
                for (Method method : publicMethodsOf(target)) {
                    functions.put(describe(method));
                }
            }
            contract.put("functions", functions);
        } catch (JSONException e) {
            Log.w(TAG, "could not describe functions", e);
        }
        Log.d(TAG, "list of functions: " + contract);
        return contract.toString();
    }

    /**
     * A declared contract, checked before it leaves. One that will not parse is reported as
     * no functions at all, rather than reaching the client as something it cannot read.
     */
    static String ofDeclared(String declaredContract) {
        try {
            JSONObject contract = new JSONObject(declaredContract);
            if (!contract.has("functions")) {
                contract.put("functions", new JSONArray());
            }
            return contract.toString();
        } catch (JSONException e) {
            Log.w(TAG, "the declared contract is not usable JSON", e);
            return EMPTY;
        }
    }

    /** The function names a declared contract lists. */
    static Set<String> functionNames(String declaredContract) {
        if (declaredContract == null) {
            return Collections.emptySet();
        }
        if (declaredContract.equals(namedContract)) {
            return namedFunctions;
        }
        Set<String> names = new LinkedHashSet<>();
        try {
            JSONArray functions = new JSONObject(declaredContract).optJSONArray("functions");
            for (int i = 0; functions != null && i < functions.length(); i++) {
                names.add(functions.getJSONObject(i).getString("functionName"));
            }
        } catch (JSONException e) {
            Log.w(TAG, "could not read the self-described contract", e);
        }
        namedContract = declaredContract;
        namedFunctions = names;
        return names;
    }

    /** The declared arguments of one function, or null if it declares none. */
    static JSONArray argumentsOf(String declaredContract, String function) throws JSONException {
        JSONArray functions = new JSONObject(declaredContract == null ? "{}" : declaredContract)
                .optJSONArray("functions");
        for (int i = 0; functions != null && i < functions.length(); i++) {
            JSONObject entry = functions.getJSONObject(i);
            if (function.equals(entry.optString("functionName"))) {
                return entry.optJSONArray("args");
            }
        }
        return null;
    }

    /** The public methods an object exposes, sorted by name so the contract is stable. */
    static List<Method> publicMethodsOf(Object target) {
        List<Method> methods = new ArrayList<>();
        for (Method method : target.getClass().getDeclaredMethods()) {
            if (Modifier.isPublic(method.getModifiers()) && !method.isSynthetic()) {
                methods.add(method);
            }
        }
        Collections.sort(methods, new Comparator<Method>() {
            @Override
            public int compare(Method first, Method second) {
                return first.getName().compareTo(second.getName());
            }
        });
        return methods;
    }

    /** The exposed method a call names, or null if there is none. */
    static Method methodNamed(Object target, String name) {
        for (Method method : publicMethodsOf(target)) {
            if (method.getName().equals(name)) {
                return method;
            }
        }
        return null;
    }

    private static JSONObject describe(Method method) throws JSONException {
        JSONObject function = new JSONObject();
        function.put("functionName", method.getName());
        ProviderService.Describe methodDescription = method.getAnnotation(ProviderService.Describe.class);
        if (methodDescription != null) {
            function.put("functionDescription", methodDescription.value());
        }

        JSONArray args = new JSONArray();
        Type[] parameterTypes = method.getGenericParameterTypes();
        Annotation[][] parameterAnnotations = method.getParameterAnnotations();
        for (int i = 0; i < parameterTypes.length; i++) {
            JSONObject arg = new JSONObject();
            arg.put("name", "arg" + i);
            arg.put("type", nameOf(parameterTypes[i]));
            JSONArray subtypes = subtypesOf(parameterTypes[i]);
            if (subtypes != null) {
                arg.put("subtypes", subtypes);
            }
            ProviderService.Describe argumentDescription = describeAnnotationIn(parameterAnnotations[i]);
            if (argumentDescription != null) {
                arg.put("description", argumentDescription.value());
            }
            args.put(arg);
        }
        function.put("args", args);
        function.put("returns", nameOf(method.getGenericReturnType()));
        return function;
    }

    /**
     * For an argument of an interface or abstract class - or a list of one - the classes it may
     * be sent as, each with the fields it is read from, so a caller knows what to send:
     * [{"@type":"Circle","fields":[{"name":"radius","type":"double"}, ...]}, ...]
     * Null when the type has no known subtypes.
     */
    static JSONArray subtypesOf(Type type) throws JSONException {
        Type element = type;
        while (rawClassOf(element).isArray() || Collection.class.isAssignableFrom(rawClassOf(element))) {
            element = rawClassOf(element).isArray() ? componentTypeOf(element) : typeArgument(element, 0);
        }
        List<Class<?>> subtypes = knownSubtypesOf(rawClassOf(element));
        if (subtypes.isEmpty()) {
            return null;
        }
        JSONArray described = new JSONArray();
        for (Class<?> subtype : subtypes) {
            JSONArray fields = new JSONArray();
            for (Map.Entry<String, String> field : dataFieldsOf(subtype).entrySet()) {
                fields.put(new JSONObject().put("name", field.getKey()).put("type", field.getValue()));
            }
            described.put(new JSONObject().put(SUBTYPE_KEY, subtype.getSimpleName()).put("fields", fields));
        }
        return described;
    }

    /** getParameterAnnotations() hands back arrays to search, not a type to look up. */
    private static ProviderService.Describe describeAnnotationIn(Annotation[] annotations) {
        for (Annotation annotation : annotations) {
            if (annotation instanceof ProviderService.Describe) {
                return (ProviderService.Describe) annotation;
            }
        }
        return null;
    }
}
