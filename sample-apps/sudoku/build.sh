#!/usr/bin/env bash
# Builds the APK.
#   ./build.sh                  debug
#   ./build.sh release          signed release
#   ./build.sh install          debug + install
#   ./build.sh release install  release + install
set -e
cd "$(dirname "$0")"

# local.properties is per-machine and not committed, so the SDK location comes from here.
ANDROID_HOME=${ANDROID_HOME:-/home/ubuntu/workspace/android-sdk}
export ANDROID_HOME
export ANDROID_SDK_ROOT="$ANDROID_HOME"

BUILD=debug
for arg in "$@"; do
    [ "$arg" = "release" ] && BUILD=release
done

# The SDK is not committed as an AAR: built from source every time, so it is never stale.
(cd ../../sdk && ./build.sh >/dev/null)
mkdir -p app/libs
cp ../../sdk/bridge/build/outputs/aar/bridge-release.aar app/libs/bridge-release.aar

if [ "$BUILD" = "release" ]; then
    ./gradlew assembleRelease
    APK=app/build/outputs/apk/release/app-release.apk
else
    ./gradlew assembleDebug
    APK=app/build/outputs/apk/debug/app-debug.apk
fi

echo "APK: $PWD/$APK"

for arg in "$@"; do
    if [ "$arg" = "install" ]; then
        adb install -r "$APK"
    fi
done
