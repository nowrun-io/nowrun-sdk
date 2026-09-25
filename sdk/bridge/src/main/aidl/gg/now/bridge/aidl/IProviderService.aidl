package gg.now.bridge.aidl;

/** What a provider app exposes. */
interface IProviderService {
    /**
     * The contract this app exposes, as JSON:
     * {"functions":[{"name":"greet","args":[{"name":"arg0","type":"String"}],"returns":"String"}]}
     */
    String getFunctions();

    /**
     * Starts a function. Returns immediately: true means the call was accepted and is
     * running, false means there is no such function. The result is delivered later to
     * IClientService.sendResult() carrying this same requestId.
     *
     * Arguments are keyed "arg0", "arg1", ... A Bundle carries primitives, arrays,
     * Parcelables and Strings; text values are converted to whatever the function declares.
     */
    boolean invoke(String requestId, String function, in Bundle args);
}
