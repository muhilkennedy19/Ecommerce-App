#!/usr/bin/env bash
# Shared helpers for the local build/run scripts. Source this; don't run directly.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

die()  { echo "✖ $*" >&2; exit 1; }
info() { echo "➤ $*"; }

# Map a friendly app name to its folder.
resolve_app() {
  case "${1:-}" in
    admin|seller|admin-app)   echo "admin-app" ;;
    buyer|customer|buyer-app) echo "buyer-app" ;;
    "") die "which app? usage: $(basename "$0") <admin|buyer> [...]" ;;
    *)  die "unknown app '${1}'. use: admin | buyer" ;;
  esac
}

# Android's Gradle build needs JDK 17. This machine's default JDK is newer and will fail,
# so point JAVA_HOME at a JDK 17 if one is installed.
ensure_jdk17() {
  if [ -x /usr/libexec/java_home ] && J="$(/usr/libexec/java_home -v 17 2>/dev/null)"; then
    export JAVA_HOME="$J"
    info "Using JDK 17: $JAVA_HOME"
  else
    echo "⚠ JDK 17 not found (current: $(java -version 2>&1 | head -1))." >&2
    echo "  Android Gradle builds require JDK 17. Install one, e.g.:" >&2
    echo "    brew install --cask temurin@17" >&2
    echo "  Continuing — the build will likely fail without it." >&2
  fi
}

# Find the Android SDK and put its tools on PATH.
ensure_android_sdk() {
  if [ -z "${ANDROID_HOME:-}" ]; then
    for d in "$HOME/Library/Android/sdk" "$HOME/Android/Sdk"; do
      [ -d "$d" ] && export ANDROID_HOME="$d" && break
    done
  fi
  [ -n "${ANDROID_HOME:-}" ] || die "Android SDK not found. Install Android Studio, then re-run (or set ANDROID_HOME)."
  export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
  command -v adb >/dev/null 2>&1 || die "adb not found under ANDROID_HOME=$ANDROID_HOME"
  info "ANDROID_HOME=$ANDROID_HOME"
}

# Warn (don't fail) if no device/emulator is attached.
ensure_device() {
  if ! adb devices | awk 'NR>1 && $2=="device"' | grep -q .; then
    echo "⚠ No device/emulator detected." >&2
    echo "  Start one:  emulator -list-avds   then   emulator -avd <name>" >&2
    echo "  or plug in a device with USB debugging enabled." >&2
  else
    info "$(adb devices | awk 'NR>1 && $2=="device"' | wc -l | tr -d ' ') device(s) connected"
  fi
}
