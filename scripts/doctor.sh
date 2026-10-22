#!/usr/bin/env bash
# Check the local toolchain needed for building the Android APKs.
source "$(dirname "$0")/_common.sh"
set +e  # soft checks — report everything, never abort

echo "── Toolchain ──────────────────────────────"
printf "Node    : %s\n" "$(node -v 2>/dev/null || echo MISSING)"
printf "npm     : %s\n" "$(npm -v 2>/dev/null || echo MISSING)"
printf "Java    : %s\n" "$(java -version 2>&1 | head -1 || echo MISSING)"
if [ -x /usr/libexec/java_home ] && /usr/libexec/java_home -v 17 >/dev/null 2>&1; then
  printf "JDK 17  : %s\n" "$(/usr/libexec/java_home -v 17)"
else
  printf "JDK 17  : NOT FOUND  (needed for Gradle → brew install --cask temurin@17)\n"
fi

echo "── Android SDK ────────────────────────────"
SDK="${ANDROID_HOME:-}"
[ -z "$SDK" ] && { [ -d "$HOME/Library/Android/sdk" ] && SDK="$HOME/Library/Android/sdk"; }
if [ -n "$SDK" ] && [ -d "$SDK" ]; then
  printf "SDK     : %s\n" "$SDK"
  "$SDK/platform-tools/adb" devices 2>/dev/null || echo "adb not found in SDK"
  "$SDK/emulator/emulator" -list-avds 2>/dev/null | sed 's/^/AVD     : /' || true
else
  printf "SDK     : NOT FOUND  (install Android Studio, or set ANDROID_HOME)\n"
fi
echo "───────────────────────────────────────────"
