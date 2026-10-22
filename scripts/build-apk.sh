#!/usr/bin/env bash
# Produce a standalone APK file (and install it if a device is attached).
# Usage: ./scripts/build-apk.sh <admin|buyer> [debug|release]   (default: debug)
source "$(dirname "$0")/_common.sh"

APP="$(resolve_app "${1:-}")"
VARIANT="${2:-debug}"
ensure_jdk17
ensure_android_sdk

cd "$ROOT_DIR/$APP"
info "Generating the native Android project (expo prebuild)…"
npx expo prebuild --platform android --no-install

case "$VARIANT" in
  debug)   TASK="assembleDebug";   OUT="app/build/outputs/apk/debug/app-debug.apk" ;;
  release) TASK="assembleRelease"; OUT="app/build/outputs/apk/release/app-release.apk" ;;
  *) die "variant must be 'debug' or 'release' (got '$VARIANT')" ;;
esac

info "Running Gradle ${TASK}..."
cd android
./gradlew "$TASK"

APK="$(pwd)/$OUT"
[ -f "$APK" ] || die "expected APK not found at $APK"
echo
info "APK ready: $APK"
[ "$VARIANT" = "release" ] && echo "  (note: release is debug-signed unless you configure a release keystore)"

if adb devices | awk 'NR>1 && $2=="device"' | grep -q .; then
  info "Installing on connected device…"
  adb install -r "$APK"
else
  info "No device attached — install later with:  adb install -r \"$APK\""
fi
