import { MAX_HOPE } from './resources.js';
import { rollDie, type Rng } from './rng.js';
import { rollDuality, type DualityRoll } from './duality.js';

/**
 * Death moves: what a character does when their last Hit Point is marked
 * (SRD 2.0 p.53).
 *
 * All three end the character's turn one way or another, and two of them are
 * rolled, so they belong here rather than in a conversation the app cannot see.
 */

export type DeathMoveChoice = 'blazeOfGlory' | 'avoidDeath' | 'riskItAll';

/** Whether a Risk It All leaves the character standing, and at what cost. */
export type RiskOutcome = 'survivedWithHope' | 'survivedOnAMatch' | 'died';

export interface BlazeOfGloryOutcome {
  choice: 'blazeOfGlory';
  /** The final action critically succeeds, and then the character is gone. */
  died: true;
}

export interface AvoidDeathOutcome {
  choice: 'avoidDeath';
  /** Rolled after falling unconscious, against the character's level. */
  hopeDie: number;
  /** A scar is taken when the Hope Die comes up at or below the level. */
  scarred: boolean;
  /**
   * True when that scar was the last Hope slot, which is where the character's
   * journey ends.
   */
  died: boolean;
}

export interface RiskItAllOutcome {
  choice: 'riskItAll';
  roll: DualityRoll;
  result: RiskOutcome;
  /**
   * How much the character clears. Equal to the Hope Die when it wins, and
   * everything on a match, which is why it is null there.
   */
  clears: number | null;
  died: boolean;
}

export type DeathMoveOutcome = BlazeOfGloryOutcome | AvoidDeathOutcome | RiskItAllOutcome;

/**
 * Going out in a blaze of glory. The final action's automatic critical success is
 * the table's to narrate; what is mechanical is that the character does not come
 * back from it.
 */
export function blazeOfGlory(): BlazeOfGloryOutcome {
  return { choice: 'blazeOfGlory', died: true };
}

/**
 * Avoiding death: the character drops unconscious, then rolls their Hope Die. At or
 * below their level they take a scar, permanently crossing out a Hope slot, and
 * crossing out the last one ends their journey.
 */
export function avoidDeath(level: number, scars: number, rng: Rng): AvoidDeathOutcome {
  const hopeDie = rollDie(12, rng);
  const scarred = hopeDie <= level;
  return {
    choice: 'avoidDeath',
    hopeDie,
    scarred,
    died: scarred && scars + 1 >= MAX_HOPE,
  };
}

/**
 * Risking it all: roll the Duality Dice. The Hope Die winning keeps the character
 * up and clears its value, split between Hit Points and Stress however they like;
 * matching dice clear everything; the Fear Die winning is the end.
 */
export function riskItAll(rng: Rng): RiskItAllOutcome {
  const roll = rollDuality({ rng });

  if (roll.critical) {
    return { choice: 'riskItAll', roll, result: 'survivedOnAMatch', clears: null, died: false };
  }
  if (roll.hope > roll.fear) {
    return {
      choice: 'riskItAll',
      roll,
      result: 'survivedWithHope',
      clears: roll.hope,
      died: false,
    };
  }
  return { choice: 'riskItAll', roll, result: 'died', clears: 0, died: true };
}

/**
 * Splits what a surviving Risk It All clears between the two tracks.
 *
 * The SRD lets the player divide the Hope Die between Hit Points and Stress, so
 * they say which they want filled first and the remainder spills into the other.
 */
export function splitClears(
  total: number,
  prefer: 'hp' | 'stress',
  hpMarked: number,
  stressMarked: number,
): { hp: number; stress: number } {
  const first = prefer === 'hp' ? hpMarked : stressMarked;
  const toFirst = Math.min(total, first);
  const toSecond = Math.min(total - toFirst, prefer === 'hp' ? stressMarked : hpMarked);
  return prefer === 'hp'
    ? { hp: toFirst, stress: toSecond }
    : { hp: toSecond, stress: toFirst };
}
