import { rollDamage, type DamageRoll } from './damage.js';
import { rollDice, rollDie, type Rng } from './rng.js';

/**
 * The GM's side of an attack (SRD 2.0 p.86, p.90).
 *
 * An adversary rolls a d20 rather than the Duality Dice, so none of this belongs in
 * `duality.ts`. Advantage and disadvantage are a second d20 rather than a d6, and a
 * natural 20 succeeds whatever the target's Evasion and adds the damage dice's
 * maximum to the damage.
 */

export interface AdversaryAttackOptions {
  /**
   * The flat Attack Modifier from the stat block. A few adversaries roll for it
   * instead (e.g. "ATK: +2d4"); pass `modifierDice` for those.
   */
  modifier?: number;
  /** A rolled Attack Modifier, for the stat blocks that print one. */
  modifierDice?: { count: number; die: number } | null;
  /** The target's Evasion, when it is known. Null leaves the outcome to the GM. */
  evasion?: number | null;
  /** A second d20, keeping the higher result. */
  advantage?: boolean;
  /** A second d20, keeping the lower result. */
  disadvantage?: boolean;
  /**
   * An Experience from the stat block, added for a Fear. The Fear itself is spent
   * by the room, not here.
   */
  experience?: number;
  rng: Rng;
}

export interface AdversaryAttack {
  /** Every d20 rolled, in order, so the log can show what was kept and what was not. */
  dice: number[];
  /** The d20 that counted. */
  die: number;
  modifier: number;
  experience: number;
  total: number;
  /** A natural 20 succeeds whatever the Evasion, and makes the damage critical. */
  critical: boolean;
  /**
   * Whether the attack landed, or null when no Evasion was given and the GM is
   * deciding for themselves.
   */
  success: boolean | null;
}

/**
 * Rolls an adversary's attack.
 *
 * Advantage and disadvantage cancel: granting both is the same as granting neither,
 * which mirrors how they work for a PC.
 */
export function rollAdversaryAttack({
  modifier = 0,
  modifierDice = null,
  evasion = null,
  advantage = false,
  disadvantage = false,
  experience = 0,
  rng,
}: AdversaryAttackOptions): AdversaryAttack {
  const net = advantage === disadvantage ? 'none' : advantage ? 'advantage' : 'disadvantage';

  const dice = net === 'none' ? [rollDie(20, rng)] : [rollDie(20, rng), rollDie(20, rng)];
  const die =
    net === 'advantage' ? Math.max(...dice) : net === 'disadvantage' ? Math.min(...dice) : dice[0];

  const kept = die ?? 1;
  // A rolled modifier is rolled now, and folded into the same flat number so the
  // log has one total to show.
  const rolled =
    modifierDice === null
      ? 0
      : rollDice(modifierDice.count, modifierDice.die, rng).reduce((sum, d) => sum + d, 0);
  const flat = modifier + rolled;
  const total = kept + flat + experience;
  const critical = kept === 20;

  return {
    dice,
    die: kept,
    modifier: flat,
    experience,
    total,
    critical,
    // "If the total meets or beats the target's Evasion, the attack succeeds."
    success: evasion === null ? null : critical || total >= evasion,
  };
}

export interface AdversaryDamageOptions {
  /** The printed damage dice from the stat block. */
  dice: { count: number; die: number };
  modifier: number;
  /** Set by a natural 20, which adds the dice's maximum to the total. */
  critical?: boolean;
  rng: Rng;
}

/**
 * Rolls an adversary's damage. There is no Proficiency on the GM's side, so the
 * printed dice are rolled as printed.
 */
export function rollAdversaryDamage({
  dice,
  modifier,
  critical = false,
  rng,
}: AdversaryDamageOptions): DamageRoll {
  return rollDamage({ dice, proficiency: 1, modifier, critical, rng });
}
