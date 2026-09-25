#!/usr/bin/env bash
# Builds the module: refreshes the bundled SDK jar, then compiles the TypeScript.
#
#   ./build.sh                                refresh the jar and compile
#   ./build.sh ../sample-apps/nowrun-drape    ...and push the result into that app's node_modules
#
# There is no gradle step: the Kotlin half is compiled by the host app through Expo
# autolinking, so it is only ever checked by building an app that installs this module.
set -e
cd "$(dirname "$0")"

SDK=../sdk
AAR=$SDK/bridge/build/outputs/aar/bridge-release.aar

# 1. The SDK, as the jar this module bundles. An Android library cannot depend on a local
#    .aar, so what ships is the classes.jar out of it. Rebuilt every time: a stale jar
#    fails silently, with the old client package compiled in.
(cd "$SDK" && ./build.sh >/dev/null)
TMP=$(mktemp -d)
unzip -o -q "$AAR" classes.jar -d "$TMP"
mkdir -p android/libs
cp "$TMP/classes.jar" android/libs/bridge.jar
rm -rf "$TMP"
echo "jar: $PWD/android/libs/bridge.jar"

# 2. The JavaScript entry point that apps import. A fresh clone has no node_modules, so no tsc.
[ -d node_modules ] || npm install --no-audit --no-fund --silent
npm run --silent build
echo "js:  $PWD/build/index.js"
