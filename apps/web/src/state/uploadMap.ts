import type { SceneImage } from '@daggerheart/protocol';

import { t } from '../i18n/index.js';

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
 * Uploads an image (a battle map background, or a token portrait) and returns the
 * `{url, width, height}` to attach. The endpoint itself has no notion of "map" vs
 * "token" — that distinction is purely what the caller does with the result.
 *
 * The body is the raw file, so there is no multipart parsing on either side. These
 * client-side checks are for a fast error message only — the server validates the
 * bytes itself and is the one that decides.
 *
 * Writing to the server's disk needs an account, so the session token travels with
 * the file the same way it does on every other write.
 */
export async function uploadImage(file: File, token: string | null): Promise<SceneImage> {
  if (token === null || token === '') {
    throw new Error('Sign in again before uploading.');
  }

  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new Error('Maps must be a PNG, JPEG, GIF, or WEBP image.');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('That image is larger than the 20 MB limit.');
  }

  const { width, height } = await readDimensions(file);
  return { url: await postUpload(file, token), width, height };
}

/** Playlist tracks the server will accept. It re-checks the bytes regardless. */
export const ACCEPTED_AUDIO_TYPES = ['audio/ogg', 'audio/mpeg', 'audio/mp3'];
const AUDIO_EXTENSION = /\.(ogg|mp3)$/i;

/**
 * Uploads a playlist track and returns the path it is served from. Some browsers
 * report no type for an .ogg, so the extension is enough to try; the server
 * decides from the bytes either way.
 */
export async function uploadAudio(file: File, token: string | null): Promise<string> {
  if (token === null || token === '') throw new Error(t('auth.sessionExpired'));
  if (!ACCEPTED_AUDIO_TYPES.includes(file.type) && !AUDIO_EXTENSION.test(file.name)) {
    throw new Error(t('gm.playlist.badType'));
  }
  if (file.size > MAX_UPLOAD_BYTES) throw new Error(t('gm.playlist.tooLarge'));
  return postUpload(file, token);
}

/** Sends a file's raw bytes to `POST /uploads` and returns the URL it is served at. */
async function postUpload(file: File, token: string): Promise<string> {
  const response = await fetch(`${SERVER_URL}/uploads`, {
    method: 'POST',
    headers: { 'content-type': file.type, authorization: `Bearer ${token}` },
    body: file,
  });

  // Sessions are in memory, so a server restart invalidates a token the tab is
  // still holding. Say that, instead of passing the server's bare "unauthorized".
  if (response.status === 401) {
    throw new Error(t('auth.sessionExpired'));
  }

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message =
      typeof body === 'object' && body !== null && 'error' in body
        ? String((body as { error: unknown }).error)
        : 'The server rejected that file.';
    throw new Error(message);
  }

  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null || !('url' in body)) {
    throw new Error('The server sent an unreadable response.');
  }

  return String((body as { url: unknown }).url);
}
