#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ ! -d android ]]; then
  echo "android/ missing — running Expo prebuild"
  npx expo prebuild --platform android --clean
fi
cd android

export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
if [[ -d /usr/lib/jvm/java-17-openjdk-amd64 ]]; then
  export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-17-openjdk-amd64}"
fi

node ../scripts/patch-argon2.mjs
node ../scripts/patch-android.mjs

./gradlew :app:assembleRelease -x lint -x test "$@"
echo
echo "Signed APK:"
echo "  $(pwd)/app/build/outputs/apk/release/app-release.apk"
ls -lh app/build/outputs/apk/release/app-release.apk
