import { CharacterSchema, MulticlassSchema, type Character } from '@daggerheart/character';
import { srd, type CardAbility, type CardCost, type Trait } from '@daggerheart/srd-data';
import { z } from 'zod';
import {
  MAX_HOPE,
  MAX_LOADOUT,
  applyDamage,
  avoidDeath,
  blazeOfGlory,
  clearArmorSlot,
  clearHP,
  clearStress,
  gainGold,
  gainHope,
  levelUp,
  markArmorSlot,
  markHP,
  markStress,
  recallCard,
  riskItAll,
  rollDamage,
  rollDuality,
  splitClears,
  resolveActionRoll,
  resolveReactionRoll,
  spendGold,
  spendHope,
  vaultCard,
  type ActionResult,
  type DowntimeEffect,
  type AppliedDamage,
  type DamageRoll,
  type DualityRoll,
  type Gold,
  type GoldUnit,
  type IncomingDamageType,
  canHold,
  equipArmor,
  weaponSwapCost,
  type DeathMoveChoice,
  type DeathMoveOutcome,
  type LevelUpChoices,
  type Rng,
  multiclassCardLevelCap,
  tierForLevel,
} from '@daggerheart/rules';

/**
 * The mutable half of a character: everything that changes during play, kept
 * separate from the immutable creation result.
 *
 * Every function in this module is pure — it takes a sheet and returns a new one —
 * so the same transitions can later be replayed over a socket.
 */

/**
 * The wire and storage shape of a sheet. Used to validate anything arriving from a
 * socket or from disk, so untrusted state is parsed rather than cast.
 */
export const GoldSchema = z.object({
  handfuls: z.number().int().nonnegative(),
  bags: z.number().int().nonnegative(),
  chests: z.number().int().nonnegative(),
});

export const SheetStateSchema = z.object({
  character: CharacterSchema,
  hpMarked: z.number().int().nonnegative(),
  stressMarked: z.number().int().nonnegative(),
  hope: z.number().int().nonnegative(),
  armorSlotsMarked: z.number().int().nonnegative(),
  gold: GoldSchema,
  loadout: z.array(z.string()),
  vault: z.array(z.string()),
  /**
   * Hope slots crossed out by scars from avoiding death. Crossing out the last one
   * ends the character's journey (SRD 2.0 p.53). Defaulted so a sheet claimed
   * before death moves existed still parses.
   */
  scars: z.number().int().min(0).max(MAX_HOPE).default(0),
  /**
   * Set by avoiding death. While unconscious a character cannot act and cannot be
   * targeted; they wake when an ally clears a Hit Point or the party finishes a
   * long rest.
   */
  unconscious: z.boolean().default(false),
  /** Set when a death move ended the character. */
  dead: z.boolean().default(false),
  /**
   * Conditions applied by features and effects, by name. The three standard ones
   * are 'hidden', 'restrained' and 'vulnerable'; anything else is a condition some
   * feature invented, kept as the text it printed.
   *
   * Vulnerable from a full Stress track is derived rather than stored, so it can
   * appear here as well without the two disagreeing: the sheet shows their union.
   */
  conditions: z.array(z.string().min(1).max(40)).max(12).default([]),
  /**
   * The transformation this character carries, by id, or null (SRD 2.0 p.42).
   * A character can have only one, and it does not count against the loadout
   * maximum, which is why it is not a card in `loadout`.
   */
  transformation: z.string().min(1).max(40).nullable().default(null),
  /**
   * The Beastform a Druid is currently in, by id, or null (SRD 2.0 p.20). It is a
   * state the character enters and drops, not a possession, so it is not a card.
   */
  beastform: z.string().min(1).max(40).nullable().default(null),
});

/**
 * The mutable half of a character: everything that changes during play, kept
 * separate from the immutable creation result. Derived from the schema so the wire
 * shape and the in-memory shape can never drift.
 *
 * Every function below is pure — it takes a sheet and returns a new one — so the
 * server and the client can apply the identical transition.
 */
export type SheetState = z.infer<typeof SheetStateSchema>;

/**
 * A fresh sheet for a newly created character. `transformation` is the optional one
 * picked during creation (`CreationState.transformation`), so the sheet carries it
 * exactly as if it had been set later with `setTransformation`.
 */
export function createSheet(
  character: Character,
  { transformation = null }: { transformation?: string | null } = {},
): SheetState {
  return {
    character,
    hpMarked: 0,
    stressMarked: 0,
    hope: character.hope,
    armorSlotsMarked: 0,
    scars: 0,
    unconscious: false,
    dead: false,
    conditions: [],
    transformation,
    beastform: null,
    // Characters start with a handful of gold (SRD p.6).
    gold: { handfuls: 1, bags: 0, chests: 0 },
    loadout: [...character.domainCards],
    vault: [],
  };
}

const pools = (sheet: SheetState) => ({
  hpMarked: sheet.hpMarked,
  hpSlots: sheet.character.hpSlots,
  stressMarked: sheet.stressMarked,
  stressSlots: sheet.character.stressSlots,
});

export type SheetEffectCode =
  | 'damageApplied'
  | 'recalled'
  | 'notEnoughHope'
  | 'noArmorSlots'
  | 'notEnoughGold'
  | 'loadoutFull'
  | 'notEnoughStress'
  | 'cardNotInVault'
  | 'cardNotInLoadout'
  | 'swapNotAllowed'
  | 'levelUpRejected'
  | 'notADruid'
  | 'unknownBeastform'
  | 'beastformTooHigh'
  | 'droppedBeastform'
  | 'unknownCard'
  | 'cardTooHigh'
  | 'unknownMulticlass'
  | 'unknownExperience'
  | 'unknownArmor'
  | 'unknownWeapon'
  | 'needsBothHands'
  | 'armorEquipped'
  | 'hopeFeatureUsed'
  | 'diedInBlazeOfGlory'
  | 'riskedAndLost'
  | 'riskedAndSurvived'
  | 'unconscious'
  | 'scarred'
  | 'lastScar'
  | 'levelledUp';

/** What a mutation wants the UI to say about it, beyond the new state. */
export interface SheetEffect {
  /** Marking the last Stress makes a character Vulnerable (SRD p.39). */
  vulnerable: boolean;
  /** Marking the last Hit Point forces a death move (SRD p.42). */
  deathMoveRequired: boolean;
  /** Set when Stress had to be marked but couldn't, costing 1 HP instead. */
  stressBecameHP: boolean;
  /** English developer text; the web renders from the booleans, then `code`. */
  message: string | null;
  code: SheetEffectCode | null;
  params?: Record<string, string | number>;
}

/** The effect for a change with nothing to say about it. */
export const noEffect: SheetEffect = {
  vulnerable: false,
  deathMoveRequired: false,
  stressBecameHP: false,
  message: null,
  code: null,
};

/** Builds a coded effect; `params` is only attached when given (exactOptionalPropertyTypes). */
export function coded(
  code: SheetEffectCode,
  message: string,
  params?: Record<string, string | number>,
): SheetEffect {
  return params === undefined
    ? { ...noEffect, code, message }
    : { ...noEffect, code, message, params };
}

export interface SheetTransition {
  sheet: SheetState;
  effect: SheetEffect;
}

/** True while the character has no unmarked Stress left (SRD p.39). */
export function isVulnerable(sheet: SheetState): boolean {
  return sheet.stressMarked >= sheet.character.stressSlots;
}

export function markSheetHP(sheet: SheetState, amount = 1): SheetTransition {
  const result = markHP(pools(sheet), amount);
  return {
    // "If you mark your last Hit Point, you automatically drop out of this form."
    sheet: { ...sheet, hpMarked: result.hpMarked, ...(result.deathMoveRequired ? { beastform: null } : {}) },
    effect: {
      ...noEffect,
      deathMoveRequired: result.deathMoveRequired,
      message: result.deathMoveRequired ? 'Last Hit Point marked — make a death move.' : null,
    },
  };
}

export function clearSheetHP(sheet: SheetState, amount = 1): SheetTransition {
  return { sheet: { ...sheet, hpMarked: clearHP(pools(sheet), amount).hpMarked }, effect: noEffect };
}

export function markSheetStress(sheet: SheetState, amount = 1): SheetTransition {
  const result = markStress(pools(sheet), amount);
  const messages: string[] = [];
  if (result.hpMarkedInstead > 0) messages.push('No Stress left — marked 1 Hit Point instead.');
  if (result.vulnerable) messages.push('All Stress marked — you are Vulnerable.');
  if (result.deathMoveRequired) messages.push('Last Hit Point marked — make a death move.');

  return {
    sheet: {
      ...sheet,
      stressMarked: result.stressMarked,
      hpMarked: result.hpMarked,
      ...(result.deathMoveRequired ? { beastform: null } : {}),
    },
    effect: {
      vulnerable: result.vulnerable,
      deathMoveRequired: result.deathMoveRequired,
      stressBecameHP: result.hpMarkedInstead > 0,
      message: messages.length > 0 ? messages.join(' ') : null,
      code: null,
    },
  };
}

export function clearSheetStress(sheet: SheetState, amount = 1): SheetTransition {
  return {
    sheet: { ...sheet, stressMarked: clearStress(pools(sheet), amount).stressMarked },
    effect: noEffect,
  };
}

export function gainSheetHope(sheet: SheetState, amount = 1): SheetTransition {
  return { sheet: { ...sheet, hope: gainHope(sheet.hope, amount) }, effect: noEffect };
}

export function spendSheetHope(sheet: SheetState, amount = 1): SheetTransition {
  const hope = spendHope(sheet.hope, amount);
  if (hope === null) {
    return {
      sheet,
      effect: coded('notEnoughHope', `Not enough Hope (need ${amount}).`, { amount }),
    };
  }
  return { sheet: { ...sheet, hope }, effect: noEffect };
}

/**
 * The trait a character's Spellcast Rolls use: their subclass's, or the
 * multiclass subclass's when their own has none (Guardians and Warriors).
 */
export function spellcastTraitOf(sheet: SheetState): Trait | null {
  const subclasses = srd().subclasses;
  const own = subclasses.find((s) => s.id === sheet.character.subclassId)?.spellcastTrait ?? null;
  if (own !== null) return own;
  const multiclass = sheet.character.multiclass;
  if (multiclass === null) return null;
  return subclasses.find((s) => s.id === multiclass.subclassId)?.spellcastTrait ?? null;
}

/** A domain card's usable abilities, read from the SRD card mechanics. */
export function cardAbilities(cardId: string): readonly CardAbility[] {
  return srd().cardMechanics.find((entry) => entry.id === cardId)?.abilities ?? [];
}

export interface CardCostTransition extends SheetTransition {
  ok: boolean;
}

/**
 * Pays what using a card costs: Hope spent, Armor Slots marked, Stress marked.
 * Hope and Armor Slots the character does not have refuse the whole use. Stress
 * cannot be refused: with no slot left it marks a Hit Point instead, exactly as
 * marking Stress anywhere else on the sheet does (SRD p.39).
 */
export function payCardCost(sheet: SheetState, cost: CardCost): CardCostTransition {
  if (sheet.hope < cost.hope) {
    return {
      ok: false,
      sheet,
      effect: coded('notEnoughHope', `Not enough Hope (need ${cost.hope}).`, { amount: cost.hope }),
    };
  }
  if (sheet.character.armorScore - sheet.armorSlotsMarked < cost.armor) {
    return { ok: false, sheet, effect: coded('noArmorSlots', 'No Armor Slots available.') };
  }
  let next = sheet;
  if (cost.hope > 0) next = spendSheetHope(next, cost.hope).sheet;
  if (cost.armor > 0) next = markSheetArmorSlot(next, cost.armor).sheet;
  if (cost.stress === 0) return { ok: true, sheet: next, effect: noEffect };
  const marked = markSheetStress(next, cost.stress);
  return { ok: true, sheet: marked.sheet, effect: marked.effect };
}

const armorSlots = (sheet: SheetState) => ({
  marked: sheet.armorSlotsMarked,
  score: sheet.character.armorScore,
});

export function markSheetArmorSlot(sheet: SheetState, amount = 1): SheetTransition {
  const result = markArmorSlot(armorSlots(sheet), amount);
  return {
    sheet: { ...sheet, armorSlotsMarked: result.marked },
    effect:
      result.markedNow === 0
        ? coded('noArmorSlots', 'No Armor Slots available.')
        : noEffect,
  };
}

export function clearSheetArmorSlot(sheet: SheetState, amount = 1): SheetTransition {
  return {
    sheet: { ...sheet, armorSlotsMarked: clearArmorSlot(armorSlots(sheet), amount).marked },
    effect: noEffect,
  };
}

export function gainSheetGold(sheet: SheetState, amount = 1, unit: GoldUnit = 'handfuls') {
  return { sheet: { ...sheet, gold: gainGold(sheet.gold, amount, unit) }, effect: noEffect };
}

export function spendSheetGold(
  sheet: SheetState,
  amount = 1,
  unit: GoldUnit = 'handfuls',
): SheetTransition {
  const gold = spendGold(sheet.gold, amount, unit);
  if (gold === null) {
    return {
      sheet,
      effect: coded('notEnoughGold', `Not enough gold (need ${amount} ${unit}).`, {
        amount,
        unit,
      }),
    };
  }
  return { sheet: { ...sheet, gold }, effect: noEffect };
}

export interface TakeDamageOptions {
  incoming: number;
  damageType: IncomingDamageType;
  /** Direct damage can't be reduced by marking Armor Slots (SRD p.40). */
  direct: boolean;
  /**
   * How many Armor Slots to mark against this hit. The SRD allows one per attack,
   * so anything above that is capped rather than rejected.
   */
  armorSlotsToMark: number;
}

export interface TakeDamageResult extends SheetTransition {
  applied: AppliedDamage;
}

/**
 * Applies incoming damage: marks the Armor Slots the player chose, asks the rules
 * engine how many Hit Points that leaves, then marks them.
 */
export function takeDamage(sheet: SheetState, options: TakeDamageOptions): TakeDamageResult {
  // Only slots that actually exist can be spent, direct damage ignores them, and an
  // attack may be answered with at most one slot (SRD p.72).
  const marking = options.direct
    ? { sheet, effect: noEffect }
    : markSheetArmorSlot(sheet, Math.min(1, Math.max(0, options.armorSlotsToMark)));
  const slotsUsed = marking.sheet.armorSlotsMarked - sheet.armorSlotsMarked;

  const applied = applyDamage({
    incoming: options.incoming,
    thresholds: sheet.character.thresholds,
    damageType: options.damageType,
    armorSlotsMarked: slotsUsed,
    direct: options.direct,
  });

  const marked = markSheetHP(marking.sheet, applied.hpMarked);
  return {
    sheet: marked.sheet,
    applied,
    effect: {
      ...marked.effect,
      message:
        marked.effect.message ??
        `${applied.severity} damage — marked ${applied.hpMarked} HP.`,
      code: marked.effect.code ?? 'damageApplied',
      params: { severity: applied.severity, hpMarked: applied.hpMarked },
    },
  };
}

export interface RecallResult extends SheetTransition {
  ok: boolean;
}

export interface DeathMoveTransition extends SheetTransition {
  outcome: DeathMoveOutcome;
}

/**
 * Makes a death move (SRD 2.0 p.53).
 *
 * Blazing out and losing a Risk It All both end the character; avoiding death drops
 * them unconscious and may cost a Hope slot for good. Surviving a Risk It All clears
 * the Hope Die's worth, split the way the player asked for.
 */
export function makeDeathMove(
  sheet: SheetState,
  choice: DeathMoveChoice,
  prefer: 'hp' | 'stress',
  rng: Rng,
): DeathMoveTransition {
  if (choice === 'blazeOfGlory') {
    const outcome = blazeOfGlory();
    return {
      sheet: { ...sheet, dead: true },
      outcome,
      effect: coded('diedInBlazeOfGlory', 'Went out in a blaze of glory.'),
    };
  }

  if (choice === 'avoidDeath') {
    const outcome = avoidDeath(sheet.character.level, sheet.scars, rng);
    const scars = sheet.scars + (outcome.scarred ? 1 : 0);
    return {
      sheet: {
        ...sheet,
        scars,
        unconscious: !outcome.died,
        dead: outcome.died,
        // A crossed-out slot is gone, so Hope in hand cannot sit above what is left.
        hope: Math.min(sheet.hope, MAX_HOPE - scars),
      },
      outcome,
      effect: outcome.died
        ? coded('lastScar', 'The last Hope slot is crossed out; the journey ends here.')
        : coded(
            outcome.scarred ? 'scarred' : 'unconscious',
            outcome.scarred ? 'Unconscious, and scarred.' : 'Unconscious.',
            { hopeDie: outcome.hopeDie },
          ),
    };
  }

  const outcome = riskItAll(rng);
  if (outcome.died) {
    return {
      sheet: { ...sheet, dead: true },
      outcome,
      effect: coded('riskedAndLost', 'The Fear Die was higher; the journey ends here.'),
    };
  }

  // A match clears both tracks outright; otherwise the Hope Die is divided.
  const split =
    outcome.clears === null
      ? { hp: sheet.hpMarked, stress: sheet.stressMarked }
      : splitClears(outcome.clears, prefer, sheet.hpMarked, sheet.stressMarked);

  return {
    sheet: {
      ...sheet,
      hpMarked: sheet.hpMarked - split.hp,
      stressMarked: sheet.stressMarked - split.stress,
    },
    outcome,
    effect: coded('riskedAndSurvived', 'Still standing.', {
      hp: split.hp,
      stress: split.stress,
    }),
  };
}

export interface EquipResult extends SheetTransition {
  ok: boolean;
}

/**
 * Puts on a different piece of armor, or takes it off (SRD 2.0 p.55).
 *
 * The piece worn sets both the Armor Score and the base damage thresholds, so this
 * rebuilds the two numbers the sheet had been carrying since character creation.
 * Marked Armor Slots belong to the piece, so changing armor leaves none marked.
 */
export function equipArmorOnSheet(sheet: SheetState, armorId: string | null): EquipResult {
  const armor = armorId === null ? null : srd().armor.find((a) => a.id === armorId) ?? null;
  if (armorId !== null && armor === null) {
    return { sheet, ok: false, effect: coded('unknownArmor', 'No such armor in the SRD.') };
  }

  const worn = equipArmor(armor, sheet.character.level);
  return {
    sheet: {
      ...sheet,
      armorSlotsMarked: 0,
      character: {
        ...sheet.character,
        armorScore: worn.armorScore,
        major: worn.thresholds.major,
        severe: worn.thresholds.severe,
        thresholds: worn.thresholds,
        equipment: { ...sheet.character.equipment, armorId: armorId ?? '' },
      },
    },
    ok: true,
    effect: coded('armorEquipped', 'Armor changed.', {
      score: worn.armorScore,
      major: worn.thresholds.major,
      severe: worn.thresholds.severe,
    }),
  };
}

/**
 * Swaps a weapon into an active slot. Free during a rest, a Stress otherwise, and
 * refused when the two weapons need more hands than a character has.
 */
export function equipWeaponOnSheet(
  sheet: SheetState,
  slot: 'primary' | 'secondary',
  weaponId: string | null,
  duringRest: boolean,
): EquipResult {
  const weapon = weaponId === null ? null : srd().weapons.find((w) => w.id === weaponId) ?? null;
  if (weaponId !== null && weapon === null) {
    return { sheet, ok: false, effect: coded('unknownWeapon', 'No such weapon in the SRD.') };
  }

  const equipment = sheet.character.equipment;
  const other =
    slot === 'primary'
      ? equipment.secondaryWeaponId === null
        ? null
        : srd().weapons.find((w) => w.id === equipment.secondaryWeaponId) ?? null
      : srd().weapons.find((w) => w.id === equipment.primaryWeaponId) ?? null;

  const primary = slot === 'primary' ? weapon : other;
  const secondary = slot === 'primary' ? other : weapon;
  if (!canHold(primary, secondary)) {
    return { sheet, ok: false, effect: coded('needsBothHands', 'That pair needs more hands.') };
  }

  const cost = weaponSwapCost(duringRest);
  const paid = cost === 0 ? { sheet, effect: noEffect } : markSheetStress(sheet, cost);
  // Marking Stress can cost a Hit Point instead when the track is full, which the
  // transition reports; either way the swap happens.
  const next: SheetState = {
    ...paid.sheet,
    character: {
      ...paid.sheet.character,
      equipment:
        slot === 'primary'
          ? { ...equipment, primaryWeaponId: weaponId ?? equipment.primaryWeaponId }
          : { ...equipment, secondaryWeaponId: weaponId },
    },
  };
  return { sheet: next, ok: true, effect: cost === 0 ? noEffect : paid.effect };
}

/** Waking from unconsciousness, which an ally's healing or a long rest does. */
/**
 * A Druid's Beastform (SRD 2.0 p.20).
 *
 * Entering costs a Stress and is limited to forms of the character's tier or
 * lower; dropping out is free and can happen at any time. The form's Evasion
 * bonus and attack trait are derived through `beastformOf` rather than written
 * into the character, so dropping out restores the original numbers exactly.
 */
export function enterBeastform(sheet: SheetState, beastformId: string): SheetTransition {
  const druid =
    sheet.character.classId === 'druid' || sheet.character.multiclass?.classId === 'druid';
  if (!druid) return { sheet, effect: coded('notADruid', 'Only a Druid can take a Beastform.') };

  const form = srd().beastforms.find((b) => b.id === beastformId);
  if (form === undefined) {
    return { sheet, effect: coded('unknownBeastform', 'That Beastform does not exist.') };
  }
  const tier = tierForLevel(sheet.character.level);
  if (form.tier > tier) {
    return {
      sheet,
      effect: coded('beastformTooHigh', `${form.name} is above your tier.`, {
        form: form.name,
        tier,
      }),
    };
  }

  const stressed = markSheetStress(sheet, 1);
  return { sheet: { ...stressed.sheet, beastform: form.id }, effect: stressed.effect };
}

/** Dropping out of a Beastform, which the character may do at any time, for free. */
export function dropBeastform(sheet: SheetState): SheetTransition {
  if (sheet.beastform === null) return { sheet, effect: noEffect };
  return {
    sheet: { ...sheet, beastform: null },
    effect: coded('droppedBeastform', 'Dropped out of the Beastform.'),
  };
}

/** The Beastform this sheet is in, or null. */
export function beastformOf(sheet: SheetState) {
  if (sheet.beastform === null) return null;
  return srd().beastforms.find((b) => b.id === sheet.beastform) ?? null;
}

/** Evasion including a Beastform's bonus, which is added while transformed. */
export function evasionOf(sheet: SheetState): number {
  return sheet.character.evasion + (beastformOf(sheet)?.evasionBonus ?? 0);
}

export function wake(sheet: SheetState): SheetState {
  return sheet.unconscious ? { ...sheet, unconscious: false } : sheet;
}

/**
 * Applies one downtime move to a sheet.
 *
 * The rules engine says how much the move restores; this puts it where it belongs.
 * A null amount means the whole track, which is what a long rest does.
 */
export function applyDowntime(sheet: SheetState, effect: DowntimeEffect): SheetTransition {
  const all = effect.amount === null;
  const amount = effect.amount ?? 0;

  switch (effect.move) {
    case 'tendToWounds':
      return clearSheetHP(sheet, all ? sheet.hpMarked : amount);
    case 'clearStress':
      return clearSheetStress(sheet, all ? sheet.stressMarked : amount);
    case 'repairArmor':
      return clearSheetArmorSlot(sheet, all ? sheet.armorSlotsMarked : amount);
    case 'prepare':
      return gainSheetHope(sheet, amount);
    case 'workOnProject':
    default:
      // The project's progress is a countdown the GM keeps, not a resource here.
      return { sheet, effect: noEffect };
  }
}

/** A domain card's Recall Cost, from the SRD. Ids are the same in every locale. */
export function recallCostOf(cardId: string): number {
  return srd().domainCards.find((card) => card.id === cardId)?.recallCost ?? 0;
}

/**
 * Moves a card from the vault into the loadout. Outside a rest this marks Stress
 * equal to the card's Recall Cost; during a rest it is free (SRD p.9).
 *
 * The cost is the card's own, looked up here so the client and the server always
 * charge the same thing.
 */
export function recallFromVault(
  sheet: SheetState,
  cardId: string,
  options: { duringRest: boolean; vaulting?: string | undefined },
): RecallResult {
  const recallCost = recallCostOf(cardId);
  const result = recallCard({
    loadout: sheet.loadout,
    vault: sheet.vault,
    cardId,
    recallCost,
    duringRest: options.duringRest,
    vaulting: options.vaulting,
    availableStress: sheet.character.stressSlots - sheet.stressMarked,
  });

  if (!result.ok) {
    return { sheet, ok: false, effect: recallError(result.error) };
  }

  // The rules package returns readonly arrays; the wire shape is plain JSON arrays.
  const swapped: SheetState = {
    ...sheet,
    loadout: [...result.result.loadout],
    vault: [...result.result.vault],
  };
  if (result.result.stressCost === 0) {
    return { sheet: swapped, ok: true, effect: noEffect };
  }

  const stressed = markSheetStress(swapped, result.result.stressCost);
  return {
    sheet: stressed.sheet,
    ok: true,
    effect: {
      ...stressed.effect,
      message:
        stressed.effect.message ??
        `Recalled outside a rest — marked ${result.result.stressCost} Stress.`,
      code: stressed.effect.code ?? 'recalled',
      params: { stressCost: result.result.stressCost },
    },
  };
}

function recallError(error: string): SheetEffect {
  switch (error) {
    case 'loadoutFull':
      return coded('loadoutFull', 'Loadout is full — choose a card to move to the vault.');
    case 'notEnoughStress':
      return coded('notEnoughStress', 'Not enough unmarked Stress to pay this card’s Recall Cost.');
    case 'cardNotInVault':
      return coded('cardNotInVault', 'That card is not in the vault.');
    case 'cardNotInLoadout':
      return coded('cardNotInLoadout', 'That card is not in the loadout.');
    default:
      return coded('swapNotAllowed', 'That swap is not allowed.');
  }
}

/** Moves a card from the loadout to the vault, which is always free (SRD p.9). */
export function sendToVault(sheet: SheetState, cardId: string): RecallResult {
  const result = vaultCard({ loadout: sheet.loadout, vault: sheet.vault }, cardId);
  if (!result.ok) {
    return { sheet, ok: false, effect: recallError(result.error) };
  }
  return {
    sheet: { ...sheet, loadout: [...result.result.loadout], vault: [...result.result.vault] },
    ok: true,
    effect: noEffect,
  };
}

export interface DualityRollRequest {
  label: string;
  /** Trait, Proficiency, or other flat modifiers already summed by the caller. */
  modifiers: number;
  /**
   * The Difficulty to beat, or null when the GM keeps it and calls success at the
   * table. Hope, Fear and criticals are settled either way.
   */
  difficulty: number | null;
  advantage: number;
  disadvantage: number;
  /** Names of the Experiences being leveraged; each costs a Hope (SRD p.38). */
  experiences: readonly string[];
  /** Advantage dice from allies using Help an Ally. Optional; defaults to none. */
  helpDice?: number;
  /**
   * A reaction roll rather than an action roll. Reactions generate no Hope or
   * Fear, and a critical clears no Stress, but it does negate the effects a mere
   * success would have left standing (SRD 2.0 p.48).
   */
  reaction?: boolean;
}

export interface DualityRollOutcome {
  roll: DualityRoll;
  result: ActionResult;
}

export interface DualityRollTransition extends SheetTransition {
  outcome: DualityRollOutcome | null;
}

/**
 * Makes an action roll: spends a Hope per Experience used, rolls, then applies the
 * Hope, Fear, and Stress the outcome grants (SRD p.36).
 *
 * Fear goes to the GM, so it is reported in the outcome rather than stored here.
 */
export function makeDualityRoll(
  sheet: SheetState,
  request: DualityRollRequest,
  rng: Rng,
): DualityRollTransition {
  // Every Experience named must be one this character actually has: the modifier is
  // read from the sheet, never taken from the request.
  const leveraged = request.experiences.map((name) => sheet.character.experiences[name]);
  if (leveraged.some((modifier) => modifier === undefined)) {
    return {
      sheet,
      outcome: null,
      effect: coded('unknownExperience', 'That Experience is not on this character.'),
    };
  }

  const hopeCost = request.experiences.length;
  const paid = spendSheetHope(sheet, hopeCost);
  if (hopeCost > 0 && paid.sheet === sheet) {
    return { sheet, outcome: null, effect: paid.effect };
  }

  const experienceBonus = leveraged.reduce<number>((sum, modifier) => sum + (modifier ?? 0), 0);
  const roll = rollDuality({
    modifiers: request.modifiers + experienceBonus,
    advantage: request.advantage,
    disadvantage: request.disadvantage,
    helpDice: request.helpDice ?? 0,
    rng,
  });
  if (request.reaction === true) {
    // A reaction pays for its Experiences but earns nothing back: no Hope, no Fear,
    // and no Stress cleared on a critical.
    const reaction = resolveReactionRoll(roll, request.difficulty);
    const result: ActionResult = {
      outcome: reaction.critical
        ? 'criticalSuccess'
        : reaction.success === null
          ? roll.withHope
            ? 'withHope'
            : 'withFear'
          : reaction.success
            ? roll.withHope
              ? 'successHope'
              : 'successFear'
            : roll.withHope
              ? 'failureHope'
              : 'failureFear',
      success: reaction.success,
      critical: reaction.critical,
      withHope: roll.withHope,
      criticalDamage: reaction.critical,
      hopeGained: 0,
      fearGained: 0,
      stressCleared: 0,
    };
    return { sheet: paid.sheet, outcome: { roll, result }, effect: noEffect };
  }

  const result = resolveActionRoll(roll, request.difficulty);

  let next = paid.sheet;
  if (result.hopeGained > 0) next = gainSheetHope(next, result.hopeGained).sheet;
  if (result.stressCleared > 0) next = clearSheetStress(next, result.stressCleared).sheet;

  return { sheet: next, outcome: { roll, result }, effect: noEffect };
}

/** Rolls weapon or spell damage. Proficiency multiplies dice only (SRD p.39). */
export function makeDamageRoll(
  options: {
    dice: { count: number; die: number };
    proficiency: number;
    modifier: number;
    critical: boolean;
  },
  rng: Rng,
): DamageRoll {
  return rollDamage({ ...options, rng });
}

export interface LevelUpTransition extends SheetTransition {
  ok: boolean;
}

/** Applies a level-up through the rules engine and rebases the sheet on the result. */
export function applyLevelUp(sheet: SheetState, choices: LevelUpChoices): LevelUpTransition {
  const result = levelUp(sheet.character, choices);
  if (!result.ok) {
    return { sheet, ok: false, effect: coded('levelUpRejected', result.error) };
  }

  const leveled = result.character;

  // A multiclassed PC draws from their new domain only up to half their level,
  // rounded up (SRD 2.0 p.54). The rules package works on ids alone, so the check
  // lives here, where the card's domain and level can be looked up.
  const gained = leveled.domainCards.filter((id) => !sheet.character.domainCards.includes(id));
  const ownDomains = srd().classes.find((c) => c.id === sheet.character.classId)?.domains ?? [];
  for (const id of gained) {
    const card = srd().domainCards.find((c) => c.id === id);
    if (card === undefined) {
      return { sheet, ok: false, effect: coded('unknownCard', 'That domain card does not exist.') };
    }
    const fromMulticlass =
      leveled.multiclass !== null &&
      card.domain === leveled.multiclass.domainId &&
      !ownDomains.includes(card.domain);
    const cap = fromMulticlass ? multiclassCardLevelCap(leveled.level) : leveled.level;
    if (card.level > cap) {
      return {
        sheet,
        ok: false,
        effect: coded(
          'cardTooHigh',
          `${card.name} is above the level ${cap} limit for that domain.`,
          { card: card.name, cap },
        ),
      };
    }
  }

  // The rules package types a multiclass's ids as plain strings; the character model
  // requires real class and domain ids, so it is validated rather than cast.
  let multiclass: Character['multiclass'] = null;
  if (leveled.multiclass !== null) {
    const parsed = MulticlassSchema.safeParse(leveled.multiclass);
    if (!parsed.success) {
      return {
        sheet,
        ok: false,
        effect: coded('unknownMulticlass', 'That multiclass names an unknown class or domain.'),
      };
    }
    multiclass = parsed.data;
  }
  const character: Character = {
    ...sheet.character,
    level: leveled.level,
    proficiency: leveled.proficiency,
    evasion: leveled.evasion,
    hpSlots: leveled.hpSlots,
    stressSlots: leveled.stressSlots,
    experiences: leveled.experiences,
    markedTraits: [...leveled.markedTraits],
    major: leveled.major,
    severe: leveled.severe,
    thresholds: { major: leveled.major, severe: leveled.severe },
    domainCards: [...leveled.domainCards],
    multiclass,
    subclassTier: leveled.subclassTier,
    advancementsTaken: [...leveled.advancementsTaken],
  };

  // A card gained on levelling up is one the PC can play: it goes into the loadout
  // while there is room, and into the vault once the loadout is full (SRD p.8).
  const loadout = [...sheet.loadout];
  const vault = [...sheet.vault];
  for (const id of gained) {
    if (loadout.includes(id) || vault.includes(id)) continue;
    (loadout.length < MAX_LOADOUT ? loadout : vault).push(id);
  }

  return {
    sheet: { ...sheet, character, loadout, vault },
    ok: true,
    effect: coded('levelledUp', `Levelled up to ${leveled.level}.`, { level: leveled.level }),
  };
}
