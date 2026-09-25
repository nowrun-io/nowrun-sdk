package gg.now.expo

import android.os.Bundle
import gg.now.bridge.ProviderService
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Carries bridge-sdk calls across to the JavaScript runtime, and nothing else.
 *
 * Reflection can only reach compiled Java methods, so a JavaScript app declares the same
 * list reflection would have produced and supplies a runner to start calls. Everything
 * else - naming the arguments, converting them, returning results - the SDK does the same
 * way it does for a Java app.
 *
 * Nothing blocks: a call is started, and its answer is sent later from sendResult().
 */
class NowrunModule : Module() {

  /** False once the JS runtime is gone, so a call fails instead of vanishing. */
  @Volatile
  private var alive = false

  /** The one thing the SDK cannot work out for itself: how to reach this runtime. */
  private val runner = ProviderService.FunctionRunner { requestId, function, argsJson ->
    if (!alive) {
      false
    } else {
      sendEvent(
        INVOKE_EVENT,
        Bundle().apply {
          putString("requestId", requestId)
          putString("tool", function)
          putString("args", argsJson)
        }
      )
      true
    }
  }

  override fun definition() = ModuleDefinition {
    Name("Nowrun")

    Events(INVOKE_EVENT)

    OnCreate { alive = true }

    OnDestroy { alive = false }

    /**
     * Publishes the contract and starts the bridge.
     *
     * The bridge starts here rather than in OnCreate so the order is guaranteed: a client
     * reads the contract the moment it binds, and JS calls this only once its listener is
     * in place, so there is no window where the app is connected but cannot answer. Calling
     * it again republishes, which is how a changed surface reaches a connected client.
     *
     * Application context: the service outlives any one activity. Being called late is
     * fine — the SDK asks the system whether this process is in front rather than waiting
     * for a resume that, by now, has already happened.
     */
    Function("registerFunctions") { contractJson: String ->
      appContext.reactContext?.applicationContext?.let { context ->
        ProviderService.start(context, contractJson, runner)
      }
    }

    /** One call's answer, tagged with the request it belongs to. */
    Function("sendResult") { requestId: String, result: String ->
      ProviderService.sendResult(requestId, result)
    }

    /** App state, pushed to a connected client. */
    Function("notifyStateChange") { stateJson: String ->
      ProviderService.notifyStateChange(stateJson)
    }
  }

  companion object {
    private const val INVOKE_EVENT = "invoke"
  }
}
