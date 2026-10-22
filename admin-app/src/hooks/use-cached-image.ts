import { getImage } from '@common';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

// Process-lifetime cache so the same image isn't decoded/fetched twice per session.
const memory = new Map<string, string>();

/**
 * Resolve an `images/{id}` doc to a `data:` URI, cached by id. Because a new upload
 * always gets a new id, the cache never goes stale — we only fetch when the id changes.
 */
export function useCachedImage(imageId?: string | null): string | null {
  const [uri, setUri] = useState<string | null>(imageId ? (memory.get(imageId) ?? null) : null);

  useEffect(() => {
    let active = true;
    if (!imageId) {
      setUri(null);
      return;
    }
    if (memory.has(imageId)) {
      setUri(memory.get(imageId)!);
      return;
    }
    const key = `img:${imageId}`;
    (async () => {
      try {
        const cached = await AsyncStorage.getItem(key);
        if (cached) {
          memory.set(imageId, cached);
          if (active) setUri(cached);
          return;
        }
        const img = await getImage(imageId);
        if (!img) return;
        const dataUri = `data:${img.mime};base64,${img.data}`;
        memory.set(imageId, dataUri);
        AsyncStorage.setItem(key, dataUri).catch(() => {});
        if (active) setUri(dataUri);
      } catch {
        // leave uri null → caller shows placeholder
      }
    })();
    return () => {
      active = false;
    };
  }, [imageId]);

  return uri;
}
