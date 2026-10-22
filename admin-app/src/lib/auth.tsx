import {
  configureGoogleSignIn,
  fetchAppUser,
  initFirebase,
  rolesOf,
  signInWithGoogle,
  signOutUser,
  subscribeToAuth,
  upsertPendingUser,
  type AppUser,
  type User,
} from '@common';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { firebaseConfig, googleWebClientId, isConfigured } from './config';
import { registerForPush } from '@/lib/push';

// Firebase + Google Sign-In are initialized at RUNTIME inside AuthProvider's effect
// (never at module load) so a build-time route scan can't evaluate native-only bindings.

interface AuthState {
  /** Firebase auth user, or null when signed out. */
  user: User | null;
  /** Admin-side identity (role, shop); null if the user has no `users/{uid}` doc yet. */
  appUser: AppUser | null;
  loading: boolean;
  configured: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshAppUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isConfigured) {
      setLoading(false);
      return;
    }
    initFirebase(firebaseConfig);
    configureGoogleSignIn(googleWebClientId);
    const unsub = subscribeToAuth(async (u) => {
      try {
        setUser(u);
        const au = u ? await fetchAppUser(u.uid) : null;
        setAppUser(au);
        // Signed in → register this device for push with the resolved role so the
        // server can target only order-servers (fire-and-forget; never throws).
        if (u) void registerForPush(u.uid, au ? rolesOf(au) : null);
        // No role yet → self-register a pending request so a manager can grant one in-app.
        if (u && !au) {
          await upsertPendingUser(u.uid, u.email ?? '', u.displayName ?? u.email ?? 'User').catch(
            () => {},
          );
        }
      } catch {
        setAppUser(null);
      } finally {
        setLoading(false);
      }
    });
    return unsub;
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      appUser,
      loading,
      configured: isConfigured,
      signIn: async () => {
        await signInWithGoogle();
      },
      signOut: async () => {
        await signOutUser();
        setAppUser(null);
      },
      refreshAppUser: async () => {
        if (user) setAppUser(await fetchAppUser(user.uid));
      },
    }),
    [user, appUser, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
