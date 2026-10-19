import type { RollEntry } from '@daggerheart/protocol';
import { describe, expect, it } from 'vitest';

import { groupByColor, notationFor } from '../src/state/diceNotation.js';

const base = { id: 'r1', at: 0, by: 'Ash', label: 'Agility' };

function duality(advantageRoll: number | null, disadvantageRoll: number | null): RollEntry {
  return {
    ...base,
    kind: 'duality',
    roll: {
      hope: 7,
      fear: 3,
      total: 12,
      modifiers: 2,
      critical: false,
      withHope: true,
      advantageRoll,
      disadvantageRoll,
    },
    difficulty: 10,
    outcome: 'successHope',
    experiences: [],
    reaction: false,
    target: null,
  };
}

describe('notationFor', () => {
  it('shows a duality roll as a gold Hope d12 and a violet Fear d12', () => {
    expect(notationFor(duality(null, null))).toEqual([
      { notation: '1d12@7', color: 'hope' },
      { notation: '1d12@3', color: 'fear' },
    ]);
  });

  it('adds the advantage d6 after the duality dice', () => {
    expect(notationFor(duality(5, null))).toEqual([
      { notation: '1d12@7', color: 'hope' },
      { notation: '1d12@3', color: 'fear' },
      { notation: '1d6@5', color: 'neutral' },
    ]);
  });

  it('adds the disadvantage d6 after the duality dice', () => {
    expect(notationFor(duality(null, 2))).toEqual([
      { notation: '1d12@7', color: 'hope' },
      { notation: '1d12@3', color: 'fear' },
      { notation: '1d6@2', color: 'neutral' },
    ]);
  });

  it("shows an adversary attack as the d20 that counted", () => {
    const entry: RollEntry = {
      ...base,
      kind: 'attack',
      roll: { dice: [4, 17], die: 17, modifier: 3, experience: 0, total: 20, critical: false, success: true },
      evasion: 12,
      target: 'Ash',
    };
    expect(notationFor(entry)).toEqual([{ notation: '1d20@17', color: 'neutral' }]);
  });

  it('reads the die size of a critical damage roll off its bonus', () => {
    // A critical adds the dice's maximum: 2d8 → +16, so a 3 and a 2 are d8s.
    const entry: RollEntry = {
      ...base,
      kind: 'damage',
      roll: { rolls: [3, 2], criticalBonus: 16, modifier: 1, total: 22 },
      critical: true,
    };
    expect(notationFor(entry)).toEqual([{ notation: '2d8@3,2', color: 'neutral' }]);
  });

  it('shows ordinary damage on the smallest standard die that could have rolled it', () => {
    const entry: RollEntry = {
      ...base,
      kind: 'damage',
      roll: { rolls: [9, 4, 1], criticalBonus: 0, modifier: 0, total: 14 },
      critical: false,
    };
    expect(notationFor(entry)).toEqual([{ notation: '3d10@9,4,1', color: 'neutral' }]);
  });

  it('shows nothing for flat damage with no dice', () => {
    const entry: RollEntry = {
      ...base,
      kind: 'damage',
      roll: { rolls: [], criticalBonus: 0, modifier: 4, total: 4 },
      critical: false,
    };
    expect(notationFor(entry)).toBeNull();
  });

  it('shows nothing for a fate roll or a chat line', () => {
    expect(notationFor({ ...base, kind: 'fate', value: 4 })).toBeNull();
    expect(notationFor({ id: 'm1', at: 0, by: 'Ash', byId: 'u1', kind: 'message', text: 'hi' })).toBeNull();
  });
});

describe('groupByColor', () => {
  it('merges throws of one colour into a single notation, faces in order', () => {
    expect(
      groupByColor([
        { notation: '1d12@7', color: 'hope' },
        { notation: '1d12@3', color: 'fear' },
        { notation: '1d6@5', color: 'neutral' },
        { notation: '2d8@3,2', color: 'neutral' },
      ]),
    ).toEqual([
      { notation: '1d12@7', color: 'hope' },
      { notation: '1d12@3', color: 'fear' },
      { notation: '1d6+2d8@5,3,2', color: 'neutral' },
    ]);
  });
});
