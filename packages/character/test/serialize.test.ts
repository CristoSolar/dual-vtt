import { describe, expect, it } from 'vitest';

import {
  applyChoice,
  createInitialState,
  deserialize,
  finalize,
  serialize,
  SERIALIZATION_VERSION,
} from '../src/index.js';
import { buildCharacter } from './helpers.js';

describe('serialize / deserialize', () => {
  it('round-trips an in-progress creation', () => {
    let state = createInitialState();
    state = applyChoice(state, { type: 'chooseClass', classId: 'rogue' });
    state = applyChoice(state, { type: 'chooseSubclass', subclassId: 'nightwalker' });
    state = applyChoice(state, { type: 'chooseAncestry', ancestryId: 'katari' });

    const restored = deserialize(serialize(state));
    expect(restored).toEqual(state);
  });

  it('round-trips a complete creation that still finalizes', () => {
    const state = buildCharacter('seraph');
    const restored = deserialize(serialize(state));
    expect(restored).toEqual(state);
    expect(finalize(restored)).toEqual(finalize(state));
  });

  it('rejects a payload from another version', () => {
    const payload = JSON.stringify({
      version: SERIALIZATION_VERSION + 1,
      state: createInitialState(),
    });
    expect(() => deserialize(payload)).toThrow(/unsupported version/);
  });

  it('rejects a structurally invalid payload rather than trusting it', () => {
    const payload = JSON.stringify({
      version: SERIALIZATION_VERSION,
      state: { currentStep: 99 },
    });
    expect(() => deserialize(payload)).toThrow();
  });

  it('rejects malformed JSON', () => {
    expect(() => deserialize('{')).toThrow();
    expect(() => deserialize('"a string"')).toThrow(/not an object/);
  });
});
