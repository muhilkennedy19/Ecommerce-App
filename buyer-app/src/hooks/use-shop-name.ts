import { getImage, subscribeShop } from '@common';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import { shopId } from '@/lib/config';

const CACHE_KEY = 'shopName';
/** Resolved `data:` URI of the admin-uploaded logo. */
export const LOGO_KEY = 'shopLogo';
/** Image id the cached URI was built from, so we only refetch when it changes. */
const LOGO_ID_KEY = 'shopLogoId';
const DEFAULT_NAME = 'Buyer';

/**
 * Mirror the admin-uploaded logo into AsyncStorage. The launch screen renders
 * before Firebase has connected, so it reads this cache rather than fetching.
 */
async function syncLogo(imageId: string | null): Promise<void> {
  try {
    const knownId = await AsyncStorage.getItem(LOGO_ID_KEY);
    if (!imageId) {
      // Logo removed in settings — drop the cache so the bundled default returns.
      if (knownId) await AsyncStorage.multiRemove([LOGO_KEY, LOGO_ID_KEY]);
      return;
    }
    if (knownId === imageId) return; // ids are immutable, so nothing to do
    const img = await getImage(imageId);
    if (!img) return;
    await AsyncStorage.multiSet([
      [LOGO_KEY, `data:${img.mime};base64,${img.data}`],
      [LOGO_ID_KEY, imageId],
    ]);
  } catch {
    // Best-effort: a missing logo just falls back to the bundled asset.
  }
}

/**
 * The admin-configured shop name, resolved instantly from an AsyncStorage cache
 * and then kept live via `subscribeShop`. The cache is refreshed whenever the
 * live value changes so the header title never flashes a placeholder.
 *
 * Also keeps the launch-screen logo cache in sync off the same subscription.
 */
export function useShopName(): string {
  const [name, setName] = useState<string>(DEFAULT_NAME);

  useEffect(() => {
    let active = true;

    // Instant: show the last-known name from the cache before the first snapshot.
    AsyncStorage.getItem(CACHE_KEY)
      .then((cached) => {
        if (active && cached) setName(cached);
      })
      .catch(() => {});

    // Live: update + refresh the cache on every change.
    const unsub = subscribeShop(shopId, (s) => {
      if (s?.name) {
        setName(s.name);
        AsyncStorage.setItem(CACHE_KEY, s.name).catch(() => {});
      }
      void syncLogo(s?.logoImageId ?? null);
    });

    return () => {
      active = false;
      unsub();
    };
  }, []);

  return name;
}

/**
 * The admin-uploaded shop logo as a `data:` URI (the same cached value the launch splash
 * uses). Served from AsyncStorage so it renders reliably inside the navigation header — a
 * context where `file://` sources can fail to paint. Null until a logo is uploaded + synced.
 */
export function useShopLogo(): string | null {
  const [logo, setLogo] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(LOGO_KEY)
      .then((v) => {
        if (active) setLogo(v);
      })
      .catch(() => {});
    const unsub = subscribeShop(shopId, (s) => {
      void (async () => {
        await syncLogo(s?.logoImageId ?? null);
        const v = await AsyncStorage.getItem(LOGO_KEY);
        if (active) setLogo(v);
      })();
    });
    return () => {
      active = false;
      unsub();
    };
  }, []);

  return logo;
}
