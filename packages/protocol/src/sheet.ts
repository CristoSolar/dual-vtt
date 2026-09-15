import { CharacterSchema, MulticlassSchema, type Character } from '@daggerheart/character';
import { z } from 'zod';
import {
  applyDamage,
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
  rollDamage,
  rollDuality,
  resolveActionRoll,
  spendGold,
  spendHope,
  vaultCard,
  type ActionResult,
  type AppliedDamage,
  type DamageRoll,
  type DualityRoll,
  type Gold,
  type GoldUnit,
  type IncomingDamageType,
  type LevelUpChoices,
  type Rng,
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

/** A fresh sheet for a newly created character. */
export function createSheet(character: Character): SheetState {
  return {
    character,
    hpMarked: 0,
    stressMarked: 0,
    hope: character.hope,
    armorSlotsMarked: 0,
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
  | 'unknownMulticlass'
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

const noEffect: SheetEffect = {
  vulnerable: false,
  deathMoveRequired: false,
  stressBecameHP: false,
  message: null,
  code: null,
};

/** Builds a coded effect; `params` is only attached when given (exactOptionalPropertyTypes). */
function coded(
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
    sheet: { ...sheet, hpMarked: result.hpMarked },
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
    sheet: { ...sheet, stressMarked: result.stressMarked, hpMarked: result.hpMarked },
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
  /** How many Armor Slots to mark against this hit. */
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
  // Only slots that actually exist can be spent, and direct damage ignores them.
  const marking = options.direct
    ? { sheet, effect: noEffect }
    : markSheetArmorSlot(sheet, options.armorSlotsToMark);
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

/**
 * Moves a card from the vault into the loadout. Outside a rest this marks Stress
 * equal to the card's Recall Cost; during a rest it is free (SRD p.9).
 */
export function recallFromVault(
  sheet: SheetState,
  cardId: string,
  recallCost: number,
  options: { duringRest: boolean; vaulting?: string | undefined },
): RecallResult {
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
  difficulty: number;
  advantage: number;
  disadvantage: number;
  /** Experiences being spent, each costing 1 Hope (SRD p.38). */
  experiences: readonly { name: string; modifier: number }[];
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
  const hopeCost = request.experiences.length;
  const paid = spendSheetHope(sheet, hopeCost);
  if (hopeCost > 0 && paid.sheet === sheet) {
    return { sheet, outcome: null, effect: paid.effect };
  }

  const experienceBonus = request.experiences.reduce((sum, e) => sum + e.modifier, 0);
  const roll = rollDuality({
    modifiers: request.modifiers + experienceBonus,
    advantage: request.advantage,
    disadvantage: request.disadvantage,
    rng,
  });
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
    advancementsTaken: [...leveled.advancementsTaken],
  };

  return {
    sheet: { ...sheet, character },
    ok: true,
    effect: coded('levelledUp', `Levelled up to ${leveled.level}.`, { level: leveled.level }),
  };
}
