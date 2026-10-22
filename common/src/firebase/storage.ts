import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { getFirebaseStorage } from './client';

/**
 * Upload a local file (e.g. an image/document URI from expo-image-picker /
 * expo-document-picker) to Cloud Storage and return its download URL.
 */
export async function uploadFileAsync(
  path: string,
  localUri: string,
  contentType?: string,
): Promise<string> {
  const response = await fetch(localUri);
  const blob = await response.blob();
  const storageRef = ref(getFirebaseStorage(), path);
  await uploadBytes(storageRef, blob, contentType ? { contentType } : undefined);
  return getDownloadURL(storageRef);
}
