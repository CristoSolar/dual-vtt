/** A PC can hold at most 6 Hope at one time (SRD p.38). */
export const MAX_HOPE = 6;
/** The GM can hold at most 12 Fear at one time (SRD p.38). */
export const MAX_FEAR = 12;
/** Hit Point and Stress slots each cap at 12 as you level (SRD p.39). */
export const MAX_HP_SLOTS = 12;
export const MAX_STRESS_SLOTS = 12;

/** The mutable pools this module operates on. Every function returns a new object. */
export interface ResourcePools {
  /** Hit Point slots currently marked. */
  hpMarked: number;
  /** Total Hit Point slots available. */
  hpSlots: number;
  /** Stress slots currently marked. */
  stressMarked: number;
  /** Total Stress slots available. */
  stressSlots: number;
}

export interface MarkStressResult extends ResourcePools {
  /** Stress slots actually marked. */
  stressMarkedNow: number;
  /**
   * When a character must mark Stress but can't, they mark 1 HP instead — once,
   * regardless of how much Stress went unmarked (SRD p.39).
   */
  hpMarkedInstead: number;
  /** Marking your last Stress makes you Vulnerable until you clear at least 1 (SRD p.39). */
  vulnerable: boolean;
  /** True if the substituted HP was the character's last (SRD p.42). */
  deathMoveRequired: boolean;
}

/**
 * Marks Stress. Filling the last slot makes the character Vulnerable; being unable to
 * mark required Stress costs 1 HP instead, which can itself trigger a death move.
 */
export function markStress(pools: ResourcePools, amount = 1): MarkStressResult {
  const capacity = Math.max(0, pools.stressSlots - pools.stressMarked);
  const stressMarkedNow = Math.min(capacity, Math.max(0, amount));
  const stressMarked = pools.stressMarked + stressMarkedNow;
  const couldNotMark = Math.max(0, amount) > stressMarkedNow;

  const hpMarkedInstead = couldNotMark ? 1 : 0;
  const hpMarked = Math.min(pools.hpSlots, pools.hpMarked + hpMarkedInstead);

  return {
    ...pools,
    hpMarked,
    stressMarked,
    stressMarkedNow,
    hpMarkedInstead,
    vulnerable: stressMarked >= pools.stressSlots,
    deathMoveRequired: hpMarkedInstead > 0 && hpMarked >= pools.hpSlots,
  };
}

export interface MarkHPResult extends ResourcePools {
  hpMarkedNow: number;
  /** Marking your last Hit Point means you fall and must make a death move (SRD p.42). */
  deathMoveRequired: boolean;
}

/** Marks Hit Points, never exceeding the available slots. */
export function markHP(pools: ResourcePools, amount = 1): MarkHPResult {
  const capacity = Math.max(0, pools.hpSlots - pools.hpMarked);
  const hpMarkedNow = Math.min(capacity, Math.max(0, amount));
  const hpMarked = pools.hpMarked + hpMarkedNow;
  return {
    ...pools,
    hpMarked,
    hpMarkedNow,
    deathMoveRequired: hpMarked >= pools.hpSlots,
  };
}

/** Clears marked Stress, never below zero. */
export function clearStress(pools: ResourcePools, amount = 1): ResourcePools {
  return { ...pools, stressMarked: Math.max(0, pools.stressMarked - Math.max(0, amount)) };
}

/** Clears marked Hit Points, never below zero. */
export function clearHP(pools: ResourcePools, amount = 1): ResourcePools {
  return { ...pools, hpMarked: Math.max(0, pools.hpMarked - Math.max(0, amount)) };
}

/** Gains Hope, capped at 6 (SRD p.38). */
export function gainHope(hope: number, amount = 1): number {
  return Math.min(MAX_HOPE, hope + Math.max(0, amount));
}

/** Spends Hope. Returns null when the PC can't afford it. */
export function spendHope(hope: number, amount: number): number | null {
  if (amount < 0 || hope < amount) return null;
  return hope - amount;
}

/** Gains Fear, capped at 12 (SRD p.38). */
export function gainFear(fear: number, amount = 1): number {
  return Math.min(MAX_FEAR, fear + Math.max(0, amount));
}

/** Spends Fear. Returns null when the GM can't afford it. */
export function spendFear(fear: number, amount: number): number | null {
  if (amount < 0 || fear < amount) return null;
  return fear - amount;
}

/** A PC's Armor Score can't exceed 12 (SRD p.56). */
export const MAX_ARMOR_SCORE = 12;

/**
 * Armor Slots available to a character. `score` is their total Armor Score, which is
 * how many slots the armor provides; `marked` is how many are currently spent.
 */
export interface ArmorSlots {
  marked: number;
  score: number;
}

export interface MarkArmorSlotResult extends ArmorSlots {
  /** Slots actually marked, which is 0 at an Armor Score of 0 (SRD p.56). */
  markedNow: number;
}

/**
 * Marks Armor Slots to reduce incoming damage severity. A character with an Armor
 * Score of 0 can't mark any, and no more can be marked than remain (SRD p.56).
 */
export function markArmorSlot(slots: ArmorSlots, amount = 1): MarkArmorSlotResult {
  const capacity = Math.max(0, Math.min(slots.score, MAX_ARMOR_SCORE) - slots.marked);
  const markedNow = Math.min(capacity, Math.max(0, amount));
  return { ...slots, marked: slots.marked + markedNow, markedNow };
}

/** Clears marked Armor Slots, never below zero. */
export function clearArmorSlot(slots: ArmorSlots, amount = 1): ArmorSlots {
  return { ...slots, marked: Math.max(0, slots.marked - Math.max(0, amount)) };
}

/** Gold is measured in handfuls, bags, and chests (SRD p.60). */
export interface Gold {
  handfuls: number;
  bags: number;
  chests: number;
}

export type GoldUnit = keyof Gold;

/** 10 handfuls to 1 bag, and 10 bags to 1 chest (SRD p.60). */
export const HANDFULS_PER_BAG = 10;
export const BAGS_PER_CHEST = 10;
const HANDFULS_PER_CHEST = HANDFULS_PER_BAG * BAGS_PER_CHEST;

/** You can't have more than 1 chest, so wealth tops out here (SRD p.60). */
export const MAX_CHESTS = 1;
export const MAX_GOLD_IN_HANDFULS =
  MAX_CHESTS * HANDFULS_PER_CHEST + (BAGS_PER_CHEST - 1) * HANDFULS_PER_BAG + (HANDFULS_PER_BAG - 1);

const UNIT_VALUE: Record<GoldUnit, number> = {
  handfuls: 1,
  bags: HANDFULS_PER_BAG,
  chests: HANDFULS_PER_CHEST,
};

/** Total wealth expressed in handfuls, the smallest tracked denomination. */
export function goldToHandfuls(gold: Gold): number {
  return (
    gold.handfuls + gold.bags * HANDFULS_PER_BAG + gold.chests * HANDFULS_PER_CHEST
  );
}

/** Splits a total back into chests, bags, and handfuls, carrying at 10 (SRD p.60). */
export function handfulsToGold(total: number): Gold {
  const clamped = Math.max(0, Math.min(MAX_GOLD_IN_HANDFULS, Math.floor(total)));
  const chests = Math.floor(clamped / HANDFULS_PER_CHEST);
  const afterChests = clamped - chests * HANDFULS_PER_CHEST;
  return {
    chests,
    bags: Math.floor(afterChests / HANDFULS_PER_BAG),
    handfuls: afterChests % HANDFULS_PER_BAG,
  };
}

/**
 * Gains gold, carrying a full category into the next one: 9 handfuls plus another
 * becomes 1 bag (SRD p.60). Caps at 1 chest, since a character can hold no more.
 */
export function gainGold(gold: Gold, amount = 1, unit: GoldUnit = 'handfuls'): Gold {
  return handfulsToGold(goldToHandfuls(gold) + Math.max(0, amount) * UNIT_VALUE[unit]);
}

/** Spends gold, breaking larger denominations as needed. Null if unaffordable. */
export function spendGold(gold: Gold, amount = 1, unit: GoldUnit = 'handfuls'): Gold | null {
  if (amount < 0) return null;
  const remaining = goldToHandfuls(gold) - amount * UNIT_VALUE[unit];
  if (remaining < 0) return null;
  return handfulsToGold(remaining);
}
