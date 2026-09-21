import { MAX_FEAR } from '@daggerheart/rules';
import { z } from 'zod';

import { CountdownKindSchema, CountdownLoopSchema } from './countdowns.js';
import { GridSchema, SceneImageSchema, TokenSchema, VisionModeSchema, WallSchema } from './map.js';
import { RollEntrySchema } from './rollLog.js';
import {
  DeathMoveChoiceSchema,
  DowntimeMoveSchema,
  RestKindSchema,
  RoomStateSchema,
  type RoomState,
} from './room.js';
import { SheetStateSchema } from './sheet.js';

/** Socket.io channel names. Kept in one place so both ends agree. */
export const CHANNEL = {
  /** client -> server */
  intent: 'intent',
  joinCampaign: 'joinCampaign',
  claimCharacter: 'claimCharacter',
  /** server -> client */
  roomState: 'roomState',
  roomPatch: 'roomPatch',
  rolled: 'rolled',
  rejected: 'rejected',
  /** Sent only to the socket whose intent produced it. */
  effect: 'effect',
} as const;

const amount = z.number().int().min(1).max(99);
const characterId = z.string().min(1).max(64);

const GoldUnitSchema = z.enum(['handfuls', 'bags', 'chests']);
const DamageTypeSchema = z.enum(['physical', 'magic', 'both']);

const AdvancementSchema = z.enum([
  'traits',
  'hitPoint',
  'stress',
  'experience',
  'domainCard',
  'evasion',
  'subclass',
  'proficiency',
  'multiclass',
]);

/** Intents that mutate one character. A player may only send these for their own. */
export const CharacterRoomEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('markHP'), characterId, amount: amount.default(1) }),
  z.object({ type: z.literal('clearHP'), characterId, amount: amount.default(1) }),
  z.object({ type: z.literal('markStress'), characterId, amount: amount.default(1) }),
  z.object({ type: z.literal('clearStress'), characterId, amount: amount.default(1) }),
  z.object({ type: z.literal('gainHope'), characterId, amount: amount.default(1) }),
  z.object({ type: z.literal('spendHope'), characterId, amount: amount.default(1) }),
  z.object({ type: z.literal('markArmorSlot'), characterId, amount: amount.default(1) }),
  z.object({ type: z.literal('clearArmorSlot'), characterId, amount: amount.default(1) }),
  z.object({
    type: z.literal('gainGold'),
    characterId,
    amount: amount.default(1),
    unit: GoldUnitSchema.default('handfuls'),
  }),
  z.object({
    type: z.literal('spendGold'),
    characterId,
    amount: amount.default(1),
    unit: GoldUnitSchema.default('handfuls'),
  }),
  z.object({
    // The client states the hit; the server computes the HP via applyDamage.
    type: z.literal('takeDamage'),
    characterId,
    incoming: z.number().int().min(0).max(999),
    damageType: DamageTypeSchema,
    direct: z.boolean(),
    armorSlotsToMark: z.number().int().min(0).max(12),
  }),
  z.object({
    // The Recall Cost is the card's, read from the SRD on the server — a client
    // that sent its own could recall anything for free.
    type: z.literal('recallCard'),
    characterId,
    cardId: z.string().min(1),
    vaulting: z.string().min(1).optional(),
  }),
  z.object({ type: z.literal('vaultCard'), characterId, cardId: z.string().min(1) }),
  z.object({
    // Replaces the whole list. The wizard writes it once at creation; after that it
    // is the player's to keep, which it had no way to be.
    type: z.literal('setInventory'),
    characterId,
    inventory: z.array(z.string().min(1).max(120)).max(60),
  }),
  z.object({
    // A class Hope feature costs 3 Hope (SRD 2.0 p.49). The server spends it, so a
    // client cannot activate one it cannot afford.
    type: z.literal('useHopeFeature'),
    characterId,
  }),
  z.object({
    // Changing armor rebuilds the Armor Score and the damage thresholds, which the
    // server does from the SRD rather than trusting a client's arithmetic.
    type: z.literal('equipArmor'),
    characterId,
    armorId: z.string().min(1).max(64).nullable(),
  }),
  z.object({
    // Free during a rest, a Stress otherwise. Which of those applies is the room's
    // to know, so the client does not say.
    type: z.literal('equipWeapon'),
    characterId,
    slot: z.enum(['primary', 'secondary']),
    weaponId: z.string().min(1).max(64).nullable(),
  }),
  z.object({
    // Spends 3 Hope to open a Tag Team Roll with another PC (SRD 2.0 p.49).
    type: z.literal('startTagTeam'),
    characterId,
    partnerCharacterId: z.string().min(1).max(64),
  }),
  z.object({
    // The initiator picks whose roll applies to both actions.
    type: z.literal('chooseTagTeam'),
    characterId,
    rollOf: z.string().min(1).max(64),
  }),
  z.object({
    // A Druid entering a Beastform, or dropping out of one with null. Entering
    // costs a Stress, which the reducer marks.
    type: z.literal('setBeastform'),
    characterId,
    beastformId: z.string().min(1).max(40).nullable(),
  }),
  z.object({
    // A character carries at most one transformation; null puts it down.
    type: z.literal('setTransformation'),
    characterId,
    transformation: z.string().min(1).max(40).nullable(),
  }),
  z.object({
    // Replaces the whole list, which is how a chip row edits: the client sends what
    // the character should have, not a diff.
    type: z.literal('setConditions'),
    characterId,
    conditions: z.array(z.string().min(1).max(40)).max(12),
  }),
  z.object({
    // Made when the last Hit Point is marked. The dice are the server's.
    type: z.literal('deathMove'),
    characterId,
    choice: DeathMoveChoiceSchema,
    /**
     * Which track a surviving Risk It All should clear first; the Hope Die's
     * remainder spills into the other. Ignored by the other two moves.
     */
    prefer: z.enum(['hp', 'stress']).default('hp'),
  }),
  z.object({
    // One of this character's two downtime moves. The rest must be open, and how
    // much it restores is rolled on the server.
    type: z.literal('downtimeMove'),
    characterId,
    move: DowntimeMoveSchema,
    /** Tending wounds or repairing armor can be done for an ally instead. */
    targetId: z.string().min(1).max(64).optional(),
    /** Preparing alongside the party is worth 2 Hope rather than 1. */
    withParty: z.boolean().default(false),
  }),
  z.object({
    type: z.literal('levelUp'),
    characterId,
    choices: z.object({
      advancements: z.array(AdvancementSchema).min(1).max(2),
      traitsToIncrease: z.array(z.string()).max(2).optional(),
      experiencesToIncrease: z.array(z.string()).max(2).optional(),
      newExperienceName: z.string().min(1).optional(),
      multiclass: z
        .object({
          classId: z.string().min(1),
          domainId: z.string().min(1),
          subclassId: z.string().min(1),
        })
        .optional(),
      domainCardId: z.string().min(1).optional(),
      /** The card the 'domainCard' advancement grants, separate from step four's. */
      extraDomainCardId: z.string().min(1).optional(),
    }),
  }),
  z.object({
    // Dice are rolled on the server, so the client sends only the roll's parameters.
    type: z.literal('rollDuality'),
    characterId,
    request: z.object({
      label: z.string().min(1).max(80),
      modifiers: z.number().int().min(-20).max(20),
      difficulty: z.number().int().min(0).max(60),
      advantage: z.number().int().min(0).max(10),
      disadvantage: z.number().int().min(0).max(10),
      /** Allies using Help an Ally, each of whom rolls an advantage die. */
      helpDice: z.number().int().min(0).max(6).default(0),
      /** A reaction roll earns no Hope or Fear and clears no Stress on a critical. */
      reaction: z.boolean().default(false),
      // Names only. The modifiers come from the character's own Experiences, so an
      // unbounded bonus cannot be dialled in from the client.
      experiences: z.array(z.string().min(1)).max(5),
    }),
  }),
  z.object({
    type: z.literal('rollDamage'),
    characterId,
    label: z.string().min(1).max(80),
    dice: z.object({
      count: z.number().int().min(0).max(20),
      die: z.number().int().min(2).max(100),
    }),
    // Proficiency is the character's, read from the sheet on the server.
    modifier: z.number().int().min(-20).max(99),
    critical: z.boolean(),
  }),
]);
export type CharacterRoomEvent = z.infer<typeof CharacterRoomEventSchema>;

/** Intents only the GM may send. */
export const GameMasterRoomEventSchema = z.discriminatedUnion('type', [
  z.object({
    // A fate roll, or one of the printed hazards (SRD 2.0 p.92). The GM says what
    // it is for; the server rolls it and logs the number.
    type: z.literal('rollFate'),
    kind: z.enum(['fate', 'fallVeryClose', 'fallClose', 'fallFar', 'collision']),
    label: z.string().min(1).max(80),
  }),
  z.object({
    // Sets a named adversary pool to a number of tokens; null removes the pool.
    type: z.literal('setAdversaryPool'),
    name: z.string().min(1).max(60),
    tokens: z.number().int().min(0).max(99).nullable(),
  }),
  z.object({
    // A scene ending clears every pool (SRD 2.0 p.94).
    type: z.literal('clearAdversaryPools'),
  }),
  z.object({
    // Turns the optional Spotlight Tracker on with this many tokens each, refills
    // it at the same number, or turns it off with null (SRD 2.0 p.47).
    type: z.literal('setSpotlightTracker'),
    tokensPerPlayer: z.number().int().min(1).max(10).nullable(),
  }),
  z.object({
    // Opens a group action roll: this character leads, everyone else who rolls
    // while it is open is collaborating (SRD 2.0 p.48).
    type: z.literal('startGroupAction'),
    leadCharacterId: z.string().min(1).max(64),
  }),
  z.object({
    // Abandons a group action without anyone leading it.
    type: z.literal('cancelGroupAction'),
  }),
  z.object({ type: z.literal('gainFear'), amount: amount.default(1) }),
  z.object({ type: z.literal('spendFear'), amount: amount.default(1) }),
  z.object({ type: z.literal('setSpotlight'), spotlight: z.string().min(1).nullable() }),
  z.object({ type: z.literal('setEnvironment'), environmentId: z.string().min(1).nullable() }),
  z.object({
    type: z.literal('addCountdown'),
    id: z.string().min(1),
    name: z.string().min(1).max(80),
    kind: CountdownKindSchema,
    startingValue: z.number().int().min(1).max(99),
    loop: CountdownLoopSchema,
  }),
  z.object({
    type: z.literal('advanceCountdown'),
    id: z.string().min(1),
    amount: z.number().int().min(1).max(99),
  }),
  z.object({
    // Sets a countdown's value outright: backing one off a tick, correcting a
    // miscount, or putting it back where it started. Advancing stays its own
    // intent, because advancing is what loops and increments react to.
    type: z.literal('setCountdownValue'),
    id: z.string().min(1),
    value: z.number().int().min(0).max(99),
  }),
  z.object({ type: z.literal('removeCountdown'), id: z.string().min(1) }),
  z.object({
    type: z.literal('advanceCountdownsForRest'),
    amount: z.number().int().min(1).max(9).default(1),
  }),
  z.object({
    type: z.literal('addAdversary'),
    instanceId: z.string().min(1),
    adversaryId: z.string().min(1),
    name: z.string().min(1).max(80),
  }),
  z.object({ type: z.literal('removeAdversary'), instanceId: z.string().min(1) }),
  z.object({
    // Opens downtime for the whole party. The server rolls the GM's Fear and,
    // on a long rest, advances the long-term countdowns.
    type: z.literal('beginRest'),
    kind: RestKindSchema,
  }),
  z.object({ type: z.literal('endRest') }),
  z.object({
    // The GM's d20. The stat block supplies the modifier and the damage, so the
    // client states only who is swinging at whom and how.
    type: z.literal('rollAdversaryAttack'),
    instanceId: z.string().min(1),
    /** A character in the room, whose Evasion the roll is measured against. */
    targetId: z.string().min(1).max(64).optional(),
    advantage: z.boolean().default(false),
    disadvantage: z.boolean().default(false),
    /**
     * Adds an Experience from the stat block by spending a Fear. The server checks
     * the adversary has it and that the Fear is there to spend.
     */
    experience: z.string().min(1).max(80).optional(),
  }),
  z.object({
    // The active environment's own features, which cost Fear the same way.
    type: z.literal('useEnvironmentFeature'),
    featureName: z.string().min(1).max(80),
    fearCost: z.number().int().min(0).max(MAX_FEAR).default(0),
  }),
  z.object({
    // Uses a feature off the stat block. The text says what it costs, so the GM
    // states the Fear and the server checks the pool can cover it.
    type: z.literal('useAdversaryFeature'),
    instanceId: z.string().min(1),
    featureName: z.string().min(1).max(80),
    fearCost: z.number().int().min(0).max(MAX_FEAR).default(0),
  }),
  z.object({
    type: z.literal('rollAdversaryDamage'),
    instanceId: z.string().min(1),
    /** Set after a natural 20, which adds the damage dice's maximum. */
    critical: z.boolean().default(false),
  }),
  z.object({
    type: z.literal('updateAdversary'),
    instanceId: z.string().min(1),
    hpMarked: z.number().int().min(0).max(99),
    stressMarked: z.number().int().min(0).max(99),
  }),
]);
export type GameMasterRoomEvent = z.infer<typeof GameMasterRoomEventSchema>;

const sceneId = z.string().min(1).max(64);

/**
 * Map intents. All are GM-only except `moveToken` (a player may send it for a
 * token they own) and `addToken` (a player may send it once, to place their own
 * claimed character's token) — the server checks both, never the client.
 */
export const MapRoomEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('addScene'), id: sceneId, name: z.string().min(1).max(80) }),
  z.object({ type: z.literal('renameScene'), id: sceneId, name: z.string().min(1).max(80) }),
  z.object({ type: z.literal('removeScene'), id: sceneId }),
  z.object({ type: z.literal('setActiveScene'), id: sceneId.nullable() }),
  z.object({ type: z.literal('setSceneImage'), sceneId, image: SceneImageSchema.nullable() }),
  z.object({ type: z.literal('setSceneGrid'), sceneId, grid: GridSchema }),
  z.object({ type: z.literal('addToken'), sceneId, token: TokenSchema }),
  z.object({ type: z.literal('updateToken'), sceneId, token: TokenSchema }),
  z.object({ type: z.literal('removeToken'), sceneId, tokenId: z.string().min(1).max(64) }),
  z.object({
    // Sent throttled during a drag and once on release; `commit` marks the final one.
    type: z.literal('moveToken'),
    sceneId,
    tokenId: z.string().min(1).max(64),
    x: z.number().min(-100_000).max(100_000),
    y: z.number().min(-100_000).max(100_000),
    commit: z.boolean(),
  }),
  z.object({
    type: z.literal('paintFog'),
    sceneId,
    x: z.number(),
    y: z.number(),
    radius: z.number().min(1).max(2000),
    /** True reveals the brushed area, false hides it again. */
    reveal: z.boolean(),
  }),
  z.object({
    /** Fog painted as a closed shape — the pen tool, as opposed to the round brush. */
    type: z.literal('fillFog'),
    sceneId,
    points: z.array(z.object({ x: z.number(), y: z.number() })).min(3).max(200),
    reveal: z.boolean(),
  }),
  z.object({ type: z.literal('setFogEnabled'), sceneId, enabled: z.boolean() }),
  z.object({ type: z.literal('addWall'), sceneId, wall: WallSchema }),
  z.object({ type: z.literal('removeWall'), sceneId, wallId: z.string().min(1).max(64) }),
  z.object({ type: z.literal('updateWall'), sceneId, wall: WallSchema }),
  z.object({ type: z.literal('setSceneVisionMode'), sceneId, visionMode: VisionModeSchema }),
]);
export type MapRoomEvent = z.infer<typeof MapRoomEventSchema>;

/** Every intent a client can send. */
export const RoomEventSchema = z.union([
  CharacterRoomEventSchema,
  GameMasterRoomEventSchema,
  MapRoomEventSchema,
]);
export type RoomEvent = z.infer<typeof RoomEventSchema>;

// --- connection messages ----------------------------------------------------

/**
 * Enter a campaign's live room. The socket is already authenticated (its account id
 * came from the connection handshake); this only asks to be seated in one specific
 * campaign, and the server checks membership before seating it.
 */
export const JoinCampaignSchema = z.object({
  campaignId: z.string().min(1),
});
export type JoinCampaignMessage = z.infer<typeof JoinCampaignSchema>;

/** A player claims their one character for the campaign they are seated in. */
export const ClaimCharacterSchema = z.object({
  sheet: SheetStateSchema,
});
export type ClaimCharacterMessage = z.infer<typeof ClaimCharacterSchema>;

/**
 * A slice-level diff. Only the top-level slices that actually changed are sent;
 * the client shallow-merges them over its copy. A future `map` slice drops in here
 * without touching the mechanism.
 */
export const RoomPatchSchema = RoomStateSchema.partial();
export type RoomPatch = z.infer<typeof RoomPatchSchema>;

export const RejectedSchema = z.object({
  error: z.string().min(1),
  message: z.string().min(1),
});
export type RejectedMessage = z.infer<typeof RejectedSchema>;

export const RolledSchema = z.object({ entries: z.array(RollEntrySchema) });
export type RolledMessage = z.infer<typeof RolledSchema>;

/**
 * What the server wants the acting client to say about an intent it accepted:
 * the death move a hit forced, the Stress that became HP, the shortfall that
 * stopped a payment. The room patch carries the new state; this carries the
 * sentence that goes with it, and reaches nobody but the actor.
 */
export const EffectMessageSchema = z.object({
  vulnerable: z.boolean(),
  deathMoveRequired: z.boolean(),
  stressBecameHP: z.boolean(),
  message: z.string().nullable(),
  code: z.string().nullable(),
  params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});
export type EffectMessage = z.infer<typeof EffectMessageSchema>;

/**
 * Computes the slice-level diff between two room states by reference. Every reducer
 * returns fresh objects for the slices it touched, so identity comparison is exact.
 */
export function roomPatch(before: RoomState, after: RoomState): RoomPatch {
  const patch: RoomPatch = {};
  if (before.gm !== after.gm) patch.gm = after.gm;
  if (before.players !== after.players) patch.players = after.players;
  if (before.characters !== after.characters) patch.characters = after.characters;
  if (before.fear !== after.fear) patch.fear = after.fear;
  if (before.spotlight !== after.spotlight) patch.spotlight = after.spotlight;
  if (before.countdowns !== after.countdowns) patch.countdowns = after.countdowns;
  if (before.adversaryInstances !== after.adversaryInstances) {
    patch.adversaryInstances = after.adversaryInstances;
  }
  if (before.activeEnvironment !== after.activeEnvironment) {
    patch.activeEnvironment = after.activeEnvironment;
  }
  if (before.rollLog !== after.rollLog) patch.rollLog = after.rollLog;
  if (before.rest !== after.rest) patch.rest = after.rest;
  if (before.consecutiveShortRests !== after.consecutiveShortRests) {
    patch.consecutiveShortRests = after.consecutiveShortRests;
  }
  if (before.adversaryPools !== after.adversaryPools) {
    patch.adversaryPools = after.adversaryPools;
  }
  if (before.spotlightTokens !== after.spotlightTokens) {
    patch.spotlightTokens = after.spotlightTokens;
  }
  if (before.groupAction !== after.groupAction) patch.groupAction = after.groupAction;
  if (before.tagTeam !== after.tagTeam) patch.tagTeam = after.tagTeam;
  if (before.map !== after.map) patch.map = after.map;
  return patch;
}

/**
 * Applies a slice patch over a room state. Only slices present in the patch are
 * replaced; the server's copy always wins over anything the client had optimistically.
 */
export function applyRoomPatch(state: RoomState, patch: RoomPatch): RoomState {
  return {
    ...state,
    ...(patch.gm === undefined ? {} : { gm: patch.gm }),
    ...(patch.players === undefined ? {} : { players: patch.players }),
    ...(patch.characters === undefined ? {} : { characters: patch.characters }),
    ...(patch.fear === undefined ? {} : { fear: patch.fear }),
    ...(patch.spotlight === undefined ? {} : { spotlight: patch.spotlight }),
    ...(patch.countdowns === undefined ? {} : { countdowns: patch.countdowns }),
    ...(patch.adversaryInstances === undefined
      ? {}
      : { adversaryInstances: patch.adversaryInstances }),
    ...(patch.activeEnvironment === undefined
      ? {}
      : { activeEnvironment: patch.activeEnvironment }),
    ...(patch.rollLog === undefined ? {} : { rollLog: patch.rollLog }),
    ...(patch.rest === undefined ? {} : { rest: patch.rest }),
    ...(patch.consecutiveShortRests === undefined
      ? {}
      : { consecutiveShortRests: patch.consecutiveShortRests }),
    ...(patch.adversaryPools === undefined ? {} : { adversaryPools: patch.adversaryPools }),
    ...(patch.spotlightTokens === undefined ? {} : { spotlightTokens: patch.spotlightTokens }),
    ...(patch.groupAction === undefined ? {} : { groupAction: patch.groupAction }),
    ...(patch.tagTeam === undefined ? {} : { tagTeam: patch.tagTeam }),
    ...(patch.map === undefined ? {} : { map: patch.map }),
  };
}
