import { subscribeShop } from '@common';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import { shopId } from '@/lib/config';

const CACHE_KEY = 'shopName';
const DEFAULT_NAME = 'Shop';

/**
 * The admin-configured shop name, resolved instantly from an AsyncStorage cache
 * and then kept live via `subscribeShop`. The cache is refreshed whenever the
 * live value changes so the header title never flashes a placeholder.
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
    });

    return () => {
      active = false;
      unsub();
    };
  }, []);

  return name;
}
