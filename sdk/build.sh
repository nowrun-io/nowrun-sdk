#!/usr/bin/env bash
# Builds the SDK. The AAR is what integrating apps consume.
# See ../expo-module for the reference integration.
set -e
cd "$(dirname "$0")"

# local.properties is per-machine and not committed, so the SDK location comes from here.
ANDROID_HOME=${ANDROID_HOME:-/home/ubuntu/workspace/android-sdk}
export ANDROID_HOME
export ANDROID_SDK_ROOT="$ANDROID_HOME"

./gradlew :bridge:assembleRelease

AAR=bridge/build/outputs/aar/bridge-release.aar
echo "AAR: $PWD/$AAR"
