import type { Armor } from '@daggerheart/srd-data';

import { calcDamageThresholds } from './damage.js';

/**
 * Changing equipment during play (SRD 2.0 p.55).
 *
 * Armor is what makes this more than swapping an id: the piece worn sets the Armor
 * Score and the base damage thresholds, so putting a different one on changes two
 * numbers the sheet had been carrying since character creation.
 *
 * Swapping a weapon costs a Stress outside a rest and nothing during one; that is
 * the room's to charge, since only it knows whether the party is resting.
 */

export interface EquipArmorResult {
  /** Armor Slots the new piece provides, before any bonuses. */
  armorScore: number;
  thresholds: { major: number; severe: number };
}

/**
 * The Armor Score and thresholds for wearing `armor`, or for wearing none.
 *
 * Unarmored, Major equals the character's level and Severe twice their level, with
 * no Armor Slots at all.
 */
export function equipArmor(
  armor: Pick<Armor, 'baseScore' | 'baseThresholds'> | null,
  level: number,
  bonuses = 0,
): EquipArmorResult {
  const thresholds = calcDamageThresholds({ armor, level, bonuses });
  return { armorScore: armor === null ? 0 : armor.baseScore, thresholds };
}

/**
 * Whether a pair of weapons can be held at once: two hands, and a two-handed
 * weapon takes both (SRD 2.0 p.55).
 */
export function canHold(
  primary: { burden: 'oneHanded' | 'twoHanded' } | null,
  secondary: { burden: 'oneHanded' | 'twoHanded' } | null,
): boolean {
  if (primary?.burden === 'twoHanded' && secondary !== null) return false;
  if (secondary?.burden === 'twoHanded') return false;
  return true;
}

/** A weapon swapped outside a rest costs a Stress; during one it is free. */
export function weaponSwapCost(duringRest: boolean): number {
  return duringRest ? 0 : 1;
}
