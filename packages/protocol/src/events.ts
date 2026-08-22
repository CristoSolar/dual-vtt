import { z } from 'zod';

import { CountdownKindSchema, CountdownLoopSchema } from './countdowns.js';
import { GridSchema, SceneImageSchema, TokenSchema, VisionModeSchema, WallSchema } from './map.js';
import { RollEntrySchema } from './rollLog.js';
import { RoomStateSchema, type RoomState } from './room.js';
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
    type: z.literal('recallCard'),
    characterId,
    cardId: z.string().min(1),
    recallCost: z.number().int().min(0).max(9),
    duringRest: z.boolean(),
    vaulting: z.string().min(1).optional(),
  }),
  z.object({ type: z.literal('vaultCard'), characterId, cardId: z.string().min(1) }),
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
      experiences: z
        .array(z.object({ name: z.string().min(1), modifier: z.number().int() }))
        .max(5),
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
    proficiency: z.number().int().min(0).max(12),
    modifier: z.number().int().min(-20).max(99),
    critical: z.boolean(),
  }),
]);
export type CharacterRoomEvent = z.infer<typeof CharacterRoomEventSchema>;

/** Intents only the GM may send. */
export const GameMasterRoomEventSchema = z.discriminatedUnion('type', [
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
    ...(patch.map === undefined ? {} : { map: patch.map }),
  };
}
