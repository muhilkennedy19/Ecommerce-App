# Observability (logging + crash reporting)

Added Nov 2026. Replaces "no error boundary anywhere, a render throw white-screens the app
with no signal".

## Shape

- `common/src/util/logger.ts` — batching, level filter, pluggable sink. No SDK.
- `<app>/src/lib/logging.ts` — wires the sink, installs the global error handler, flushes on
  background. `startLogging()` is called at module scope in each root layout, *before* the
  first render, so a crash inside a provider is still captured.
- `<app>/src/components/error-boundary.tsx` — wraps the whole tree. Styled with raw RN
  primitives and literal colours on purpose: it must render even if theme/i18n/auth is what
  blew up.

## Why not the New Relic / Sentry RN agent

Both pull in a native module. A plain HTTPS POST to the Log API needs no native code, keeps
Expo's continuous native generation intact, and costs nothing. Trade-off accepted: no native
crash capture (ANRs, native signals) — only JS errors.

## Config

`app.local.json` (gitignored), both apps:

```json
{ "newRelicKey": "<40-char INGEST-LICENSE key>", "newRelicRegion": "us" }
```

- Must be type **INGEST - LICENSE**, not a USER key. one.newrelic.com → user menu → API keys.
- Region must match the account or ingest silently 403s.
- Absent key = sink is null, logs stay on-device. Never a hard failure.

## Gotchas

- `minLevel` is `warn`, so a healthy app sends **nothing**. An empty Logs view is ambiguous;
  verify with a direct curl to `log-api.newrelic.com/log/v1` expecting `202`.
- Release builds have `consoleEcho` off (`__DEV__` false), so `adb logcat` shows nothing
  either. Use `npm run admin` for local echo.
- `errors` flush immediately; `warn` batches 5 s. Force-killing instantly can lose a warn.
- `__DEV__` is guarded with `typeof` so the module also loads under vitest.

## Viewing

one.newrelic.com → Logs → `app:admin`, or
`SELECT * FROM Log WHERE app = 'admin' SINCE 30 MINUTES AGO`.

Attributes: `app`, `appVersion`, `platform`, `platformVersion`, `shopId`, `uid`,
`error.class`, `error.stack`, `componentStack` (render crashes).

Worth adding: an alert on `count(*) FROM Log WHERE level = 'error'`.
