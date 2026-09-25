// nowrun-expo — exposes an app's own functions to a bridge-sdk client app over AIDL.
//
// The whole integration:
//
//   useNowrun({
//     greet: ({ who }) => `hello ${who}`,
//     get_state: () => JSON.stringify(state),
//   });
//
// The handler object is the declaration. Its keys become the functions a client can call,
// so there is no second list to keep in step and no way to declare something that is not
// there. Android only; every export below is a no-op elsewhere, so callers need no
// Platform checks and a web build is unaffected.

import { useEffect, useRef } from 'react';
import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

/** React Native's build flag; false in a release bundle, where the warnings are stripped. */
declare const __DEV__: boolean;

/**
 * The common types are checked by the SDK before a handler sees them. Any other name is a
 * type of the app's own, checked through the `fields` and `values` it declares, or passed on
 * as it arrived when it declares neither. Any of them may be followed by [] for a list.
 */
export type CommonParamType =
  | 'String' | 'boolean' | 'int' | 'long' | 'short' | 'byte' | 'float' | 'double' | 'number'
  | 'JSONObject' | 'JSONArray';

export type ToolParamType = CommonParamType | `${CommonParamType}[]` | (string & {});

export interface ToolParam {
  name: string;
  type: ToolParamType;
  /** Shown to whoever picks a call to make - an LLM, most often - alongside name and type. */
  description?: string;
  /** The value is an object of exactly these fields, each checked as declared. */
  fields?: ToolParam[];
  /** The value is one of these, e.g. ['top', 'shoes'] for a string union. */
  values?: (string | number | boolean)[];
}

/** One callable function, as a client sees it. */
export interface ToolSpec {
  functionName: string;
  args: ToolParam[];
  returns?: 'String';
  /** Shown to whoever picks a call to make - an LLM, most often - alongside functionName and args. */
  functionDescription?: string;
}

/**
 * Runs one call. Whatever it returns is what the client reads: a string goes across as it
 * is, anything else is JSON. Returning a promise is fine and may take as long as it needs:
 * nothing waits on it, and the answer is sent when it settles.
 */
export type Handler = (args: Record<string, any>) => unknown | Promise<unknown>;

export type Handlers = Record<string, Handler>;

interface BridgeCall {
  requestId: string;
  tool: string;
  /** Arguments as JSON text, keyed by the contract's own argument names. */
  args: string;
}

/**
 * The native module, named after the AIDL methods each one carries, so a call can be
 * followed straight across: IProviderService.invoke arrives as the 'invoke' event, and the
 * three below are IClientService's own methods.
 */
interface NowrunNativeModule {
  /** IProviderService.invoke. Every one must be answered exactly once, via sendResult. */
  addListener(event: 'invoke', listener: (payload: BridgeCall) => void): EventSubscription;
  /** IClientService.registerFunctions: publishes what this app can do, and starts the bridge. */
  registerFunctions(contractJson: string): void;
  /** IClientService.sendResult: one call's answer, quoting the requestId it arrived with. */
  sendResult(requestId: string, result: string): void;
  /** IClientService.onStateChange: app state, pushed to a connected client. */
  notifyStateChange(stateJson: string): void;
}

const native = requireOptionalNativeModule<NowrunNativeModule>('Nowrun');

/** False on web, and on any build without the native module. */
export const isAvailable = !!native;

/**
 * What a function takes when nothing richer was declared: one JSON object, whose keys are
 * the handler's own argument names.
 *
 * JavaScript cannot be asked for them. Java reflection reports parameter names and types
 * because the class file keeps them; TypeScript erases types before a bundle exists, and a
 * release build compiles to bytecode that does not retain function source — so `slot` and
 * `id` are simply not there to read. One object argument is the honest shape, and it is
 * also the easiest to send: no positional ordering, no splitting on commas.
 */
const DEFAULT_ARGS: ToolParam[] = [{ name: 'args', type: 'JSONObject' }];

/** The contract a client will see: derived from the handlers unless tools were declared. */
export function contractFor(handlers: Handlers, tools?: ToolSpec[]): ToolSpec[] {
  if (!tools) {
    return Object.keys(handlers).map((functionName) => ({ functionName, args: DEFAULT_ARGS, returns: 'String' }));
  }
  // Declaring the surface by hand buys per-argument names and types, at the price of a
  // second list. Say so loudly when the two disagree, rather than at the call that fails.
  if (__DEV__) {
    const declared = new Set(tools.map((t) => t.functionName));
    const handled = new Set(Object.keys(handlers));
    const missing = [...declared].filter((n) => !handled.has(n));
    const undeclared = [...handled].filter((n) => !declared.has(n));
    if (missing.length) {
      console.warn(`[nowrun-expo] declared but not handled: ${missing.join(', ')}`);
    }
    if (undeclared.length) {
      console.warn(`[nowrun-expo] handled but not declared, so unreachable: ${undeclared.join(', ')}`);
    }
  }
  return tools;
}

/**
 * Connects a bridge-sdk client to these handlers for as long as the component is mounted.
 *
 * Pass `tools` only when a client benefits from seeing each argument by name and type — an
 * LLM choosing a call, say. Leave it out and the surface is derived from the handlers.
 */
export function useNowrun(handlers: Handlers, options: { tools?: ToolSpec[] } = {}) {
  // Held in a ref so handlers may close over fresh state without re-registering, which
  // would republish the contract and re-register with the client on every render.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!native) return;

    // A client is waiting on this requestId, so every call must be answered exactly once —
    // including when there is no handler, or the arguments will not parse.
    const subscription = native.addListener('invoke', ({ requestId, tool, args }) => {
      const handler = handlersRef.current[tool];
      if (!handler) {
        sendFailure(requestId, `no handler for ${tool}`);
        return;
      }
      let parsedArgs: Record<string, unknown>;
      try {
        parsedArgs = args ? JSON.parse(args) : {};
      } catch {
        sendFailure(requestId, `unreadable arguments for ${tool}`);
        return;
      }
      // The executor runs the handler at once; a throw or a rejection both land in the
      // failure branch.
      new Promise((resolve) => resolve(handler(parsedArgs))).then(
        (result) => sendResult(requestId, result),
        (error) => sendFailure(requestId, errorMessage(error)),
      );
    });

    // Only now: publishing the contract is what starts the bridge, and a client can call
    // the moment it sees one.
    native.registerFunctions(JSON.stringify({ functions: contractFor(handlers, options.tools) }));
    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** Reports app state to a connected client. Safe to call when nothing is connected. */
export function notifyState(state: unknown) {
  native?.notifyStateChange(typeof state === 'string' ? state : JSON.stringify(state));
}

function sendResult(requestId: string, result: unknown) {
  native?.sendResult(requestId, typeof result === 'string' ? result : JSON.stringify(result));
}

function sendFailure(requestId: string, message: string) {
  sendResult(requestId, { success: false, response: `error: ${message}` });
}

function errorMessage(error: unknown): string {
  return String((error as Error)?.message ?? error).slice(0, 200);
}
