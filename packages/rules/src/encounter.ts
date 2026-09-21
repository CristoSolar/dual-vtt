/**
 * Building balanced encounters with Battle Points (SRD 2.0 p.94).
 *
 * The budget is a number of points the GM spends on adversaries. Nothing here
 * enforces anything: an encounter over budget is a legal encounter, it is just a
 * harder one, so these functions report rather than refuse.
 */

/** The adversary types the SRD prints, which is what a point cost is read from. */
export type AdversaryType =
  | 'bruiser'
  | 'horde'
  | 'leader'
  | 'minion'
  | 'ranged'
  | 'skulk'
  | 'social'
  | 'solo'
  | 'standard'
  | 'support';

/**
 * What one adversary of each type costs. Minions are the exception and are not in
 * here: they cost 1 point per group the size of the party, not 1 each.
 */
export const BATTLE_POINT_COST: Record<Exclude<AdversaryType, 'minion'>, number> = {
  social: 1,
  support: 1,
  horde: 2,
  ranged: 2,
  skulk: 2,
  standard: 2,
  leader: 3,
  bruiser: 4,
  solo: 5,
};

/** The adjustments the GM chooses, as opposed to the ones the line-up decides. */
export interface BattlePointAdjustments {
  /** −1 for an easier or shorter fight. */
  easier?: boolean;
  /** +2 for a harder or longer fight. */
  harder?: boolean;
  /** −2 if every adversary's damage roll gains +1d4 (or a static +2). */
  strongerDamage?: boolean;
  /** +1 if an adversary is being taken from a lower tier. */
  lowerTier?: boolean;
}

/** The base budget before any adjustment: three points per PC, plus two. */
export function baseBattlePoints(pcCount: number): number {
  return 3 * Math.max(0, pcCount) + 2;
}

/**
 * The budget for an encounter: the base, the GM's chosen adjustments, and the two
 * adjustments the line-up itself decides — two or more Solos costs 2 points of
 * budget, and a fight with none of the four heavy types gains one.
 */
export function battlePointBudget(
  pcCount: number,
  types: readonly AdversaryType[],
  adjustments: BattlePointAdjustments = {},
): number {
  let points = baseBattlePoints(pcCount);
  if (adjustments.easier === true) points -= 1;
  if (adjustments.harder === true) points += 2;
  if (adjustments.strongerDamage === true) points -= 2;
  if (adjustments.lowerTier === true) points += 1;

  if (types.filter((type) => type === 'solo').length >= 2) points -= 2;
  const heavy: readonly AdversaryType[] = ['bruiser', 'horde', 'leader', 'solo'];
  if (!types.some((type) => heavy.includes(type))) points += 1;

  return points;
}

/**
 * What a line-up costs. Minions are counted together and charged one point per
 * group the size of the party, so four Minions and a party of four is one point.
 */
export function battlePointsSpent(types: readonly AdversaryType[], pcCount: number): number {
  const minions = types.filter((type) => type === 'minion').length;
  const groupSize = Math.max(1, pcCount);
  const minionCost = Math.ceil(minions / groupSize);

  return types.reduce((total, type) => {
    if (type === 'minion') return total;
    return total + BATTLE_POINT_COST[type];
  }, minionCost);
}
