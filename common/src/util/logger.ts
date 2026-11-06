// Minimal structured logger with a pluggable remote sink.
//
// Why not a crash-reporting SDK: both apps run on Expo with continuous native generation,
// and the New Relic / Sentry React Native agents each pull in a native module. A plain
// HTTPS POST to a log ingest endpoint needs no native code, works in Expo Go, and keeps the
// Spark/free-tier posture of the rest of the stack.
//
// Everything here is best-effort: if the sink is unset or the network is down, logs are
// dropped silently. Logging must never be the reason a screen fails.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEvent {
  level: LogLevel;
  message: string;
  /** ISO timestamp, set at capture time. */
  timestamp: string;
  /** Error class name, when the event came from a thrown value. */
  errorName?: string;
  stack?: string;
  /** Arbitrary structured context (screen, orderId, uid …). Keep it small and non-PII. */
  context?: Record<string, unknown>;
}

export type LogSink = (events: LogEvent[]) => Promise<void>;

interface LoggerState {
  sink: LogSink | null;
  /** Attached to every event (app name, version, build, uid …). */
  base: Record<string, unknown>;
  queue: LogEvent[];
  timer: ReturnType<typeof setTimeout> | null;
  /** Below this level, events are dropped before they ever reach the queue. */
  minLevel: LogLevel;
  consoleEcho: boolean;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

declare const __DEV__: boolean | undefined;

// `__DEV__` only exists under React Native; guard so this module also loads in plain Node
// (unit tests) without throwing a ReferenceError.
const IS_DEV = typeof __DEV__ !== 'undefined' && __DEV__ === true;

const state: LoggerState = {
  sink: null,
  base: {},
  queue: [],
  timer: null,
  minLevel: 'warn',
  consoleEcho: IS_DEV,
};

/** How long to batch before flushing, and the hard cap on a single payload. */
const FLUSH_MS = 5000;
const MAX_BATCH = 50;

export function configureLogger(opts: {
  sink?: LogSink | null;
  base?: Record<string, unknown>;
  minLevel?: LogLevel;
  consoleEcho?: boolean;
}): void {
  if (opts.sink !== undefined) state.sink = opts.sink;
  if (opts.base) state.base = { ...state.base, ...opts.base };
  if (opts.minLevel) state.minLevel = opts.minLevel;
  if (opts.consoleEcho !== undefined) state.consoleEcho = opts.consoleEcho;
}

/** Merge extra fields into the context attached to every subsequent event. */
export function setLogContext(fields: Record<string, unknown>): void {
  state.base = { ...state.base, ...fields };
}

function scheduleFlush(): void {
  if (state.timer) return;
  state.timer = setTimeout(() => {
    state.timer = null;
    void flushLogs();
  }, FLUSH_MS);
}

/** Send anything queued. Safe to call at any time; never throws. */
export async function flushLogs(): Promise<void> {
  const sink = state.sink;
  if (!sink || state.queue.length === 0) return;
  const batch = state.queue.splice(0, MAX_BATCH);
  try {
    await sink(batch);
  } catch {
    // Drop on failure rather than retrying forever — a wedged sink must not grow unbounded.
  }
}

function enqueue(event: LogEvent): void {
  if (LEVEL_ORDER[event.level] < LEVEL_ORDER[state.minLevel]) return;
  if (state.consoleEcho) {
    const line = `[${event.level}] ${event.message}`;
    if (event.level === 'error') console.error(line, event.context ?? '', event.stack ?? '');
    else console.log(line, event.context ?? '');
  }
  if (!state.sink) return;
  state.queue.push({ ...event, context: { ...state.base, ...(event.context ?? {}) } });
  // Errors go out immediately; anything quieter can wait for the batch window.
  if (event.level === 'error') void flushLogs();
  else scheduleFlush();
}

export function log(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>,
): void {
  enqueue({ level, message, timestamp: new Date().toISOString(), context });
}

export const logInfo = (m: string, c?: Record<string, unknown>) => log('info', m, c);
export const logWarn = (m: string, c?: Record<string, unknown>) => log('warn', m, c);

/** Record a thrown value with its stack. `where` should identify the call site. */
export function logError(
  where: string,
  error: unknown,
  context?: Record<string, unknown>,
): void {
  const err = error instanceof Error ? error : new Error(String(error));
  enqueue({
    level: 'error',
    message: `${where}: ${err.message}`,
    timestamp: new Date().toISOString(),
    errorName: err.name,
    stack: err.stack,
    context,
  });
}

/**
 * Build a sink that posts to New Relic's Log API. Works with any ingest licence key
 * (the "INGEST - LICENSE" type, NOT a user API key).
 *
 * @param licenseKey New Relic ingest licence key.
 * @param region     'us' (default) or 'eu' — must match the account's data region.
 */
export function newRelicLogSink(licenseKey: string, region: 'us' | 'eu' = 'us'): LogSink {
  const url =
    region === 'eu' ? 'https://log-api.eu.newrelic.com/log/v1' : 'https://log-api.newrelic.com/log/v1';
  return async (events) => {
    const body = events.map((e) => ({
      timestamp: Date.parse(e.timestamp),
      message: e.message,
      level: e.level,
      'error.class': e.errorName,
      'error.stack': e.stack,
      ...(e.context ?? {}),
    }));
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Api-Key': licenseKey },
      body: JSON.stringify(body),
    });
  };
}
