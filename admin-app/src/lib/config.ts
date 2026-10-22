import Constants from 'expo-constants';
import type { FirebaseOptions } from 'firebase/app';

interface Extra {
  firebase: FirebaseOptions;
  googleWebClientId: string;
  shopId: string;
  notifyUrl?: string;
}

const extra = (Constants.expoConfig?.extra ?? {}) as Partial<Extra>;

export const firebaseConfig: FirebaseOptions = (extra.firebase ?? {}) as FirebaseOptions;
export const googleWebClientId: string = extra.googleWebClientId ?? '';
export const shopId: string = extra.shopId ?? 'main';
export const notifyUrl: string = extra.notifyUrl ?? '';

/** True until the placeholders in app.json have been replaced with real values. */
export const isConfigured: boolean =
  !!firebaseConfig.apiKey && !firebaseConfig.apiKey.includes('REPLACE_ME');
