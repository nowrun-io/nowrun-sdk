#!/usr/bin/env bash
# Syncs the bridge SDK and builds the release APK.
set -e
cd "$(dirname "$0")"

ANDROID_HOME=${ANDROID_HOME:-/home/ubuntu/workspace/android-sdk}
export ANDROID_HOME
export ANDROID_SDK_ROOT="$ANDROID_HOME"

SDK=../../sdk
PKG=../../expo-module
APK=android/app/build/outputs/apk/release/app-release.apk

# classes.jar out of the SDK's AAR, because an Android library cannot take a direct local
# .aar dependency. Rebuilt every time rather than trusted: Gradle compiles happily against
# a stale jar and only fails once a symbol actually goes missing.
(cd "$SDK" && ./build.sh >/dev/null)
unzip -o -q "$SDK/bridge/build/outputs/aar/bridge-release.aar" classes.jar -d /tmp
mkdir -p "$PKG/android/libs"
cp /tmp/classes.jar "$PKG/android/libs/bridge.jar"

# The package ships compiled JS; Metro resolves its "main", not src/. A fresh clone has no
# node_modules there yet, so no tsc either.
(cd "$PKG" && { [ -d node_modules ] || npm install --no-audit --no-fund --silent; } && ./node_modules/.bin/tsc)

# --install-links copies rather than symlinks, so node_modules holds a real directory:
# Metro will not follow a symlink out of the project, and a copy is what an app installing
# the published package would get anyway.
#
# The old copy goes first. The version never changes at 1.0.0, so npm decides the package is
# already installed and keeps whatever is there, however old.
rm -rf node_modules/nowrun-expo
npm install --install-links --no-audit --no-fund --silent

# Checked rather than trusted: a stale copy still builds, it just builds the wrong thing.
diff -q "$PKG/build/index.js" node_modules/nowrun-expo/build/index.js >/dev/null || {
  echo "error: node_modules/nowrun-expo is stale after npm install" >&2
  exit 1
}

# android/ is not committed: prebuild generates it from app.json, and regenerates it exactly.
[ -d android ] || CI=1 npx expo prebuild --platform android --no-install

# Metro's bundle task excludes node_modules from its inputs, so editing the package leaves
# the task UP-TO-DATE and the APK keeps whatever JS it bundled last time — against freshly
# compiled Kotlin. Dropping its output is what forces the two halves to be built together.
rm -rf android/app/build/generated/assets/createBundleReleaseJsAndAssets \
       android/app/build/intermediates/assets/release

(cd android && ./gradlew assembleRelease --no-daemon -q)

# The bundle is the half that goes stale silently; prove this APK carries a fresh one.
BUNDLE=android/app/build/generated/assets/createBundleReleaseJsAndAssets/index.android.bundle
[ "$BUNDLE" -nt "$PKG/build/index.js" ] || {
  echo "error: bundled JS is older than the package it should contain" >&2
  exit 1
}

echo "APK: $PWD/$APK"
