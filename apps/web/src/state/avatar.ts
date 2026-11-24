import { AvatarSchema, type Avatar, type AvatarCrop, type SheetState } from '@daggerheart/protocol';
import { srd } from '@daggerheart/srd-data';

import { t } from '../i18n/index.js';

import { artUrl } from './art.js';
import type { StorageLike } from './storage.js';
import { SERVER_URL } from './useCampaign.js';

/**
 * Character portraits. A sheet's `avatar` is null (its ancestry's art), an ancestry
 * picked outright (for a mixed heritage), a gallery portrait, or an upload. Every
 * place that draws a character — the map token, the library card, the sheet
 * header, the GM's party list — resolves it through `avatarImage`.
 */

/** Gallery portraits per ancestry: `public/images/avatars/<ancestryId>-<n>.webp`. */
export const GALLERY_PER_ANCESTRY = 3;
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export interface AvatarImage {
  src: string;
  /** How an upload sits in its circle; null draws the picture centred, unzoomed. */
  crop: AvatarCrop | null;
}

type Heritage = SheetState['character']['heritage'];

/** The ancestries whose art a heritage may use: one, or both of a mixed one. */
export function heritageAncestries(heritage: Heritage): string[] {
  return heritage.kind === 'single'
    ? [heritage.ancestryId]
    : [...new Set([heritage.first.ancestryId, heritage.second.ancestryId])];
}

export function galleryUrl(id: string): string {
  return `/images/avatars/${id}.webp`;
}

/**
 * The gallery ids to offer, the given ancestries first. There is no manifest: the
 * art arrives a file at a time, so the picker tries each candidate and drops the
 * ones that fail to load.
 */
export function galleryCandidates(first: readonly string[], all = false): string[] {
  const ancestries = all ? [...first, ...srd().ancestries.map((a) => a.id).filter((id) => !first.includes(id))] : first;
  return ancestries.flatMap((id) => Array.from({ length: GALLERY_PER_ANCESTRY }, (_, i) => `${id}-${i + 1}`));
}

/** The picture to draw for a sheet; the ancestry art when nothing was picked. */
export function avatarImage(sheet: SheetState): AvatarImage {
  return resolveAvatar(sheet.avatar, sheet.character.heritage);
}

export function resolveAvatar(avatar: Avatar | null, heritage: Heritage): AvatarImage {
  if (avatar === null) return { src: artUrl('ancestries', heritageAncestries(heritage)[0] ?? ''), crop: null };
  switch (avatar.kind) {
    case 'ancestry':
      return { src: artUrl('ancestries', avatar.ancestryId), crop: null };
    case 'gallery':
      return { src: galleryUrl(avatar.id), crop: null };
    case 'upload':
      return { src: `${SERVER_URL}${avatar.url}`, crop: avatar.crop ?? null };
  }
}

/** CSS for an `<img>` filling a circle with `object-fit: cover`. */
export function cropStyle(crop: AvatarCrop | null): { objectPosition?: string; transform?: string; transformOrigin?: string } {
  if (crop === null) return {};
  const at = `${crop.x}% ${crop.y}%`;
  return { objectPosition: at, transform: `scale(${crop.zoom})`, transformOrigin: at };
}

/**
 * The square of the source image a circle shows — the same region `cropStyle`
 * shows in CSS — for the canvas, which crops by source rectangle instead.
 */
export function cropRect(
  natural: { width: number; height: number },
  crop: AvatarCrop | null,
): { x: number; y: number; width: number; height: number } {
  const { x = 50, y = 50, zoom = 1 } = crop ?? {};
  const side = Math.min(natural.width, natural.height) / zoom;
  return {
    x: ((natural.width - side) * x) / 100,
    y: ((natural.height - side) * y) / 100,
    width: side,
    height: side,
  };
}

/** Sends a portrait to `POST /uploads/avatar` and returns the path it is served at. */
export async function uploadAvatar(file: File, token: string | null): Promise<string> {
  if (token === null || token === '') throw new Error(t('auth.sessionExpired'));
  if (!AVATAR_TYPES.includes(file.type)) throw new Error(t('avatar.badType'));
  if (file.size > MAX_AVATAR_BYTES) throw new Error(t('avatar.tooLarge'));

  const response = await fetch(`${SERVER_URL}/uploads/avatar`, {
    method: 'POST',
    headers: { 'content-type': file.type, authorization: `Bearer ${token}` },
    body: file,
  });
  if (response.status === 401) throw new Error(t('auth.sessionExpired'));
  if (response.status === 413) throw new Error(t('avatar.tooLarge'));
  if (!response.ok) throw new Error(t('avatar.badType'));
  const body: unknown = await response.json().catch(() => null);
  const url = typeof body === 'object' && body !== null && 'url' in body ? String(body.url) : '';
  // The same check the sheet's schema makes, so a bad answer fails here, not on save.
  const parsed = AvatarSchema.safeParse({ kind: 'upload', url });
  if (!parsed.success) throw new Error(t('avatar.badType'));
  return url;
}

// --- the wizard's pick, kept beside its draft ----------------------------------

const draftAvatarKey = (scope: string): string => `daggerheart-vtt:creation-avatar:${scope}`;

/** The avatar picked in an unfinished wizard, or null (ancestry art). Validated: storage is a trust boundary. */
export function loadDraftAvatar(storage: StorageLike, scope: string): Avatar | null {
  const raw = storage.getItem(draftAvatarKey(scope));
  if (raw === null) return null;
  try {
    const parsed = AvatarSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveDraftAvatar(storage: StorageLike, scope: string, avatar: Avatar | null): void {
  if (avatar === null) storage.removeItem(draftAvatarKey(scope));
  else storage.setItem(draftAvatarKey(scope), JSON.stringify(avatar));
}

/**
 * Drops an ancestry pick the heritage no longer has (the wizard's step 2 can change
 * after step 9), so the character falls back to its own ancestry's art.
 */
export function fitAvatar(avatar: Avatar | null, heritage: Heritage): Avatar | null {
  if (avatar?.kind !== 'ancestry') return avatar;
  return heritageAncestries(heritage).includes(avatar.ancestryId) ? avatar : null;
}
