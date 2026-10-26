import {
  buildWelcomeEmail,
  configureGoogleSignIn,
  getIdToken,
  getShop,
  initFirebase,
  sendEmail,
  signInWithGoogle,
  signOutUser,
  subscribeToAuth,
  upsertCustomerForUser,
  type User,
} from '@common';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { firebaseConfig, googleWebClientId, isConfigured, notifyUrl, shopId } from './config';
import { registerForPush } from './push';

// Firebase + Google Sign-In are initialized at RUNTIME inside AuthProvider's effect
// (never at module load) so a build-time route scan can't evaluate native-only bindings.

interface AuthState {
  /** Firebase auth user, or null when signed out. */
  user: User | null;
  loading: boolean;
  configured: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

const DEFAULT_SHOP_NAME = 'Buyer';

/** Best-effort one-time welcome email; resolves the live shop name, falls back to the brand. */
async function sendWelcomeEmail(to: string, name: string): Promise<void> {
  try {
    let shopName = DEFAULT_SHOP_NAME;
    try {
      const shop = await getShop(shopId);
      if (shop?.name) shopName = shop.name;
    } catch {
      // keep the default name if the shop doc can't be read
    }
    const body = buildWelcomeEmail({ name, shopName });
    await sendEmail(notifyUrl, await getIdToken(), { to, fromName: shopName, ...body });
  } catch {
    // never block sign-in on an email failure
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // Avoid re-upserting the customer doc on every auth emission.
  const upsertedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!isConfigured) {
      setLoading(false);
      return;
    }
    initFirebase(firebaseConfig);
    configureGoogleSignIn(googleWebClientId);
    const unsub = subscribeToAuth(async (u) => {
      setUser(u);
      setLoading(false);
      if (u && upsertedFor.current !== u.uid) {
        upsertedFor.current = u.uid;
        // Fire-and-forget: register this device for push once we have a signed-in user.
        void registerForPush(u.uid);
        try {
          const { isNew } = await upsertCustomerForUser(shopId, u.uid, {
            name: u.displayName ?? '',
            email: u.email ?? '',
          });
          // One-time welcome email for brand-new customers (best-effort; no-op if Gmail
          // isn't configured on the notify Worker, or the account has no email).
          if (isNew && u.email) {
            void sendWelcomeEmail(u.email, u.displayName ?? '');
          }
        } catch {
          // non-fatal — the buyer can still browse/order; profile sync will retry next sign-in
          upsertedFor.current = null;
        }
      }
      if (!u) upsertedFor.current = null;
    });
    return unsub;
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      configured: isConfigured,
      signIn: async () => {
        await signInWithGoogle();
      },
      signOut: async () => {
        await signOutUser();
      },
    }),
    [user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
