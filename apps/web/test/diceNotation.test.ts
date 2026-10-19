import type { RollEntry } from '@daggerheart/protocol';
import { describe, expect, it } from 'vitest';

import { groupByColor, hasDice, joinBurst, notationFor, previewRoll } from '../src/state/diceNotation.js';

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

  it('draws damage on the die size the entry carries', () => {
    const entry: RollEntry = {
      ...base,
      kind: 'damage',
      roll: { rolls: [3, 2], die: 8, criticalBonus: 0, modifier: 1, total: 6 },
      critical: false,
    };
    expect(notationFor(entry)).toEqual([{ notation: '2d8@3,2', color: 'neutral' }]);
  });

  it('reads the die size of an older critical damage roll off its bonus', () => {
    // A critical adds the dice's maximum: 2d8 → +16, so a 3 and a 2 are d8s.
    const entry: RollEntry = {
      ...base,
      kind: 'damage',
      roll: { rolls: [3, 2], die: null, criticalBonus: 16, modifier: 1, total: 22 },
      critical: true,
    };
    expect(notationFor(entry)).toEqual([{ notation: '2d8@3,2', color: 'neutral' }]);
  });

  it('shows older ordinary damage on the smallest standard die that could have rolled it', () => {
    const entry: RollEntry = {
      ...base,
      kind: 'damage',
      roll: { rolls: [9, 4, 1], die: null, criticalBonus: 0, modifier: 0, total: 14 },
      critical: false,
    };
    expect(notationFor(entry)).toEqual([{ notation: '3d10@9,4,1', color: 'neutral' }]);
  });

  it('shows nothing for older damage whose die size cannot be told', () => {
    const entry: RollEntry = {
      ...base,
      kind: 'damage',
      roll: { rolls: [23], die: null, criticalBonus: 0, modifier: 0, total: 23 },
      critical: false,
    };
    expect(notationFor(entry)).toBeNull();
  });

  it('shows nothing for flat damage with no dice', () => {
    const entry: RollEntry = {
      ...base,
      kind: 'damage',
      roll: { rolls: [], die: null, criticalBonus: 0, modifier: 4, total: 4 },
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

describe('hasDice', () => {
  const message: RollEntry = { kind: 'message', id: 'm1', at: 0, by: 'Ash', byId: 'acc-ash', text: 'nice!' };

  it('is true when any entry has dice to throw', () => {
    expect(hasDice([message, duality(null, null)])).toBe(true);
  });

  it('is false for a chat line alone, so it cannot replace dice still on screen', () => {
    expect(hasDice([message])).toBe(false);
    expect(hasDice([])).toBe(false);
  });
});

describe('joinBurst', () => {
  const damage = (at: number, by = 'Ash'): RollEntry => ({
    kind: 'damage',
    id: `d${at}`,
    at,
    by,
    label: 'Broadsword',
    roll: { rolls: [6], modifier: 0, criticalBonus: 0, total: 6, die: 8 },
    critical: false,
  });
  const attack = { id: 'r1', entries: [duality(null, null)] };

  it("adds an attack's damage to the action roll it follows", () => {
    expect(joinBurst(attack, { id: 'd500', entries: [damage(500)] })).toEqual({
      id: 'r1-d500',
      entries: [duality(null, null), damage(500)],
    });
  });

  it('starts a fresh throw for a later roll, another roller, or nothing before it', () => {
    const later = { id: 'd5000', entries: [damage(5000)] };
    const someoneElse = { id: 'd500', entries: [damage(500, 'Brin')] };
    expect(joinBurst(attack, later)).toBe(later);
    expect(joinBurst(attack, someoneElse)).toBe(someoneElse);
    expect(joinBurst(null, later)).toBe(later);
  });
});

describe('previewRoll', () => {
  it('throws a Hope and a Fear die', () => {
    const preview = previewRoll();
    expect(preview.entries.flatMap((entry) => notationFor(entry) ?? []).map((d) => d.color)).toEqual([
      'hope',
      'fear',
    ]);
  });
});
