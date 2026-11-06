// Wires the shared logger to New Relic and installs app-wide crash handlers.
//
// Setup: put a New Relic INGEST-LICENSE key into app.local.json (or the NEW_RELIC_KEY EAS
// env var) as `newRelicKey`. Without one, every call here is a local console echo and
// nothing leaves the device.
import {
  configureLogger,
  flushLogs,
  logError,
  newRelicLogSink,
  setLogContext,
} from '@common';
import { AppState, Platform } from 'react-native';

import { appVersion, newRelicKey, newRelicRegion, shopId } from '@/lib/config';

/** React Native's global error hook; typed loosely because it isn't in the RN types. */
interface ErrorUtilsLike {
  getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
  setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
}

let started = false;

export function startLogging(): void {
  if (started) return;
  started = true;

  configureLogger({
    sink: newRelicKey ? newRelicLogSink(newRelicKey, newRelicRegion) : null,
    minLevel: 'warn',
    base: {
      app: 'buyer',
      appVersion,
      platform: Platform.OS,
      platformVersion: String(Platform.Version),
      shopId,
    },
  });

  // Uncaught JS errors (including fatals that would otherwise just white-screen).
  const errorUtils = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  const previous = errorUtils?.getGlobalHandler?.();
  errorUtils?.setGlobalHandler?.((error, isFatal) => {
    logError('global', error, { fatal: !!isFatal });
    // Still hand off to RN's own handler so the red box / crash behaviour is unchanged.
    previous?.(error, isFatal);
  });

  // Logs are batched, so push them out before the OS freezes or kills the process.
  AppState.addEventListener('change', (next) => {
    if (next !== 'active') void flushLogs();
  });
}

/** Attach the signed-in buyer to every subsequent log line. */
export function setLogUser(uid?: string | null): void {
  setLogContext({ uid: uid ?? null });
}

export { logError, logInfo, logWarn } from '@common';
