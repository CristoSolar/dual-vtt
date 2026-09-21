import { applyChoice, validateStep } from '@daggerheart/character';
import { describe, expect, it } from 'vitest';

import {
  clearCreation,
  hasSeenGuide,
  loadCreation,
  markGuideSeen,
  saveCreation,
  type StorageLike,
} from '../src/state/storage.js';
import { buildCreationState, fakeStorage } from './helpers.js';

describe('creation persistence', () => {
  it('resumes an in-progress creation at the same step with choices intact', () => {
    const storage = fakeStorage();

    let state = buildCreationState('bard');
    state = applyChoice(state, {
      type: 'assignTraits',
      traits: { agility: 0, strength: 0, finesse: 0, instinct: 0, presence: 0, knowledge: 0 },
    });
    state = applyChoice(state, { type: 'goToStep', step: 3 });
    saveCreation(storage, 'campaign-1', state);

    const resumed = loadCreation(storage, 'campaign-1');
    expect(resumed).not.toBeNull();
    if (resumed === null) return;

    expect(resumed.currentStep).toBe(3);
    expect(resumed.classId).toBe('bard');
    expect(resumed.subclassId).toBe(state.subclassId);
    expect(resumed.heritage).toEqual(state.heritage);
    expect(resumed.domainCardIds).toEqual(state.domainCardIds);
    expect(validateStep(resumed, 3).ok).toBe(false);
  });

  it('scopes drafts per campaign: one campaign\'s draft never leaks into another', () => {
    const storage = fakeStorage();
    saveCreation(storage, 'campaign-1', buildCreationState('bard'));

    expect(loadCreation(storage, 'campaign-2')).toBeNull();
    expect(loadCreation(storage, 'campaign-1')).not.toBeNull();
  });

  it('returns null when there is nothing saved', () => {
    expect(loadCreation(fakeStorage(), 'campaign-1')).toBeNull();
  });

  it('returns null rather than throwing on a corrupt payload', () => {
    const storage = fakeStorage({ 'daggerheart-vtt:creation:campaign-1': '{not json' });
    expect(loadCreation(storage, 'campaign-1')).toBeNull();
  });

  it('clears a finished creation', () => {
    const storage = fakeStorage();
    saveCreation(storage, 'campaign-1', buildCreationState());
    expect(loadCreation(storage, 'campaign-1')).not.toBeNull();
    clearCreation(storage, 'campaign-1');
    expect(loadCreation(storage, 'campaign-1')).toBeNull();
  });
});

describe('guide seen flag', () => {
  it('is false until marked, then true, per account', () => {
    const storage = fakeStorage();
    expect(hasSeenGuide(storage, 'u1')).toBe(false);
    markGuideSeen(storage, 'u1');
    expect(hasSeenGuide(storage, 'u1')).toBe(true);
    expect(hasSeenGuide(storage, 'u2')).toBe(false);
  });

  it('treats a throwing storage as not seen and does not throw on write', () => {
    const broken: StorageLike = {
      getItem: () => { throw new Error('nope'); },
      setItem: () => { throw new Error('nope'); },
      removeItem: () => {},
    };
    expect(hasSeenGuide(broken, 'u1')).toBe(false);
    expect(() => markGuideSeen(broken, 'u1')).not.toThrow();
  });
});

describe('an unreadable draft', () => {
  it('is set aside instead of being written over', () => {
    const storage = fakeStorage();
    const key = 'daggerheart-vtt:creation:c-1';
    storage.setItem(key, '{ this is not a creation state');

    // The wizard starts fresh...
    expect(loadCreation(storage, 'c-1')).toBeNull();
    // ...but the draft it could not read is still recoverable by hand.
    expect(storage.getItem(`${key}:unreadable`)).toBe('{ this is not a creation state');
  });

  it('does not throw when the copy cannot be written', () => {
    const readOnly: StorageLike = {
      getItem: () => 'not json',
      setItem: () => { throw new Error('quota'); },
      removeItem: () => {},
    };
    expect(() => loadCreation(readOnly, 'c-1')).not.toThrow();
    expect(loadCreation(readOnly, 'c-1')).toBeNull();
  });
});
