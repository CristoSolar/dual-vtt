import type { Armor, Thresholds } from '@daggerheart/srd-data';

import { rollDice, type Rng } from './rng.js';

/** Damage type of an incoming hit. 'both' is an attack dealing physical *and* magic. */
export type IncomingDamageType = 'physical' | 'magic' | 'both';

export interface CalcDamageThresholdsOptions {
  /** Equipped armor, or null while unarmored. */
  armor: Pick<Armor, 'baseThresholds'> | null;
  level: number;
  /** Flat bonuses from features, e.g. Stalwart's "Unwavering" (+1 to thresholds). */
  bonuses?: number;
}

/**
 * A PC's damage thresholds are their armor's base thresholds plus their level
 * (SRD p.56). While unarmored, Major equals their level and Severe twice their
 * level (SRD p.56).
 */
export function calcDamageThresholds({
  armor,
  level,
  bonuses = 0,
}: CalcDamageThresholdsOptions): Thresholds {
  if (armor === null) {
    return { major: level + bonuses, severe: level * 2 + bonuses };
  }
  return {
    major: armor.baseThresholds.major + level + bonuses,
    severe: armor.baseThresholds.severe + level + bonuses,
  };
}

export interface RollDamageOptions {
  /**
   * The printed damage dice. `count` is what the weapon or effect shows; Proficiency
   * multiplies it.
   */
  dice: { count: number; die: number };
  /**
   * How many times the printed dice are rolled. Weapons use the PC's Proficiency;
   * effects with a fixed dice count use 1. Never affects `modifier`.
   */
  proficiency?: number;
  /** Flat damage modifier. Added once, untouched by Proficiency (SRD p.39). */
  modifier?: number;
  /** On a critical success, add the maximum possible result of the damage dice. */
  critical?: boolean;
  rng: Rng;
}

export interface DamageRoll {
  /** Every die face rolled, in order. */
  rolls: number[];
  /** The maximum added by a critical success, or 0 when not critical. */
  criticalBonus: number;
  modifier: number;
  /** rolls + criticalBonus + modifier. */
  total: number;
}

/**
 * Rolls damage. Proficiency multiplies the number of dice only, never the flat
 * modifier. A critical success adds the maximum possible result of the damage dice
 * to the total, so a critical 2d8+1 deals `roll + 16 + 1` (SRD p.39).
 */
export function rollDamage({
  dice,
  proficiency = 1,
  modifier = 0,
  critical = false,
  rng,
}: RollDamageOptions): DamageRoll {
  const count = dice.count * proficiency;
  const rolls = rollDice(count, dice.die, rng);
  const criticalBonus = critical ? count * dice.die : 0;
  const total = rolls.reduce((sum, r) => sum + r, 0) + criticalBonus + modifier;
  return { rolls, criticalBonus, modifier, total };
}

/** How much of a threshold band the damage landed in. */
export type Severity = 'none' | 'minor' | 'major' | 'severe';

const SEVERITY_ORDER: readonly Severity[] = ['none', 'minor', 'major', 'severe'];
const HP_BY_SEVERITY: Record<Severity, number> = { none: 0, minor: 1, major: 2, severe: 3 };

export interface ApplyDamageOptions {
  /** Total damage from a single attack or source, before Armor Slots (SRD p.42). */
  incoming: number;
  thresholds: Thresholds;
  /** Damage type of the hit. Defaults to 'physical'. */
  damageType?: IncomingDamageType;
  /**
   * Armor Slots the target marks. Each reduces the severity by one threshold
   * (Severe to Major, Major to Minor, Minor to Nothing) — SRD p.56.
   */
  armorSlotsMarked?: number;
  /**
   * Damage types the target resists. Resistance halves incoming damage before it is
   * compared to thresholds; multiple resistances to the same type do not stack
   * (SRD p.40).
   */
  resistances?: readonly IncomingDamageType[];
  /** Damage types the target ignores entirely (SRD p.40). */
  immunities?: readonly IncomingDamageType[];
  /** Direct damage can't be reduced by marking Armor Slots (SRD p.40). */
  direct?: boolean;
}

export interface AppliedDamage {
  /** Damage after resistance, before Armor Slots reduce severity. */
  damageAfterResistance: number;
  severity: Severity;
  /** Hit Points the target marks: 0-3. */
  hpMarked: number;
  resisted: boolean;
  immune: boolean;
  /** Armor Slots that actually reduced severity (0 for direct damage). */
  armorSlotsUsed: number;
}

/**
 * An attack dealing both physical and magic damage is only resisted or ignored if
 * the target has that protection against both types (SRD p.40).
 */
function covers(protections: readonly IncomingDamageType[], damageType: IncomingDamageType) {
  if (damageType === 'both') {
    return (
      (protections.includes('physical') && protections.includes('magic')) ||
      protections.includes('both')
    );
  }
  return protections.includes(damageType);
}

/**
 * Applies incoming damage: immunity first, then resistance (halved, rounding up per
 * the SRD's round-up rule), then threshold comparison, then Armor Slots reducing the
 * resulting severity.
 */
export function applyDamage({
  incoming,
  thresholds,
  damageType = 'physical',
  armorSlotsMarked = 0,
  resistances = [],
  immunities = [],
  direct = false,
}: ApplyDamageOptions): AppliedDamage {
  const immune = covers(immunities, damageType);
  if (immune) {
    return {
      damageAfterResistance: 0,
      severity: 'none',
      hpMarked: 0,
      resisted: false,
      immune: true,
      armorSlotsUsed: 0,
    };
  }

  const resisted = covers(resistances, damageType);
  const damageAfterResistance = resisted ? Math.ceil(incoming / 2) : incoming;

  let severity: Severity;
  if (damageAfterResistance <= 0) severity = 'none';
  else if (damageAfterResistance >= thresholds.severe) severity = 'severe';
  else if (damageAfterResistance >= thresholds.major) severity = 'major';
  else severity = 'minor';

  const armorSlotsUsed = direct ? 0 : Math.max(0, armorSlotsMarked);
  const reduced = Math.max(0, SEVERITY_ORDER.indexOf(severity) - armorSlotsUsed);
  const finalSeverity = SEVERITY_ORDER[reduced] ?? 'none';

  return {
    damageAfterResistance,
    severity: finalSeverity,
    hpMarked: HP_BY_SEVERITY[finalSeverity],
    resisted,
    immune: false,
    armorSlotsUsed,
  };
}
