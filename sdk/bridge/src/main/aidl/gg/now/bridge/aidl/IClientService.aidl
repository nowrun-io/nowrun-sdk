package gg.now.bridge.aidl;

import gg.now.bridge.aidl.IProviderService;

/** What the client app exposes. Provider apps call these. */
interface IClientService {
    /** Called once the provider connects, declaring what the client may invoke. */
    void registerFunctions(String packageName, String functionsJson, IProviderService provider);

    /** Called whenever the provider app's state changes. stateJson is the provider's own shape. */
    void onStateChange(String packageName, String stateJson);

    /**
     * The outcome of an earlier invoke(). requestId is the one the client passed in, so it
     * can match this result to the call that produced it.
     * Appended last: the methods above keep their transaction codes.
     */
    void sendResult(String packageName, String requestId, String result);
}
