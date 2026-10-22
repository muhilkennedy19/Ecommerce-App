#!/usr/bin/env bash
# Remove generated native code + caches for an app (safe — regenerated on next build).
# Usage: ./scripts/clean.sh <admin|buyer>
source "$(dirname "$0")/_common.sh"

APP="$(resolve_app "${1:-}")"
cd "$ROOT_DIR/$APP"
info "Removing android/, ios/, .expo for ${APP}..."
rm -rf android ios .expo
info "Done — the next build regenerates native code (Continuous Native Generation)."
