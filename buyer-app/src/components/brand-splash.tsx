import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { LOGO_KEY } from '@/hooks/use-shop-name';
import { ThemedText } from './themed-text';

/** Matches the native splash background so there is no colour flash on handover. */
const BRAND_BG = '#2E7D32';
const MIN_VISIBLE_MS = 2000;

/** Fallback until the admin uploads a logo in Settings → Shop logo. */
const FALLBACK_LOGO = require('../../assets/images/splash-icon.png');

/** Cache key written by `useShopName`; read directly so the splash needs no Firebase. */
const SHOP_NAME_CACHE_KEY = 'shopName';

function BrandSplash() {
  const [name, setName] = useState<string>(() => Constants.expoConfig?.name ?? 'Buyer');
  const [logoUri, setLogoUri] = useState<string | null>(null);

  useEffect(() => {
    // Async callbacks, so these do not cascade renders on mount.
    AsyncStorage.multiGet([SHOP_NAME_CACHE_KEY, LOGO_KEY])
      .then((entries) => {
        for (const [key, value] of entries) {
          if (!value) continue;
          if (key === SHOP_NAME_CACHE_KEY) setName(value);
          if (key === LOGO_KEY) setLogoUri(value);
        }
      })
      .catch(() => {});
  }, []);

  return (
    <View style={[StyleSheet.absoluteFill, styles.root]}>
      <Image
        source={logoUri ? { uri: logoUri } : FALLBACK_LOGO}
        style={styles.logo}
        contentFit="contain"
      />
      <ThemedText type="title" style={styles.name}>
        {name}
      </ThemedText>
      <ActivityIndicator color="#ffffff" style={{ marginTop: 24 }} />
    </View>
  );
}

/**
 * Holds a branded screen over the app for a short, fixed window on launch so the
 * shop name and logo are actually seen. Children mount underneath immediately,
 * so auth and the product feed load during the pause rather than after it.
 */
export function SplashGate({ children }: Readonly<{ children: ReactNode }>) {
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setElapsed(true), MIN_VISIBLE_MS);
    return () => clearTimeout(id);
  }, []);

  return (
    <>
      {children}
      {elapsed ? null : <BrandSplash />}
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: BRAND_BG,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    zIndex: 100,
  },
  logo: { width: 140, height: 140 },
  name: {
    color: '#ffffff',
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 24,
  },
});
