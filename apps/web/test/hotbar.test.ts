import { describe, expect, it } from 'vitest';

import { emptyHotbar, rollRequestFor, setSlot } from '../src/state/hotbar.js';
import { createSheet, sendToVault } from '../src/state/sheet.js';
import { loadHotbar, saveHotbar } from '../src/state/storage.js';
import { buildCharacter, fakeStorage } from './helpers.js';

const KEY = 'daggerheart-vtt:hotbar:camp-1:acct-1';

describe('hotbar persistence', () => {
  it('reads corrupt JSON as an empty bar', () => {
    const storage = fakeStorage({ [KEY]: '{not json' });
    expect(loadHotbar(storage, 'camp-1', 'acct-1')).toEqual(Array(10).fill(null));
  });

  it('reads a bar of the wrong length or with an unknown slot as an empty bar', () => {
    const short = fakeStorage({ [KEY]: JSON.stringify([null, null]) });
    expect(loadHotbar(short, 'camp-1', 'acct-1')).toEqual(emptyHotbar());

    const bogus = Array(10).fill(null);
    bogus[0] = { kind: 'spell', name: 'x' };
    const unknown = fakeStorage({ [KEY]: JSON.stringify(bogus) });
    expect(loadHotbar(unknown, 'camp-1', 'acct-1')).toEqual(emptyHotbar());
  });

  it('round-trips a bar, scoped per campaign and account', () => {
    const storage = fakeStorage();
    const bar = setSlot(emptyHotbar(), 2, { kind: 'trait', trait: 'agility' });
    saveHotbar(storage, 'camp-1', 'acct-1', bar);

    expect(loadHotbar(storage, 'camp-1', 'acct-1')).toEqual(bar);
    expect(loadHotbar(storage, 'camp-2', 'acct-1')).toEqual(emptyHotbar());
    expect(loadHotbar(storage, 'camp-1', 'acct-2')).toEqual(emptyHotbar());
  });
});

describe('setSlot', () => {
  it('fills and clears one slot without touching the rest', () => {
    const bar = setSlot(emptyHotbar(), 0, { kind: 'experience', name: 'Sailor' });
    expect(bar[0]).toEqual({ kind: 'experience', name: 'Sailor' });
    expect(bar.slice(1)).toEqual(Array(9).fill(null));
    expect(setSlot(bar, 0, null)).toEqual(emptyHotbar());
  });

  it('leaves the bar unchanged for an index outside 0–9', () => {
    const bar = setSlot(emptyHotbar(), 4, { kind: 'trait', trait: 'presence' });
    for (const index of [-1, 10, 1.5, Number.NaN]) {
      expect(setSlot(bar, index, { kind: 'trait', trait: 'agility' })).toBe(bar);
    }
  });
});

describe('rollRequestFor', () => {
  it('rolls a trait with that trait as the modifier', () => {
    const sheet = createSheet(buildCharacter('bard'));
    const roll = rollRequestFor({ kind: 'trait', trait: 'presence' }, sheet);
    expect(roll?.modifiers).toBe(sheet.character.traits.presence);
    expect(roll?.damage).toBeNull();
  });

  it('rolls an equipped weapon as an attack that carries its damage', () => {
    const sheet = createSheet(buildCharacter('guardian'));
    const roll = rollRequestFor({ kind: 'weapon', slot: 'primary' }, sheet);
    expect(roll).not.toBeNull();
    expect(roll?.damage?.proficiency).toBe(sheet.character.proficiency);
  });

  it('is null for a weapon slot with nothing equipped', () => {
    const base = createSheet(buildCharacter('guardian'));
    const sheet = {
      ...base,
      character: { ...base.character, equipment: { ...base.character.equipment, secondaryWeaponId: null } },
    };
    expect(rollRequestFor({ kind: 'weapon', slot: 'secondary' }, sheet)).toBeNull();
  });

  it('rolls a card in the loadout, and is null once it is in the vault', () => {
    const sheet = createSheet(buildCharacter('bard'));
    const cardId = sheet.loadout[0];
    expect(cardId).toBeDefined();
    if (cardId === undefined) return;

    expect(rollRequestFor({ kind: 'card', cardId }, sheet)).not.toBeNull();
    const vaulted = sendToVault(sheet, cardId).sheet;
    expect(vaulted.vault).toContain(cardId);
    expect(rollRequestFor({ kind: 'card', cardId }, vaulted)).toBeNull();
  });

  it('preselects an experience the character has, and is null for one they do not', () => {
    const sheet = createSheet(buildCharacter('bard'));
    const name = Object.keys(sheet.character.experiences)[0];
    expect(name).toBeDefined();
    if (name === undefined) return;

    const roll = rollRequestFor({ kind: 'experience', name }, sheet);
    expect(roll?.presetExperiences).toEqual([name]);
    // The experience is a Hope spend in the dialog, never a free flat bonus.
    expect(roll?.modifiers).toBe(0);
    expect(rollRequestFor({ kind: 'experience', name: 'Not one of mine' }, sheet)).toBeNull();
  });
});
