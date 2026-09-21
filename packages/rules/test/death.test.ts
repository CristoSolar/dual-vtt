import { describe, expect, it } from 'vitest';

import { MAX_HOPE, avoidDeath, blazeOfGlory, riskItAll, scriptedRng, splitClears } from '../src/index.js';

describe('blaze of glory', () => {
  it('takes one final action and ends there', () => {
    expect(blazeOfGlory().died).toBe(true);
  });
});

describe('avoiding death', () => {
  it('scars when the Hope Die comes up at or below the level', () => {
    // A level-5 character rolling a 4 is scarred; rolling a 6 is not.
    expect(avoidDeath(5, 0, scriptedRng([4])).scarred).toBe(true);
    expect(avoidDeath(5, 0, scriptedRng([6])).scarred).toBe(false);
    expect(avoidDeath(5, 0, scriptedRng([5])).scarred).toBe(true);
  });

  it('survives a scar while Hope slots remain', () => {
    const outcome = avoidDeath(5, 0, scriptedRng([4]));
    expect(outcome.died).toBe(false);
  });

  it('ends the journey when the last Hope slot is crossed out', () => {
    const outcome = avoidDeath(5, MAX_HOPE - 1, scriptedRng([4]));
    expect(outcome.scarred).toBe(true);
    expect(outcome.died).toBe(true);
  });

  it('does not end it when the roll was high enough to avoid the scar', () => {
    expect(avoidDeath(5, MAX_HOPE - 1, scriptedRng([9])).died).toBe(false);
  });
});

describe('risking it all', () => {
  it('stays up and clears the Hope Die when Hope wins', () => {
    const outcome = riskItAll(scriptedRng([9, 3]));
    expect(outcome.result).toBe('survivedWithHope');
    expect(outcome.clears).toBe(9);
    expect(outcome.died).toBe(false);
  });

  it('clears everything on matching dice', () => {
    const outcome = riskItAll(scriptedRng([7, 7]));
    expect(outcome.result).toBe('survivedOnAMatch');
    expect(outcome.clears).toBeNull();
    expect(outcome.died).toBe(false);
  });

  it('is the end when the Fear Die wins', () => {
    const outcome = riskItAll(scriptedRng([3, 9]));
    expect(outcome.result).toBe('died');
    expect(outcome.died).toBe(true);
  });
});

describe('splitting what a survival clears', () => {
  it('fills the preferred track first and spills the rest', () => {
    expect(splitClears(5, 'hp', 3, 4)).toEqual({ hp: 3, stress: 2 });
    expect(splitClears(5, 'stress', 3, 4)).toEqual({ hp: 1, stress: 4 });
  });

  it('never clears more than is marked', () => {
    expect(splitClears(9, 'hp', 2, 2)).toEqual({ hp: 2, stress: 2 });
    expect(splitClears(9, 'hp', 0, 0)).toEqual({ hp: 0, stress: 0 });
  });
});
