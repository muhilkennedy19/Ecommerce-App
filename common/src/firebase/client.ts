import { getApp, getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { getAuth, initializeAuth, type Auth, type Persistence } from 'firebase/auth';
import * as firebaseAuth from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';
import AsyncStorage from '@react-native-async-storage/async-storage';

// NOTE: the values in FirebaseOptions (apiKey, projectId, appId, ...) are a PUBLIC
// project identifier, not a secret. It is safe to ship them in the app. Protection
// comes from Firebase Auth + Security Rules, never from hiding this config.

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;
let storage: FirebaseStorage | undefined;

export interface FirebaseServices {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  storage: FirebaseStorage;
}

// `getReactNativePersistence` only exists on firebase/auth's React Native build. Resolve it
// lazily and defensively: in a non-RN context (e.g. a build-time route scan) it's absent, so
// we fall back to default persistence instead of crashing the bundler.
function reactNativePersistence(): Persistence | undefined {
  const fn = (firebaseAuth as unknown as {
    getReactNativePersistence?: (storage: unknown) => Persistence;
  }).getReactNativePersistence;
  return typeof fn === 'function' ? fn(AsyncStorage) : undefined;
}

/** Call exactly once at app startup (e.g. in the auth provider) before using any getter. */
export function initFirebase(config: FirebaseOptions): FirebaseServices {
  if (!getApps().length) {
    app = initializeApp(config);
    // AsyncStorage persistence keeps the user signed in across app restarts (when available).
    const persistence = reactNativePersistence();
    auth = persistence ? initializeAuth(app, { persistence }) : initializeAuth(app);
  } else {
    app = getApp();
    auth = getAuth(app);
  }
  db = getFirestore(app);
  storage = getStorage(app);
  return { app, auth, db, storage };
}

function assertInit<T>(value: T | undefined, name: string): T {
  if (!value) throw new Error(`Firebase not initialized: call initFirebase() before using ${name}.`);
  return value;
}

export const getFirebaseAuth = (): Auth => assertInit(auth, 'auth');
export const getDb = (): Firestore => assertInit(db, 'db');
export const getFirebaseStorage = (): FirebaseStorage => assertInit(storage, 'storage');
