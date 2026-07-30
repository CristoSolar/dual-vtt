import { createSheet, makeDualityRoll } from '@daggerheart/protocol';
import { resolveActionRoll, rollDuality, seededRng } from '@daggerheart/rules';
import { describe, expect, it } from 'vitest';

import { generateCode, rngForRoll, RoomStore } from '../src/rooms.js';
import { buildCharacter, buildSheet } from './helpers.js';

describe('server-side dice', () => {
  it('produces the identical result to the same call in the rules package', () => {
    const seed = 987;
    const request = {
      label: 'Agility Roll',
      modifiers: 3,
      difficulty: 12,
      advantage: 1,
      disadvantage: 0,
      experiences: [],
    };

    // What the rules package produces on its own with this seed.
    const expected = rollDuality({
      modifiers: request.modifiers,
      advantage: request.advantage,
      disadvantage: request.disadvantage,
      rng: seededRng(seed),
    });
    const expectedOutcome = resolveActionRoll(expected, request.difficulty);

    // What the server produces for the first roll in a room with the same seed.
    const sheet = createSheet(buildCharacter('ranger'));
    const actual = makeDualityRoll(sheet, request, rngForRoll(seed, 0));

    expect(actual.outcome).not.toBeNull();
    expect(actual.outcome?.roll).toEqual(expected);
    expect(actual.outcome?.result.outcome).toBe(expectedOutcome.outcome);
  });

  it('is reproducible: the same (seed, index) always rolls the same dice', () => {
    const first = rollDuality({ rng: rngForRoll(42, 7) });
    const second = rollDuality({ rng: rngForRoll(42, 7) });
    expect(first).toEqual(second);
  });

  it('advances the dice between rolls so a room does not repeat itself', () => {
    const store = new RoomStore();
    const { room, session } = store.createRoom('GM', 555);
    store.claimCharacter(room.state.code, session.token, 'pc', buildSheet('ranger'));

    const roll = () => {
      const outcome = store.apply(room.state.code, session.token, {
        type: 'rollDuality',
        characterId: 'pc',
        request: {
          label: 'Roll',
          modifiers: 0,
          difficulty: 10,
          advantage: 0,
          disadvantage: 0,
          experiences: [],
        },
      });
      const entry = outcome.entries[0];
      if (entry === undefined || entry.kind !== 'duality') throw new Error('no roll');
      return entry.roll;
    };

    const rolls = [roll(), roll(), roll()];
    expect(room.rollCount).toBe(3);
    // Three consecutive rolls must not all be the same dice.
    expect(new Set(rolls.map((r) => `${r.hope}-${r.fear}`)).size).toBeGreaterThan(1);
  });

  it('replays a logged roll from its seed and index for auditing', () => {
    const store = new RoomStore();
    const { room, session } = store.createRoom('GM', 2024);
    store.claimCharacter(room.state.code, session.token, 'pc', buildSheet());

    const outcome = store.apply(room.state.code, session.token, {
      type: 'rollDuality',
      characterId: 'pc',
      request: {
        label: 'Audit',
        modifiers: 0,
        difficulty: 10,
        advantage: 0,
        disadvantage: 0,
        experiences: [],
      },
    });

    const entry = outcome.entries[0];
    if (entry === undefined || entry.kind !== 'duality') throw new Error('no roll');
    // Anyone holding the room's seed can recompute the roll that was logged.
    expect(rollDuality({ rng: rngForRoll(2024, 0) })).toEqual(entry.roll);
  });
});

describe('join codes', () => {
  it('are six characters from an unambiguous alphabet', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateCode();
      expect(code).toHaveLength(6);
      // No 0/O/1/I, which are easy to mishear or mistype.
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    }
  });

  it('never issues the same code to two live rooms', () => {
    const store = new RoomStore();
    const codes = new Set<string>();
    for (let i = 0; i < 30; i++) codes.add(store.createRoom(`GM ${i}`).room.state.code);
    expect(codes.size).toBe(30);
  });
});
