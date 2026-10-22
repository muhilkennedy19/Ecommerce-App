import { GoogleSignin } from '@react-native-google-signin/google-signin';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signOut,
  type User,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { getDb, getFirebaseAuth } from '../firebase/client';
import type { AppUser } from '../types';

/**
 * Configure Google Sign-In. `webClientId` is the OAuth **web** client ID from the
 * Firebase console (required so the returned idToken is accepted by Firebase Auth).
 */
export function configureGoogleSignIn(webClientId: string): void {
  GoogleSignin.configure({ webClientId });
}

/** Launch the Google account picker and sign in to Firebase. Returns null if cancelled. */
export async function signInWithGoogle(): Promise<User | null> {
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const response = await GoogleSignin.signIn();
  if (response.type !== 'success') return null; // user cancelled
  const idToken = response.data.idToken;
  if (!idToken) {
    throw new Error('Google Sign-In returned no idToken — check the configured webClientId.');
  }
  const credential = GoogleAuthProvider.credential(idToken);
  const result = await signInWithCredential(getFirebaseAuth(), credential);
  return result.user;
}

export async function signOutUser(): Promise<void> {
  try {
    await GoogleSignin.signOut();
  } catch {
    // ignore — Google session may already be gone
  }
  await signOut(getFirebaseAuth());
}

export function subscribeToAuth(cb: (user: User | null) => void) {
  return onAuthStateChanged(getFirebaseAuth(), cb);
}

/** Current user's Firebase ID token (for authenticating calls to the notify function). */
export async function getIdToken(): Promise<string | null> {
  const u = getFirebaseAuth().currentUser;
  return u ? u.getIdToken() : null;
}

/** Read the admin-side identity (role, shop) for a signed-in user. */
export async function fetchAppUser(uid: string): Promise<AppUser | null> {
  const snap = await getDoc(doc(getDb(), 'users', uid));
  if (!snap.exists()) return null;
  return { uid, ...(snap.data() as Omit<AppUser, 'uid'>) };
}

export type { User };
