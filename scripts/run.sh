#!/usr/bin/env bash
# Build a debug dev-client APK, install it, and start Metro — the normal dev loop.
# Usage: ./scripts/run.sh <admin|buyer> [extra expo args]
source "$(dirname "$0")/_common.sh"

APP="$(resolve_app "${1:-}")"; shift || true
ensure_jdk17
ensure_android_sdk
ensure_device

info "Building + launching $APP (debug) — first run compiles native code and is slow…"
cd "$ROOT_DIR/$APP"
exec npx expo run:android "$@"
