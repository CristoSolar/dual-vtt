import { createSheet, type Avatar } from '@daggerheart/protocol';
import { describe, expect, it } from 'vitest';

import {
  avatarImage,
  cropRect,
  fitAvatar,
  galleryCandidates,
  heritageAncestries,
  loadDraftAvatar,
  saveDraftAvatar,
} from '../src/state/avatar.js';
import { detailsRequest, draftFromSheet } from '../src/state/library.js';
import { buildCharacter, fakeStorage } from './helpers.js';

const mixed = {
  kind: 'mixed' as const,
  first: { ancestryId: 'elf', slot: 'first' as const },
  second: { ancestryId: 'orc', slot: 'second' as const },
};
const upload: Avatar = { kind: 'upload', url: '/uploads/0123456789abcdef01234567.png', crop: { x: 20, y: 80, zoom: 2 } };

describe('avatarImage', () => {
  it('falls back to the ancestry art for a character with no avatar', () => {
    const sheet = createSheet(buildCharacter());
    expect(sheet.avatar).toBeNull();
    expect(avatarImage(sheet)).toEqual({ src: '/images/ancestries/human.png?v=3', crop: null });
  });

  it('draws a gallery portrait, a picked ancestry, or an upload with its crop', () => {
    const sheet = createSheet(buildCharacter());
    expect(avatarImage({ ...sheet, avatar: { kind: 'gallery', id: 'elf-2' } }).src).toBe('/images/avatars/elf-2.webp');
    expect(avatarImage({ ...sheet, avatar: { kind: 'ancestry', ancestryId: 'orc' } }).src).toBe(
      '/images/ancestries/orc.png?v=3',
    );
    const drawn = avatarImage({ ...sheet, avatar: upload });
    expect(drawn.src.endsWith('/uploads/0123456789abcdef01234567.png')).toBe(true);
    expect(drawn.crop).toEqual({ x: 20, y: 80, zoom: 2 });
  });
});

describe('heritage art', () => {
  it('offers both ancestries of a mixed heritage, and drops a pick the heritage lost', () => {
    expect(heritageAncestries(mixed)).toEqual(['elf', 'orc']);
    expect(fitAvatar({ kind: 'ancestry', ancestryId: 'orc' }, mixed)).toEqual({ kind: 'ancestry', ancestryId: 'orc' });
    expect(fitAvatar({ kind: 'ancestry', ancestryId: 'orc' }, { kind: 'single', ancestryId: 'elf' })).toBeNull();
    expect(fitAvatar(upload, { kind: 'single', ancestryId: 'elf' })).toBe(upload);
  });

  it("lists the character's own ancestry portraits first, then everyone else's", () => {
    expect(galleryCandidates(['elf'])).toEqual(['elf-1', 'elf-2', 'elf-3']);
    const all = galleryCandidates(['elf'], true);
    expect(all.slice(0, 3)).toEqual(['elf-1', 'elf-2', 'elf-3']);
    expect(all).toContain('orc-1');
    expect(all.filter((id) => id === 'elf-1')).toHaveLength(1);
  });
});

describe('cropRect', () => {
  it('takes the centred square of a picture when there is no crop', () => {
    expect(cropRect({ width: 400, height: 200 }, null)).toEqual({ x: 100, y: 0, width: 200, height: 200 });
  });

  it('shows the same region as the CSS object-position and scale', () => {
    // 2x zoom of a 200px square, pinned at 20% / 80%: a 100px window.
    expect(cropRect({ width: 200, height: 200 }, { x: 20, y: 80, zoom: 2 })).toEqual({
      x: 20,
      y: 80,
      width: 100,
      height: 100,
    });
  });
});

describe('the wizard draft avatar', () => {
  it('round-trips, clears, and ignores anything that is not an avatar', () => {
    const storage = fakeStorage();
    expect(loadDraftAvatar(storage, 'library')).toBeNull();
    saveDraftAvatar(storage, 'library', upload);
    expect(loadDraftAvatar(storage, 'library')).toEqual(upload);
    saveDraftAvatar(storage, 'library', null);
    expect(loadDraftAvatar(storage, 'library')).toBeNull();
    storage.setItem('daggerheart-vtt:creation-avatar:library', JSON.stringify({ kind: 'upload', url: 'https://x/y.png' }));
    expect(loadDraftAvatar(storage, 'library')).toBeNull();
  });
});

describe('editing the avatar from the library', () => {
  it('sends the avatar only when it changed', () => {
    const sheet = createSheet(buildCharacter());
    const same = detailsRequest(sheet, draftFromSheet(sheet));
    expect(same.ok && 'avatar' in same.request).toBe(false);
    const changed = detailsRequest(sheet, { ...draftFromSheet(sheet), avatar: upload });
    expect(changed.ok && changed.request.avatar).toEqual(upload);
  });
});
