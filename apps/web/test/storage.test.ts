import { applyChoice, validateStep } from '@daggerheart/character';
import { describe, expect, it } from 'vitest';

import { createSheet, markSheetStress } from '../src/state/sheet.js';
import {
  clearCreation,
  IN_PROGRESS_KEY,
  loadActiveId,
  loadCharacters,
  loadCreation,
  removeCharacter,
  SAVED_CHARACTERS_KEY,
  saveActiveId,
  saveCharacters,
  saveCreation,
  upsertCharacter,
} from '../src/state/storage.js';
import { buildCharacter, buildCreationState, fakeStorage } from './helpers.js';

describe('creation persistence', () => {
  it('resumes an in-progress creation at the same step with choices intact', () => {
    const storage = fakeStorage();

    // Part-way through the wizard: class and heritage chosen, traits not yet.
    let state = buildCreationState('bard');
    state = applyChoice(state, { type: 'assignTraits', traits: {
      agility: 0, strength: 0, finesse: 0, instinct: 0, presence: 0, knowledge: 0,
    } });
    state = applyChoice(state, { type: 'goToStep', step: 3 });
    saveCreation(storage, state);

    const resumed = loadCreation(storage);
    expect(resumed).not.toBeNull();
    if (resumed === null) return;

    expect(resumed.currentStep).toBe(3);
    expect(resumed.classId).toBe('bard');
    expect(resumed.subclassId).toBe(state.subclassId);
    expect(resumed.heritage).toEqual(state.heritage);
    expect(resumed.domainCardIds).toEqual(state.domainCardIds);
    // The invalid trait spread survives the round trip and still fails validation.
    expect(validateStep(resumed, 3).ok).toBe(false);
  });

  it('returns null when there is nothing saved', () => {
    expect(loadCreation(fakeStorage())).toBeNull();
  });

  it('returns null rather than throwing on a corrupt payload', () => {
    const storage = fakeStorage({ [IN_PROGRESS_KEY]: '{not json' });
    expect(loadCreation(storage)).toBeNull();
  });

  it('clears a finished creation', () => {
    const storage = fakeStorage();
    saveCreation(storage, buildCreationState());
    expect(loadCreation(storage)).not.toBeNull();
    clearCreation(storage);
    expect(loadCreation(storage)).toBeNull();
  });
});

describe('character persistence', () => {
  it('round-trips a saved character with its play state', () => {
    const storage = fakeStorage();
    const sheet = markSheetStress(createSheet(buildCharacter('wizard')), 2).sheet;

    saveCharacters(storage, upsertCharacter([], 'pc-1', sheet, 1000));
    const loaded = loadCharacters(storage);

    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.id).toBe('pc-1');
    expect(loaded[0]?.sheet.stressMarked).toBe(2);
    expect(loaded[0]?.sheet.character.classId).toBe('wizard');
    expect(loaded[0]?.sheet.character.name).toBe('Test Character');
  });

  it('sorts characters newest first', () => {
    const storage = fakeStorage();
    const sheet = createSheet(buildCharacter());
    let saved = upsertCharacter([], 'old', sheet, 1000);
    saved = upsertCharacter(saved, 'new', sheet, 2000);
    saveCharacters(storage, saved);

    expect(loadCharacters(storage).map((c) => c.id)).toEqual(['new', 'old']);
  });

  it('replaces an existing character rather than duplicating it', () => {
    const sheet = createSheet(buildCharacter());
    let saved = upsertCharacter([], 'pc-1', sheet, 1000);
    saved = upsertCharacter(saved, 'pc-1', markSheetStress(sheet).sheet, 2000);

    expect(saved).toHaveLength(1);
    expect(saved[0]?.sheet.stressMarked).toBe(1);
  });

  it('drops unreadable entries instead of failing the whole load', () => {
    const sheet = createSheet(buildCharacter());
    const good = upsertCharacter([], 'good', sheet, 1000);
    const storage = fakeStorage({
      [SAVED_CHARACTERS_KEY]: JSON.stringify([...good, { id: 'broken', sheet: { nope: true } }]),
    });

    const loaded = loadCharacters(storage);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.id).toBe('good');
  });

  it('returns an empty list for missing or corrupt storage', () => {
    expect(loadCharacters(fakeStorage())).toEqual([]);
    expect(loadCharacters(fakeStorage({ [SAVED_CHARACTERS_KEY]: 'garbage' }))).toEqual([]);
  });

  it('removes a character by id', () => {
    const sheet = createSheet(buildCharacter());
    const saved = upsertCharacter(upsertCharacter([], 'a', sheet, 1), 'b', sheet, 2);
    expect(removeCharacter(saved, 'a').map((c) => c.id)).toEqual(['b']);
  });

  it('tracks which character is active', () => {
    const storage = fakeStorage();
    expect(loadActiveId(storage)).toBeNull();
    saveActiveId(storage, 'pc-1');
    expect(loadActiveId(storage)).toBe('pc-1');
    saveActiveId(storage, null);
    expect(loadActiveId(storage)).toBeNull();
  });
});
