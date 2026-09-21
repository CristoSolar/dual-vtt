import { describe, expect, it } from 'vitest';

import {
  MAX_CONSECUTIVE_SHORT_RESTS,
  MOVES_PER_REST,
  isMoveAvailable,
  mustRestLong,
  resolveDowntimeMove,
  restFear,
  scriptedRng,
} from '../src/index.js';

describe('rest cadence', () => {
  it('forces a long rest after three short ones in a row', () => {
    expect(mustRestLong(0)).toBe(false);
    expect(mustRestLong(MAX_CONSECUTIVE_SHORT_RESTS - 1)).toBe(false);
    expect(mustRestLong(MAX_CONSECUTIVE_SHORT_RESTS)).toBe(true);
  });

  it('offers working on a project only during a long rest', () => {
    expect(isMoveAvailable('workOnProject', 'short')).toBe(false);
    expect(isMoveAvailable('workOnProject', 'long')).toBe(true);
    expect(isMoveAvailable('prepare', 'short')).toBe(true);
  });

  it('gives every character two moves', () => {
    expect(MOVES_PER_REST).toBe(2);
  });
});

describe('the Fear a rest pays the GM', () => {
  it('is 1d4 for a short rest, whatever the party size', () => {
    expect(restFear('short', 4, scriptedRng([[3, 4]]))).toBe(3);
    expect(restFear('short', 1, scriptedRng([[3, 4]]))).toBe(3);
  });

  it('is 1d4 plus one per PC for a long rest', () => {
    expect(restFear('long', 4, scriptedRng([[3, 4]]))).toBe(7);
    expect(restFear('long', 0, scriptedRng([[3, 4]]))).toBe(3);
  });
});

describe('downtime moves', () => {
  const rng = scriptedRng([[3, 4]]);

  it('restores 1d4 plus tier on a short rest', () => {
    // A level-5 character is tier 3, so a 3 on the die restores 6.
    const effect = resolveDowntimeMove({ move: 'tendToWounds', kind: 'short', level: 5, rng });
    expect(effect.roll).toBe(3);
    expect(effect.amount).toBe(6);
  });

  it('restores the whole track on a long rest, without rolling', () => {
    // Nothing is scripted, so a roll here would throw.
    const effect = resolveDowntimeMove({
      move: 'clearStress',
      kind: 'long',
      level: 5,
      rng: scriptedRng([]),
    });
    expect(effect.amount).toBeNull();
    expect(effect.roll).toBeNull();
  });

  it('pays Prepare in Hope, and double for preparing together', () => {
    const alone = resolveDowntimeMove({ move: 'prepare', kind: 'short', level: 1, rng: scriptedRng([]) });
    expect(alone.amount).toBe(1);

    const together = resolveDowntimeMove({
      move: 'prepare',
      kind: 'long',
      level: 1,
      withParty: true,
      rng: scriptedRng([]),
    });
    expect(together.amount).toBe(2);
  });

  it('changes nothing on the sheet for a project, whose progress is a countdown', () => {
    const effect = resolveDowntimeMove({
      move: 'workOnProject',
      kind: 'long',
      level: 1,
      rng: scriptedRng([]),
    });
    expect(effect.amount).toBe(0);
  });
});
