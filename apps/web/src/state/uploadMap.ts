import type { SceneImage } from '@daggerheart/protocol';

import { SERVER_URL } from './useCampaign.js';

/** Images the server will accept. It re-checks the bytes regardless of this list. */
export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Reads an image's natural size in the browser, for the scene's bounds. */
async function readDimensions(file: File): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error('That file is not a readable image.'));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Uploads a battle map and returns the scene image to attach.
 *
 * The body is the raw file, so there is no multipart parsing on either side. These
 * client-side checks are for a fast error message only — the server validates the
 * bytes itself and is the one that decides.
 */
export async function uploadMapImage(file: File): Promise<SceneImage> {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new Error('Maps must be a PNG, JPEG, GIF, or WEBP image.');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('That image is larger than the 20 MB limit.');
  }

  const { width, height } = await readDimensions(file);

  const response = await fetch(`${SERVER_URL}/uploads`, {
    method: 'POST',
    headers: { 'content-type': file.type },
    body: file,
  });

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message =
      typeof body === 'object' && body !== null && 'error' in body
        ? String((body as { error: unknown }).error)
        : 'The server rejected that image.';
    throw new Error(message);
  }

  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null || !('url' in body)) {
    throw new Error('The server sent an unreadable response.');
  }

  return { url: String((body as { url: unknown }).url), width, height };
}
