import { tierForLevel } from './levelUp.js';
import { rollDice, type Rng } from './rng.js';

/**
 * Downtime: what a rest gives the party and what it costs them (SRD 2.0 p.52).
 *
 * A rest is the party's, but its moves are each character's: every PC makes up to
 * two, and may make the same one twice. A short rest restores a roll; a long rest
 * restores everything. The GM is paid in Fear either way.
 *
 * These functions decide *how much* a move restores, not where: Hit Points, Stress
 * and Armor Slots live in different shapes, and putting the number somewhere is the
 * sheet's job.
 */

export type RestKind = 'short' | 'long';

/**
 * The moves a character can make. The list is the same for both rests; the kind of
 * rest decides how much each one does, which is how the SRD prints them ("Tend to
 * Wounds" against "Tend to All Wounds").
 */
export type DowntimeMove =
  | 'tendToWounds'
  | 'clearStress'
  | 'repairArmor'
  | 'prepare'
  | 'workOnProject';

export const DOWNTIME_MOVES: readonly DowntimeMove[] = [
  'tendToWounds',
  'clearStress',
  'repairArmor',
  'prepare',
  'workOnProject',
];

/** Each PC makes up to two downtime moves per rest (SRD 2.0 p.52). */
export const MOVES_PER_REST = 2;

/** "If a party takes three short rests in a row, their next rest must be a long rest." */
export const MAX_CONSECUTIVE_SHORT_RESTS = 3;

/** Working on a project is a long-rest move; the others are available in both. */
export function isMoveAvailable(move: DowntimeMove, kind: RestKind): boolean {
  return move !== 'workOnProject' || kind === 'long';
}

/** True when the party has spent its run of short rests and owes itself a long one. */
export function mustRestLong(consecutiveShortRests: number): boolean {
  return consecutiveShortRests >= MAX_CONSECUTIVE_SHORT_RESTS;
}

/**
 * The Fear the GM gains for the party's rest: 1d4 on a short rest, 1d4 plus one per
 * PC on a long one. The count is the party's, since the SRD pays the GM for the
 * whole party's downtime rather than per character resting.
 */
export function restFear(kind: RestKind, pcCount: number, rng: Rng): number {
  const [die = 1] = rollDice(1, 4, rng);
  return kind === 'short' ? die : die + Math.max(0, pcCount);
}

export interface DowntimeEffect {
  move: DowntimeMove;
  /**
   * How much the move restores, or null for "everything" — which is what a long
   * rest's Tend to All Wounds, Clear All Stress and Repair All Armor do.
   */
  amount: number | null;
  /** The d4 behind `amount` on a short rest; null when nothing was rolled. */
  roll: number | null;
}

export interface DowntimeOptions {
  move: DowntimeMove;
  kind: RestKind;
  /** The level of the character making the move; its tier is the roll's bonus. */
  level: number;
  /** Preparing alongside at least one other PC is worth 2 Hope rather than 1. */
  withParty?: boolean;
  rng: Rng;
}

/**
 * Works out what one downtime move restores.
 *
 * A short rest restores `1d4 + tier`; a long rest restores the track in full, so
 * nothing is rolled. Hope from Prepare is flat either way, and working on a project
 * moves a countdown the GM keeps rather than anything on the sheet.
 */
export function resolveDowntimeMove({
  move,
  kind,
  level,
  withParty = false,
  rng,
}: DowntimeOptions): DowntimeEffect {
  if (move === 'prepare') {
    return { move, amount: withParty ? 2 : 1, roll: null };
  }
  if (move === 'workOnProject') {
    return { move, amount: 0, roll: null };
  }
  if (kind === 'long') {
    return { move, amount: null, roll: null };
  }
  const [die = 1] = rollDice(1, 4, rng);
  return { move, amount: die + tierForLevel(level), roll: die };
}
