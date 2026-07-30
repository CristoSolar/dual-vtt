import { rollDie, type Rng } from './rng.js';

/** Outcome of an action roll compared against a Difficulty (SRD p.36). */
export type ActionOutcome =
  | 'criticalSuccess'
  | 'successHope'
  | 'successFear'
  | 'failureHope'
  | 'failureFear';

export interface DualityRoll {
  /** Face shown on the Hope Die. */
  hope: number;
  /** Face shown on the Fear Die. */
  fear: number;
  /** hope + fear + advantage − disadvantage + modifiers. */
  total: number;
  /** Matching Duality Dice. A Critical Success also counts as a roll "with Hope". */
  critical: boolean;
  /** True on a critical or when the Hope Die is higher (SRD p.36). */
  withHope: boolean;
  /** The advantage die result added to the total, if any was rolled. */
  advantageRoll: number | null;
  /** The disadvantage die result subtracted from the total, if any was rolled. */
  disadvantageRoll: number | null;
}

export interface RollDualityOptions {
  /** Flat modifiers: trait, Experience, proficiency-independent bonuses. Default 0. */
  modifiers?: number;
  /** Number of advantage sources. Cancels against `disadvantage` one-for-one. */
  advantage?: number;
  /** Number of disadvantage sources. Cancels against `advantage` one-for-one. */
  disadvantage?: number;
  /**
   * Size of the Hope Die. Defaults to 12; some features swap it, e.g. Orderborne's
   * "Dedicated" lets you "roll a d20 as your Hope Die".
   */
  hopeDie?: number;
  /** Size of the Fear Die. Defaults to 12. */
  fearDie?: number;
  rng: Rng;
}

/**
 * Advantage and disadvantage dice cancel each other one-for-one, so a roll never
 * carries both (SRD p.38).
 */
export function advantageDisadvantage(
  advantage: number,
  disadvantage: number,
): { advantage: number; disadvantage: number } {
  const net = advantage - disadvantage;
  return net >= 0 ? { advantage: net, disadvantage: 0 } : { advantage: 0, disadvantage: -net };
}

/**
 * Rolls the Duality Dice. Outcome needs a Difficulty, so this returns the roll and
 * you pass it to `resolveActionRoll` / `resolveReactionRoll`.
 *
 * Multiple advantage sources each roll a d6; only the highest is added, matching
 * Help an Ally ("that player only adds the highest result", SRD p.38). Disadvantage
 * mirrors this with the highest result subtracted.
 */
export function rollDuality(options: RollDualityOptions): DualityRoll {
  const {
    modifiers = 0,
    advantage = 0,
    disadvantage = 0,
    hopeDie = 12,
    fearDie = 12,
    rng,
  } = options;

  const net = advantageDisadvantage(advantage, disadvantage);

  const hope = rollDie(hopeDie, rng);
  const fear = rollDie(fearDie, rng);

  let advantageRoll: number | null = null;
  for (let i = 0; i < net.advantage; i++) {
    const result = rollDie(6, rng);
    if (advantageRoll === null || result > advantageRoll) advantageRoll = result;
  }

  let disadvantageRoll: number | null = null;
  for (let i = 0; i < net.disadvantage; i++) {
    const result = rollDie(6, rng);
    if (disadvantageRoll === null || result > disadvantageRoll) disadvantageRoll = result;
  }

  const critical = hope === fear;
  const total = hope + fear + modifiers + (advantageRoll ?? 0) - (disadvantageRoll ?? 0);

  return {
    hope,
    fear,
    total,
    critical,
    withHope: critical || hope > fear,
    advantageRoll,
    disadvantageRoll,
  };
}

export interface ActionResult {
  outcome: ActionOutcome;
  success: boolean;
  critical: boolean;
  /** A Critical Success counts as a roll "with Hope" (SRD p.36). */
  withHope: boolean;
  /** Hope the PC gains from the roll itself. */
  hopeGained: number;
  /** Fear the GM gains from the roll itself. */
  fearGained: number;
  /** Stress the PC clears from the roll itself (criticals only). */
  stressCleared: number;
  /** True on a critical attack roll, where damage adds the dice's maximum. */
  criticalDamage: boolean;
}

/** Resolves a Duality roll against a Difficulty as an action roll (SRD p.36). */
export function resolveActionRoll(roll: DualityRoll, difficulty: number): ActionResult {
  if (roll.critical) {
    return {
      outcome: 'criticalSuccess',
      success: true,
      critical: true,
      withHope: true,
      hopeGained: 1,
      fearGained: 0,
      stressCleared: 1,
      criticalDamage: true,
    };
  }

  const success = roll.total >= difficulty;
  const withHope = roll.withHope;
  const outcome: ActionOutcome = success
    ? withHope
      ? 'successHope'
      : 'successFear'
    : withHope
      ? 'failureHope'
      : 'failureFear';

  return {
    outcome,
    success,
    critical: false,
    withHope,
    hopeGained: withHope ? 1 : 0,
    fearGained: withHope ? 0 : 1,
    stressCleared: 0,
    criticalDamage: false,
  };
}

export interface ReactionResult {
  success: boolean;
  critical: boolean;
  /**
   * A critical reaction roll ignores any effect that would have hit you on a
   * success — damage, marking Stress, and so on (SRD p.37).
   */
  ignoresEffects: boolean;
}

/**
 * Resolves a Duality roll as a reaction roll: reactions generate no Hope or Fear,
 * and a critical clears no Stress and grants no Hope, but does negate the effects a
 * mere success would have left in place (SRD p.37).
 */
export function resolveReactionRoll(roll: DualityRoll, difficulty: number): ReactionResult {
  const critical = roll.critical;
  return {
    success: critical || roll.total >= difficulty,
    critical,
    ignoresEffects: critical,
  };
}
