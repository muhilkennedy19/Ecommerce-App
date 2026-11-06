import Constants from 'expo-constants';
import type { FirebaseOptions } from 'firebase/app';

interface Extra {
  firebase: FirebaseOptions;
  googleWebClientId: string;
  shopId: string;
  notifyUrl?: string;
  /** New Relic INGEST-LICENSE key. Absent = remote logging is a no-op. */
  newRelicKey?: string;
  /** New Relic data region: 'us' (default) or 'eu'. */
  newRelicRegion?: 'us' | 'eu';
}

const extra = (Constants.expoConfig?.extra ?? {}) as Partial<Extra>;

function required<T>(value: T | undefined, key: string): T {
  if (value === undefined || value === null) {
    throw new Error(`Missing "${key}" in app.json > expo.extra`);
  }
  return value;
}

export const firebaseConfig: FirebaseOptions = required(extra.firebase, 'firebase');
export const googleWebClientId: string = required(extra.googleWebClientId, 'googleWebClientId');
export const shopId: string = extra.shopId ?? 'main';
export const notifyUrl: string = extra.notifyUrl ?? '';
export const newRelicKey: string = extra.newRelicKey ?? '';
export const newRelicRegion: 'us' | 'eu' = extra.newRelicRegion === 'eu' ? 'eu' : 'us';

/** App version/build, attached to every log line so crashes can be pinned to a release. */
export const appVersion: string = Constants.expoConfig?.version ?? '0.0.0';

/** True until the placeholders in app.json have been replaced with real values. */
export const isConfigured: boolean =
  !!firebaseConfig.apiKey && !firebaseConfig.apiKey.includes('REPLACE_ME');
