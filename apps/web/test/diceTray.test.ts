import { describe, expect, it } from 'vitest';

import { diceTimings } from '../src/state/diceNotation.js';
import { addDie, clampModifier, removeDie, trayDice, trayIntent } from '../src/state/diceTray.js';

describe('the dice tray', () => {
  it('counts dice by size and lists them smallest first', () => {
    let tray = addDie({}, 20);
    tray = addDie(tray, 6);
    tray = addDie(tray, 6);
    expect(trayDice(tray)).toEqual([
      { sides: 6, count: 2 },
      { sides: 20, count: 1 },
    ]);
  });

  it('stops at twenty of one size, the most the server takes', () => {
    let tray = {};
    for (let i = 0; i < 25; i++) tray = addDie(tray, 4);
    expect(trayDice(tray)).toEqual([{ sides: 4, count: 20 }]);
  });

  it('takes one away, dropping a size that reaches zero', () => {
    const tray = removeDie(addDie(addDie({}, 8), 8), 8);
    expect(trayDice(tray)).toEqual([{ sides: 8, count: 1 }]);
    expect(trayDice(removeDie(tray, 8))).toEqual([]);
    expect(trayDice(removeDie({}, 8))).toEqual([]);
  });

  it('keeps the modifier inside what the server accepts', () => {
    expect(clampModifier(5)).toBe(5);
    expect(clampModifier(250)).toBe(99);
    expect(clampModifier(-250)).toBe(-99);
    expect(clampModifier(Number.NaN)).toBe(0);
    expect(clampModifier(2.7)).toBe(2);
  });

  it('builds the intent, or nothing for an empty tray', () => {
    expect(trayIntent({}, 3, 'public')).toBeNull();
    expect(trayIntent(addDie(addDie({}, 6), 6), 1, 'private')).toEqual({
      type: 'rollDice',
      dice: [{ sides: 6, count: 2 }],
      modifier: 1,
      visibility: 'private',
    });
  });
});

describe('how long thrown dice stay', () => {
  it('lingers a few seconds after they settle, then fades', () => {
    const { lingerMs, fadeMs } = diceTimings(false);
    expect(lingerMs).toBeGreaterThanOrEqual(4000);
    expect(fadeMs).toBeGreaterThanOrEqual(1000);
  });

  it('skips the fade when motion is reduced, but still lingers', () => {
    expect(diceTimings(true)).toEqual({ lingerMs: diceTimings(false).lingerMs, fadeMs: 0 });
  });
});
