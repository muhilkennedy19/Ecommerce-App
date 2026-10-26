import { getImage } from '@common';
import * as FileSystem from 'expo-file-system/legacy';
import { useEffect, useState } from 'react';

// On-disk cache of product images. Each `images/{id}` doc is written once to a file named
// by its id and served as a file:// URI thereafter. Because a new upload always gets a new
// id, the cache never goes stale — we only fetch (and write) when the id isn't on disk yet.
// Using the filesystem (not AsyncStorage) avoids the ~6 MB AsyncStorage quota that silently
// drops images once a shop has more than a handful of them.
const DIR = FileSystem.cacheDirectory + 'product-images/';
// imageId -> file:// URI, for instant resolution on remount within a session.
const memory = new Map<string, string>();
let dirReady: Promise<unknown> | null = null;

function ensureDir(): Promise<unknown> {
  if (!dirReady) dirReady = FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
  return dirReady;
}

/**
 * Resolve an `images/{id}` doc to a local file:// URI, cached on disk by id. The resolved
 * URI lives in component state so the view re-renders as soon as THIS image is ready (not
 * dependent on some later unrelated re-render). Returns null until available.
 */
export function useCachedImage(imageId?: string | null): string | null {
  const [uri, setUri] = useState<string | null>(() => (imageId ? (memory.get(imageId) ?? null) : null));

  useEffect(() => {
    let active = true;
    // All state updates happen inside this async task (never synchronously in the effect body).
    (async () => {
      if (!imageId) {
        if (active) setUri(null);
        return;
      }
      const cached = memory.get(imageId);
      if (cached) {
        if (active) setUri(cached);
        return;
      }
      try {
        await ensureDir();
        const path = DIR + imageId;
        const info = await FileSystem.getInfoAsync(path);
        let out: string;
        if (info.exists) {
          out = info.uri;
        } else {
          const img = await getImage(imageId);
          if (!img) return;
          // Decode the base64 payload straight to disk; we never hold the data URI in memory.
          await FileSystem.writeAsStringAsync(path, img.data, { encoding: FileSystem.EncodingType.Base64 });
          out = path;
        }
        memory.set(imageId, out);
        if (active) setUri(out);
      } catch {
        // leave null → caller shows placeholder; we'll retry on next mount
      }
    })();
    return () => {
      active = false;
    };
  }, [imageId]);

  return uri;
}
