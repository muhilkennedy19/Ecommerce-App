# Local build scripts

Helpers for building/running the two Android apps on this machine. All take the app name
`admin` or `buyer`.

| Script | What it does |
|--------|--------------|
| `./scripts/doctor.sh` | Check the toolchain (Node, JDK 17, Android SDK, devices/AVDs). Run this first. |
| `./scripts/run.sh <admin\|buyer>` | Build a **debug** dev-client, install it, and start Metro. The normal dev loop. |
| `./scripts/build-apk.sh <admin\|buyer> [debug\|release]` | Produce a standalone `.apk` (default `debug`) and install it if a device is attached. |
| `./scripts/clean.sh <admin\|buyer>` | Delete generated `android/`/`ios/`/`.expo` (regenerated on next build). |

Also available from the repo root as npm scripts: `npm run doctor`, `npm run android:admin`,
`npm run android:buyer`, `npm run apk:admin`, `npm run apk:buyer`.

## Prerequisites (local Android builds)

1. **Android SDK** — install Android Studio (gives you the SDK, `adb`, and the emulator).
   The scripts auto-detect `~/Library/Android/sdk`; otherwise set `ANDROID_HOME`.
2. **JDK 17** — Gradle needs it; this machine's default JDK is newer and will fail.
   `brew install --cask temurin@17` — the scripts then pick it up automatically.
3. **A device or emulator** — start one from Android Studio's Device Manager, or
   `emulator -avd <name>` (list them with `emulator -list-avds`), or plug in a phone
   with USB debugging on.

The installed APK's signing key (your debug keystore SHA-1) is already registered in
Firebase, so Google Sign-In works for locally-built debug APKs. If you later build with
EAS, register that keystore's SHA-1 too (see the root README).

> Tip: prefer EAS cloud builds (`npx eas-cli build --profile development --platform android`)
> if you'd rather not install the Android SDK / JDK 17 locally.
