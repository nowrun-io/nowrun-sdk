# Bridge SDK — async-start variant

A copy of `../bridge-sdk` with one addition, kept separate so the original stays exactly as
the Java sample apps have always had it. Everything in that README still applies; this file
covers only the difference.

## Why this exists

`ProviderService` binds the client only while the provider app is in front of the user, and
it learns that from `Application.ActivityLifecycleCallbacks` registered inside `start()`.

That ordering assumes `start()` runs before the activity resumes, which is true for an
ordinary Java app calling it from `onCreate()`. It is not true for a host that builds its
runtime asynchronously:

    MainActivity.onCreate()      ->  runtime starts building, on another thread
    MainActivity.onResume()      ->  the only resume fires, nobody is listening yet
    ...
    runtime ready                ->  ProviderService.start() finally runs
                                     callbacks registered, foreground still false

From then on `connect()` refuses every attempt, and does so silently, because not being in
front is a normal condition rather than an error — nothing appears in logcat. The provider
never registers and the client reports `Not connected` until the user leaves the app and
comes back, which is the first resume the callbacks actually see.

React Native hits this every launch. Flutter and any other host that starts its bridge off
the main thread will too.

## The addition

An overload that lets a host say it is already on screen:

    ProviderService.start(context, appFunctions, /* inForeground */ true);

    public static void start(Context context, Object target) {
        start(context, target, false);   // unchanged behaviour for existing callers
    }

Setting `foreground` here substitutes for the resume the callbacks missed. Leaving the
foreground is still decided solely by `onActivityPaused`, so an inaccurate `true` costs one
early binding, corrected at the next pause — not a stuck one.

`start(Context, Object)` keeps its old signature and its old body, so it is source- and
binary-compatible: the Java sample apps compile and behave exactly as before, and a
`true` would in fact be wrong for them, since at `onCreate()` the activity is not yet on
screen.

## Who should pass true

Only a host whose bridge starts after its first resume. It should decide from something it
can actually observe, not from a hardcoded `true` — the Drape integration uses whether an
activity is attached at the moment its native module is created:

    ProviderService.start(context, AppFunctions(), appContext.currentActivity != null)

## Integrating

As in `../bridge-sdk`. The reference integration for this variant is an Expo native module
rather than an Activity — `../expo-module`, which relays calls from
binder threads into a JavaScript runtime.

Note that integration consumes `classes.jar` lifted out of the AAR rather than the AAR
itself, because an Android library cannot take a direct local `.aar` dependency. It
re-declares the `<service>` and `<queries>` entries this library's manifest would otherwise
have merged in. Publishing to Maven would remove that wrinkle for both projects.

## Building

    ./build.sh                 # the AAR

## Keeping the two in sync

This is a copy, which is the thing the original README warns about. It is deliberate — the
ask was to leave `../bridge-sdk` untouched — but it means a fix landing in one does not
reach the other. Folding this overload back into the original, or publishing both from one
source, is the way out.
