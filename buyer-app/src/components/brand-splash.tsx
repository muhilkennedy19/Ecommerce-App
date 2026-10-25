import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ThemedText } from './themed-text';

/** Matches the native splash background so there is no colour flash on handover. */
const BRAND_BG = '#2E7D32';
const MIN_VISIBLE_MS = 2000;

// Swap this file to change the logo — keep the name so nothing else needs editing.
const LOGO = require('../../assets/images/splash-icon.png');

/** Cache key written by `useShopName`; read directly so the splash needs no Firebase. */
const SHOP_NAME_CACHE_KEY = 'shopName';

function BrandSplash() {
  const [name, setName] = useState<string>(() => Constants.expoConfig?.name ?? 'Shop');

  useEffect(() => {
    // Async callback, so this does not cascade renders on mount.
    AsyncStorage.getItem(SHOP_NAME_CACHE_KEY)
      .then((cached) => {
        if (cached) setName(cached);
      })
      .catch(() => {});
  }, []);

  return (
    <View style={[StyleSheet.absoluteFill, styles.root]}>
      <Image source={LOGO} style={styles.logo} contentFit="contain" />
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
