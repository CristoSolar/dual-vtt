import { describe, expect, it } from 'vitest';

import {
  advanceCountdown,
  advanceOnActionRoll,
  advanceOnRest,
  advancementFor,
  type Countdown,
} from '../src/index.js';

const countdown = (over: Partial<Countdown> = {}): Countdown => ({
  id: 'c1',
  name: 'Test',
  kind: 'standard',
  value: 5,
  startingValue: 5,
  loop: 'none',
  triggered: false,
  ...over,
});

describe('dynamic countdown advancement chart (SRD p.69)', () => {
  it('ticks a consequence countdown 3 / 2 / 1 / 0 by outcome', () => {
    expect(advancementFor('consequence', 'failureFear')).toBe(3);
    expect(advancementFor('consequence', 'failureHope')).toBe(2);
    expect(advancementFor('consequence', 'successFear')).toBe(1);
    expect(advancementFor('consequence', 'successHope')).toBe(0);
    // A critical success is the best possible outcome, so nothing bad advances.
    expect(advancementFor('consequence', 'criticalSuccess')).toBe(0);
  });

  it('ticks a progress countdown as the mirror of a consequence one', () => {
    expect(advancementFor('progress', 'failureFear')).toBe(0);
    expect(advancementFor('progress', 'failureHope')).toBe(0);
    expect(advancementFor('progress', 'successFear')).toBe(1);
    expect(advancementFor('progress', 'successHope')).toBe(2);
    expect(advancementFor('progress', 'criticalSuccess')).toBe(3);
  });

  it('advances a standard countdown by 1 on any action roll', () => {
    for (const outcome of [
      'failureFear',
      'failureHope',
      'successFear',
      'successHope',
      'criticalSuccess',
    ] as const) {
      expect(advancementFor('standard', outcome)).toBe(1);
    }
  });

  it('never advances a long-term countdown on an action roll', () => {
    expect(advancementFor('longTerm', 'failureFear')).toBe(0);
    expect(advancementFor('longTerm', 'criticalSuccess')).toBe(0);
  });

  it('applies the chart to a consequence countdown in play', () => {
    const start = countdown({ kind: 'consequence', value: 6, startingValue: 6 });

    expect(advanceOnActionRoll([start], 'failureFear').countdowns[0]?.value).toBe(3);
    expect(advanceOnActionRoll([start], 'failureHope').countdowns[0]?.value).toBe(4);
    expect(advanceOnActionRoll([start], 'successFear').countdowns[0]?.value).toBe(5);
    expect(advanceOnActionRoll([start], 'successHope').countdowns[0]?.value).toBe(6);
  });
});

describe('triggering', () => {
  it('triggers at 0 and stays there when it does not loop', () => {
    const tick = advanceCountdown(countdown({ value: 1 }), 1);
    expect(tick.triggered).toBe(true);
    expect(tick.countdown.value).toBe(0);
    expect(tick.countdown.triggered).toBe(true);
  });

  it('never goes below 0', () => {
    expect(advanceCountdown(countdown({ value: 2 }), 9).countdown.value).toBe(0);
  });

  it('resets a looping countdown to its starting value', () => {
    const tick = advanceCountdown(countdown({ value: 1, startingValue: 4, loop: 'loop' }), 1);
    expect(tick.triggered).toBe(true);
    expect(tick.countdown.value).toBe(4);
    expect(tick.countdown.triggered).toBe(false);
  });

  it('raises the starting value of an increasing countdown each loop', () => {
    const tick = advanceCountdown(countdown({ value: 1, startingValue: 3, loop: 'increasing' }), 1);
    expect(tick.countdown.startingValue).toBe(4);
    expect(tick.countdown.value).toBe(4);
  });

  it('lowers the starting value of a decreasing countdown, never below 1', () => {
    const once = advanceCountdown(countdown({ value: 1, startingValue: 3, loop: 'decreasing' }), 1);
    expect(once.countdown.startingValue).toBe(2);

    const floor = advanceCountdown(
      countdown({ value: 1, startingValue: 1, loop: 'decreasing' }),
      1,
    );
    expect(floor.countdown.startingValue).toBe(1);
  });

  it('leaves an already-triggered countdown alone', () => {
    const spent = countdown({ value: 0, triggered: true });
    expect(advanceOnActionRoll([spent], 'failureFear').countdowns[0]).toBe(spent);
  });

  it('reports which countdowns triggered', () => {
    const result = advanceOnActionRoll(
      [countdown({ id: 'a', value: 1 }), countdown({ id: 'b', value: 5 })],
      'successFear',
    );
    expect(result.triggeredIds).toEqual(['a']);
  });
});

describe('rests', () => {
  it('advances only long-term countdowns', () => {
    const long = countdown({ id: 'long', kind: 'longTerm', value: 4 });
    const standard = countdown({ id: 'std', kind: 'standard', value: 4 });

    const result = advanceOnRest([long, standard], 1);
    expect(result.countdowns.find((c) => c.id === 'long')?.value).toBe(3);
    expect(result.countdowns.find((c) => c.id === 'std')?.value).toBe(4);
  });
});
