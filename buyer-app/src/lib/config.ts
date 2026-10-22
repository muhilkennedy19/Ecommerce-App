import Constants from 'expo-constants';
import type { FirebaseOptions } from 'firebase/app';

interface Extra {
  firebase: FirebaseOptions;
  googleWebClientId: string;
  shopId: string;
  notifyUrl?: string;
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

/** True until the placeholders in app.json have been replaced with real values. */
export const isConfigured: boolean =
  !!firebaseConfig.apiKey && !firebaseConfig.apiKey.includes('REPLACE_ME');
