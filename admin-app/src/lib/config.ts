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

export const firebaseConfig: FirebaseOptions = (extra.firebase ?? {}) as FirebaseOptions;
export const googleWebClientId: string = extra.googleWebClientId ?? '';
export const shopId: string = extra.shopId ?? 'main';
export const notifyUrl: string = extra.notifyUrl ?? '';
export const newRelicKey: string = extra.newRelicKey ?? '';
export const newRelicRegion: 'us' | 'eu' = extra.newRelicRegion === 'eu' ? 'eu' : 'us';

/** App version/build, attached to every log line so crashes can be pinned to a release. */
export const appVersion: string = Constants.expoConfig?.version ?? '0.0.0';

/** True until the placeholders in app.json have been replaced with real values. */
export const isConfigured: boolean =
  !!firebaseConfig.apiKey && !firebaseConfig.apiKey.includes('REPLACE_ME');
