import { CharacterSchema } from '@daggerheart/character';
import {
  HOPE_FEATURE_COST,
  MAX_FEAR,
  MOVES_PER_REST,
  gainFear,
  isMoveAvailable,
  mustRestLong,
  resolveDowntimeMove,
  restFear,
  rollAdversaryAttack,
  rollCollisionDamage,
  rollFallDamage,
  rollFate,
  rollAdversaryDamage,
  spendFear,
  type DowntimeMove,
  type LevelUpChoices,
  type RestKind,
  type Rng,
} from '@daggerheart/rules';
import { srd } from '@daggerheart/srd-data';
import { z } from 'zod';

import {
  CountdownSchema,
  advanceCountdown,
  advanceOnActionRoll,
  advanceOnRest,
  type Countdown,
} from './countdowns.js';
import type { CharacterRoomEvent, MapRoomEvent, RoomEvent } from './events.js';
import {
  MapStateSchema,
  cellsInBrush,
  cellsInPolygon,
  createMapState,
  createScene,
  fitFogToImage,
  hide,
  mapForPlayer,
  reveal,
  type MapState,
  type Scene,
  type Token,
} from './map.js';
import { computeVisionPolygon } from './vision.js';
import {
  ActionOutcomeSchema,
  PrivateEntrySchema,
  RollEntrySchema,
  type PrivateEntry,
  type RollEntry,
  type Visibility,
} from './rollLog.js';
import {
  SheetStateSchema,
  applyLevelUp,
  clearSheetArmorSlot,
  clearSheetHP,
  clearSheetStress,
  gainSheetGold,
  gainSheetHope,
  applyDowntime,
  coded,
  equipArmorOnSheet,
  dropBeastform,
  enterBeastform,
  equipWeaponOnSheet,
  makeDeathMove,
  makeDamageRoll,
  makeDualityRoll,
  type DualityRollRequest,
  markSheetArmorSlot,
  markSheetHP,
  markSheetStress,
  recallFromVault,
  sendToVault,
  spendSheetGold,
  spendSheetHope,
  takeDamage,
  wake,
  type SheetEffect,
  type SheetState,
} from './sheet.js';

/** A seat at the table. `id` is the session id the server issued. */
export const PlayerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  connected: z.boolean(),
  /** The character this player controls, or null before they claim one. */
  characterId: z.string().nullable(),
});
export type Player = z.infer<typeof PlayerSchema>;

/** The GM's seat. The GM's reclaim token is server-side only and never broadcast. */
export const GameMasterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  connected: z.boolean(),
});
export type GameMaster = z.infer<typeof GameMasterSchema>;

/** Which rest the party is taking (SRD 2.0 p.52). */
export const RestKindSchema = z.enum(['short', 'long']);

/** Which death move a character makes when their last Hit Point is marked. */
export const DeathMoveChoiceSchema = z.enum(['blazeOfGlory', 'avoidDeath', 'riskItAll']);

/** The downtime moves a character can spend their two on. */
export const DowntimeMoveSchema = z.enum([
  'tendToWounds',
  'clearStress',
  'repairArmor',
  'prepare',
  'workOnProject',
]);

/**
 * The rest the party is taking, or null when they are not. It exists for as long as
 * downtime lasts: it is what limits each character to two moves, and what makes
 * moving a domain card between loadout and vault free.
 */
export const RestSchema = z.object({
  kind: RestKindSchema,
  /** Downtime moves each character has left, keyed the way `characters` is. */
  movesLeft: z.record(z.string(), z.number().int().min(0).max(MOVES_PER_REST)),
});
export type Rest = z.infer<typeof RestSchema>;

/** One adversary in play, tracked independently of its stat block. */
export const AdversaryInstanceSchema = z.object({
  instanceId: z.string().min(1),
  /** Id into `srd-data`'s adversaries. */
  adversaryId: z.string().min(1),
  /** Editable so a GM can field "Guard A" and "Guard B". */
  name: z.string().min(1),
  hpMarked: z.number().int().nonnegative(),
  stressMarked: z.number().int().nonnegative(),
  /**
   * Evolution features this adversary has already used. They are one-shot within a
   * scene (SRD 2.0 p.94), so using one twice is refused rather than silently
   * allowed. Defaulted, so a campaign snapshotted before this still loads.
   */
  usedFeatures: z.array(z.string().min(1).max(80)).max(12).default([]),
});
export type AdversaryInstance = z.infer<typeof AdversaryInstanceSchema>;

/**
 * The authoritative room state. Every field is plain JSON — no Maps, no class
 * instances — so it can be broadcast and snapshotted as-is.
 *
 * Slices are top-level and independent, so a future `map` slice can be added without
 * reshaping the protocol or the patch mechanism.
 */
export const RoomStateSchema = z.object({
  /** Opaque campaign id. Not a code a player types in — membership gates joining. */
  id: z.string().min(1),
  gm: GameMasterSchema,
  players: z.array(PlayerSchema),
  /** Character id -> that character's full sheet. */
  characters: z.record(z.string(), SheetStateSchema),
  /** The GM's Fear pool, capped at 12 (SRD p.38). */
  fear: z.number().int().min(0).max(MAX_FEAR),
  /** Who currently holds the spotlight: a player id, 'gm', or null. */
  spotlight: z.string().nullable(),
  countdowns: z.array(CountdownSchema),
  adversaryInstances: z.array(AdversaryInstanceSchema),
  /** Id into `srd-data`'s environments, or null. */
  activeEnvironment: z.string().nullable(),
  rollLog: z.array(RollEntrySchema),
  /**
   * Whispers and private rolls, newest first, each with the accounts allowed to see
   * it. The GM sees all of them; a player is only ever sent their own.
   */
  privateLog: z.array(PrivateEntrySchema).default([]),
  /**
   * The rest in progress, or null. Defaulted so a snapshot written before downtime
   * existed still loads instead of being dropped as unreadable.
   */
  rest: RestSchema.nullable().default(null),
  /**
   * Short rests taken since the last long one. Three in a row and the next rest
   * must be a long one (SRD 2.0 p.52).
   */
  consecutiveShortRests: z.number().int().min(0).default(0),
  /**
   * A group action roll in progress (SRD 2.0 p.48): one PC leads, the others make
   * reaction rolls, and the lead's roll takes +1 for each of those that succeeded
   * and -1 for each that failed. It lives in room state because it spans characters.
   */
  groupAction: z
    .object({
      leadCharacterId: z.string().min(1),
      /** Character id -> whether their reaction roll succeeded. */
      reactions: z.record(z.string(), z.boolean()),
    })
    .nullable()
    .default(null),
  /**
   * A Tag Team Roll in progress (SRD 2.0 p.49). Both PCs roll, then the initiator
   * picks which result applies to both, so neither roll's Hope or Fear is handed
   * out until that choice is made.
   */
  tagTeam: z
    .object({
      initiatorId: z.string().min(1),
      partnerId: z.string().min(1),
      /** Character id -> the roll they made, held until one is chosen. */
      rolls: z.record(
        z.string(),
        z.object({ outcome: ActionOutcomeSchema, total: z.number().int() }),
      ),
    })
    .nullable()
    .default(null),
  /**
   * The optional Spotlight Tracker (SRD 2.0 p.47), or null when the table is not
   * using it. Each player starts a scene with `perPlayer` tokens and spends one per
   * action roll; when everyone is out, everyone refills.
   */
  spotlightTokens: z
    .object({
      perPlayer: z.number().int().min(1).max(10),
      /** Character id -> tokens left. */
      left: z.record(z.string(), z.number().int().min(0)),
    })
    .nullable()
    .default(null),
  /**
   * Adversary pools (SRD 2.0 p.94): tokens shared by several adversaries rather
   * than sitting on one stat block. They start a scene empty and are cleared when
   * it ends, which is the GM's to do.
   */
  adversaryPools: z
    .array(z.object({ name: z.string().min(1).max(60), tokens: z.number().int().min(0).max(99) }))
    .default([]),
  /** Scenes, tokens, and fog. Players receive only the active scene. */
  map: MapStateSchema,
  /**
   * Account id -> the token ids that account has targeted, at most six. A player
   * sees only their own entry filtered to what `roomForRole` lets through; the GM
   * sees every account's. Defaulted so a snapshot written before targeting existed
   * still loads.
   */
  targets: z.record(z.string(), z.array(z.string().min(1).max(64)).max(6)).default({}),
});
export type RoomState = z.infer<typeof RoomStateSchema>;

/** Keeps the log bounded so a long session can't grow without limit. */
export const MAX_ROOM_LOG = 200;

export function createRoomState(id: string, gm: GameMaster): RoomState {
  return {
    id,
    gm,
    players: [],
    characters: {},
    fear: 0,
    spotlight: null,
    countdowns: [],
    adversaryInstances: [],
    activeEnvironment: null,
    rollLog: [],
    privateLog: [],
    rest: null,
    consecutiveShortRests: 0,
    groupAction: null,
    tagTeam: null,
    spotlightTokens: null,
    adversaryPools: [],
    map: createMapState(),
    targets: {},
  };
}

/**
 * Shared by every player view, so two calls with nothing to hide compare equal by
 * reference and never produce a spurious `privateLog` patch (`privateLog` itself
 * never travels in a patch — see `roomPatch` — but keeping this stable costs
 * nothing and matches the pattern below).
 */
const EMPTY_PRIVATE_LOG = Object.freeze([]) as unknown as PrivateEntry[];

/** Every token id anywhere on a map, across every scene. */
function tokenIdsOf(map: MapState): Set<string> {
  return new Set(map.scenes.flatMap((scene) => scene.tokens.map((token) => token.id)));
}

/**
 * Filters every account's target list by `keep`, dropping ids it rejects and
 * removing an account's entry entirely once its list is empty. Reference-stable
 * when every id passes, so an unrelated room change does not produce a spurious
 * `targets` patch.
 */
function filterTargets(
  targets: RoomState['targets'],
  keep: (tokenId: string) => boolean,
): RoomState['targets'] {
  let changed = false;
  const next: RoomState['targets'] = {};
  for (const [accountId, tokenIds] of Object.entries(targets)) {
    const filtered = tokenIds.filter(keep);
    if (filtered.length !== tokenIds.length) changed = true;
    if (filtered.length > 0) next[accountId] = filtered;
  }
  return changed ? next : targets;
}

/**
 * The room as a given role is allowed to see it. The GM sees everything; a player
 * sees only the active scene, without GM-only tokens, never receives the fog
 * regions that have not been revealed, never learns how hurt an adversary is, and
 * never receives the private log raw — whispers and private rolls reach a player
 * only through `roomForActor`, filtered to their own.
 */
export function roomForRole(state: RoomState, role: Actor['role']): RoomState {
  if (role === 'gm') return state;
  const map = mapForPlayer(state.map);
  // A target on a token a player cannot see (hidden, or on another scene) is
  // dropped rather than forwarded, so a GM's target never reveals one.
  const visibleTokenIds = tokenIdsOf(map);
  return {
    ...state,
    map,
    targets: filterTargets(state.targets, (tokenId) => visibleTokenIds.has(tokenId)),
    // Reusing the state's own array when every instance is already undamaged
    // keeps `roomForRole(before, 'player') === ...` for unrelated changes, so
    // `roomPatch` does not see a spurious `adversaryInstances` diff.
    adversaryInstances: state.adversaryInstances.every(
      (instance) => instance.hpMarked === 0 && instance.stressMarked === 0,
    )
      ? state.adversaryInstances
      : state.adversaryInstances.map(adversaryForPlayer),
    privateLog: EMPTY_PRIVATE_LOG,
  };
}

/**
 * The room as a specific actor is allowed to see it. The GM gets the whole state;
 * a player gets `roomForRole(state, 'player')` with the private log narrowed to
 * entries whose audience includes them — never another player's whisper, never a
 * GM-only roll.
 */
export function roomForActor(state: RoomState, actor: Actor): RoomState {
  if (actor.role === 'gm') return state;
  return {
    ...roomForRole(state, 'player'),
    privateLog: state.privateLog.filter((entry) => entry.audience.includes(actor.id)),
  };
}

/**
 * What a player may know about an adversary in play: that it is there and what it
 * is called. How hurt it is stays with the GM, who narrates it.
 */
function adversaryForPlayer(instance: AdversaryInstance): AdversaryInstance {
  return { ...instance, hpMarked: 0, stressMarked: 0 };
}

/** Who is asking. The server derives this from the socket's session, never the client. */
export interface Actor {
  id: string;
  role: 'gm' | 'player';
}

export type RoomError =
  | 'notGameMaster'
  | 'notYourCharacter'
  | 'unknownCharacter'
  | 'unknownCountdown'
  | 'unknownAdversary'
  | 'notEnoughFear'
  | 'unknownScene'
  | 'unknownToken'
  | 'notYourToken'
  | 'tokenExists'
  | 'tooManyWalls'
  | 'alreadyResting'
  | 'notResting'
  | 'mustRestLong'
  | 'moveNotAvailable'
  | 'noMovesLeft'
  | 'characterIsGone'
  | 'unknownExperience'
  | 'unknownFeature'
  | 'noSpotlightTokens'
  | 'noEnvironment'
  | 'featureSpent'
  | 'unknownTransformation'
  | 'rejected';

export type RoomResult =
  | {
      ok: true;
      state: RoomState;
      effect: SheetEffect | null;
      entries: readonly RollEntry[];
      /** Entries only their audience (and the GM) may be sent. */
      privateEntries: readonly PrivateEntry[];
    }
  | { ok: false; error: RoomError; message: string };

const fail = (error: RoomError, message: string): RoomResult => ({ ok: false, error, message });

const ok = (
  state: RoomState,
  effect: SheetEffect | null = null,
  entries: readonly RollEntry[] = [],
  privateEntries: readonly PrivateEntry[] = [],
): RoomResult => ({ ok: true, state, effect, entries, privateEntries });

/**
 * Seats a claimed character in the room.
 *
 * "You start a campaign with 1 Fear per PC in the party" (SRD 2.0 p.87). Parties
 * assemble over several sessions, so the Fear arrives with each new PC rather than
 * all at once at some moment the app cannot observe. Replacing a character that was
 * already claimed adds nothing: the party has not grown.
 */
export function claimCharacterInRoom(
  state: RoomState,
  accountId: string,
  sheet: SheetState,
): RoomState {
  const isNewToTheParty = state.characters[accountId] === undefined;
  return {
    ...state,
    characters: { ...state.characters, [accountId]: sheet },
    players: state.players.map((player) =>
      player.id === accountId ? { ...player, characterId: accountId } : player,
    ),
    fear: isNewToTheParty ? gainFear(state.fear, 1) : state.fear,
  };
}

/** True when this actor may mutate the given character. */
export function canControlCharacter(state: RoomState, actor: Actor, characterId: string): boolean {
  // The GM can act on any character; a player only on the one they claimed.
  if (actor.role === 'gm') return true;
  const player = state.players.find((p) => p.id === actor.id);
  return player !== undefined && player.characterId === characterId;
}

function withCharacter(
  state: RoomState,
  characterId: string,
  sheet: SheetState,
): RoomState {
  return { ...state, characters: { ...state.characters, [characterId]: sheet } };
}

function appendEntries(state: RoomState, entries: readonly RollEntry[]): RoomState {
  if (entries.length === 0) return state;
  return { ...state, rollLog: [...entries, ...state.rollLog].slice(0, MAX_ROOM_LOG) };
}

/**
 * Logs what a roll or a message produced where its visibility says. Public goes to
 * the shared log. Private goes to the private log for `audience` and the GM, the
 * audience being, unless a whisper names it, the roller — or nobody but the GM
 * when the GM rolled.
 */
function logEntries(
  state: RoomState,
  actor: Actor,
  entries: readonly RollEntry[],
  visibility: Visibility,
  audience: readonly string[] = actor.role === 'gm' ? [] : [actor.id],
): { state: RoomState; privateEntries: PrivateEntry[] } {
  // Anything but an explicit 'private' is public, which is also what the wire
  // schema defaults a missing visibility to.
  if (visibility !== 'private' || entries.length === 0) {
    return { state: appendEntries(state, entries), privateEntries: [] };
  }
  const privateEntries = entries.map((entry) => ({ audience: [...audience], entry }));
  return {
    state: {
      ...state,
      privateLog: [...privateEntries, ...state.privateLog].slice(0, MAX_ROOM_LOG),
    },
    privateEntries,
  };
}

/** `ok` for an event that logged entries: public ones in `entries`, the rest private. */
function okLogged(
  state: RoomState,
  actor: Actor,
  effect: SheetEffect | null,
  entries: readonly RollEntry[],
  visibility: Visibility,
  audience?: readonly string[],
): RoomResult {
  const logged = logEntries(state, actor, entries, visibility, audience);
  return visibility !== 'private'
    ? ok(logged.state, effect, entries)
    : ok(logged.state, effect, [], logged.privateEntries);
}

export { advanceOnActionRoll, advanceOnRest };
export type { Countdown, SheetEffect, SheetState };

/** When a scene auto-computes vision, reveals the fog cells a `pc` token whose
 * top-left corner is at (x, y) can see, casting vision from the token's centre
 * (matching how it's actually drawn and where its range rings are anchored). A
 * no-op in manual mode, for non-pc tokens, or when fog is disabled entirely. */
function revealVisionFor(scene: Scene, token: Token, x: number, y: number): Scene {
  if (scene.visionMode !== 'auto' || token.kind !== 'pc' || !scene.fog.enabled) return scene;
  const centre = { x: x + token.width / 2, y: y + token.height / 2 };
  // Without a scene image there is no picture to bound the cast, so the fog grid's
  // own extent stands in — a zero-sized bound collapses the polygon to nothing.
  const bounds = scene.image ?? {
    width: scene.fog.cols * scene.fog.cellSize,
    height: scene.fog.rows * scene.fog.cellSize,
  };
  const polygon = computeVisionPolygon(centre, token.visionRadius, scene.walls, bounds);
  return { ...scene, fog: reveal(scene.fog, cellsInPolygon(scene.fog, polygon)) };
}

/**
 * Re-casts vision for every PC on the scene. Walls are what vision is blocked by, so
 * opening a door or removing a wall has to expose what it was hiding straight away
 * rather than waiting for somebody to take a step.
 */
function revealVisionForAll(scene: Scene): Scene {
  return scene.tokens.reduce(
    (current, token) => revealVisionFor(current, token, token.x, token.y),
    scene,
  );
}

/**
 * Spends one spotlight token, refilling everybody when that empties the last one:
 * "Once every player has used all their available tokens, players refill" (SRD 2.0
 * p.47). Returns the tracker unchanged when the table is not using the tool.
 */
function spendSpotlightToken(
  tracker: RoomState['spotlightTokens'],
  characterId: string,
): RoomState['spotlightTokens'] {
  if (tracker === null) return null;
  const left = tracker.left[characterId];
  if (left === undefined) return tracker;

  const spent = { ...tracker.left, [characterId]: Math.max(0, left - 1) };
  if (Object.values(spent).every((remaining) => remaining === 0)) {
    const refilled = Object.fromEntries(
      Object.keys(spent).map((id) => [id, tracker.perPlayer] as const),
    );
    return { ...tracker, left: refilled };
  }
  return { ...tracker, left: spent };
}

/** Spending this much Hope opens a Tag Team Roll (SRD 2.0 p.49). */
export const TAG_TEAM_HOPE_COST = 3;

type Outcome = z.infer<typeof ActionOutcomeSchema>;

/** Whether an action roll's outcome counts as a success. */
function succeeded(outcome: Outcome): boolean {
  return outcome === 'criticalSuccess' || outcome === 'successHope' || outcome === 'successFear';
}

/** Whether an outcome was rolled with Hope, which is what a Tag Team choice pays out on. */
function withHope(outcome: Outcome): boolean {
  return outcome === 'criticalSuccess' || outcome === 'successHope' || outcome === 'failureHope';
}

/** +1 for each collaborator who succeeded, -1 for each who failed (SRD 2.0 p.48). */
function groupActionBonus(reactions: Record<string, boolean>): number {
  return Object.values(reactions).reduce((total, ok) => total + (ok ? 1 : -1), 0);
}

/**
 * Applies one validated intent to the room, enforcing permissions.
 *
 * This is the single place a room's state changes: the server calls it, and the
 * client calls the same sheet reducers underneath for its optimistic echo, so the
 * two can never drift.
 */
export function applyRoomEvent(
  state: RoomState,
  actor: Actor,
  event: RoomEvent,
  rng: Rng,
  now: number,
): RoomResult {
  const gmOnly = (): RoomResult | null =>
    actor.role === 'gm' ? null : fail('notGameMaster', 'only the GM can do that');

  switch (event.type) {
    // --- character mutations -------------------------------------------------
    case 'markHP':
    case 'clearHP':
    case 'markStress':
    case 'clearStress':
    case 'gainHope':
    case 'spendHope':
    case 'markArmorSlot':
    case 'clearArmorSlot':
    case 'gainGold':
    case 'spendGold':
    case 'takeDamage':
    case 'recallCard':
    case 'vaultCard':
    case 'setConditions':
    case 'setInventory':
    case 'useHopeFeature':
    case 'equipArmor':
    case 'equipWeapon':
    case 'setTransformation':
    case 'setBeastform':
    case 'startTagTeam':
    case 'chooseTagTeam':
    case 'downtimeMove':
    case 'deathMove':
    case 'levelUp':
    case 'rollDuality':
    case 'rollDamage': {
      const sheet = state.characters[event.characterId];
      if (sheet === undefined) {
        return fail('unknownCharacter', `no character ${event.characterId} in this room`);
      }
      if (!canControlCharacter(state, actor, event.characterId)) {
        return fail('notYourCharacter', 'you do not control that character');
      }
      return applyCharacterEvent(state, actor, event, sheet, rng, now);
    }

    case 'rollFate': {
      const denied = gmOnly();
      if (denied) return denied;
      const value =
        event.kind === 'fate'
          ? rollFate(rng)
          : event.kind === 'collision'
            ? rollCollisionDamage(rng)
            : rollFallDamage(
                event.kind === 'fallVeryClose'
                  ? 'veryClose'
                  : event.kind === 'fallClose'
                    ? 'close'
                    : 'farOrVeryFar',
                rng,
              );

      const entry: RollEntry = {
        kind: 'fate',
        id: `${now.toString(36)}-fate`,
        at: now,
        by: state.gm.name,
        label: event.label,
        value,
      };
      return okLogged(state, actor, null, [entry], event.visibility);
    }

    case 'sendMessage': {
      const entry: RollEntry = {
        kind: 'message',
        id: `${now.toString(36)}-${Math.floor(rng() * 36 ** 4).toString(36)}-msg`,
        at: now,
        by: nameOf(state, actor),
        byId: actor.id,
        text: event.text,
      };
      if (event.whisperTo.length === 0) return okLogged(state, actor, null, [entry], 'public');

      // The GM sees every whisper, so is never listed; the sender always is.
      const audience = [...new Set([...event.whisperTo, actor.id])].filter(
        (id) => id !== state.gm.id,
      );
      // The private log's schema holds at most 12; past that a snapshot would not load.
      if (audience.length > 12) return fail('rejected', 'too many people to whisper to');
      return okLogged(state, actor, null, [entry], 'private', audience);
    }

    case 'setTargets': {
      // A player can only target what they themselves could see; the GM can
      // target any token anywhere on the map, not only the active scene.
      const knownTokenIds =
        actor.role === 'gm' ? tokenIdsOf(state.map) : tokenIdsOf(mapForPlayer(state.map));
      if (!event.tokenIds.every((tokenId) => knownTokenIds.has(tokenId))) {
        return fail('unknownToken', 'no such token to target');
      }
      const targets = { ...state.targets };
      if (event.tokenIds.length === 0) delete targets[actor.id];
      else targets[actor.id] = event.tokenIds;
      return ok({ ...state, targets });
    }

    case 'setAdversaryPool': {
      const denied = gmOnly();
      if (denied) return denied;
      const others = state.adversaryPools.filter((pool) => pool.name !== event.name);
      return ok({
        ...state,
        adversaryPools:
          event.tokens === null ? others : [...others, { name: event.name, tokens: event.tokens }],
      });
    }
    case 'clearAdversaryPools': {
      const denied = gmOnly();
      if (denied) return denied;
      return ok({ ...state, adversaryPools: [] });
    }

    case 'setSpotlightTracker': {
      const denied = gmOnly();
      if (denied) return denied;
      if (event.tokensPerPlayer === null) return ok({ ...state, spotlightTokens: null });

      // Turning it on, or refilling, gives every seated character the same number.
      const left = Object.fromEntries(
        state.players
          .map((player) => player.characterId)
          .filter((id): id is string => id !== null)
          .map((id) => [id, event.tokensPerPlayer as number] as const),
      );
      return ok({
        ...state,
        spotlightTokens: { perPlayer: event.tokensPerPlayer, left },
      });
    }

    // --- group action rolls ---------------------------------------------------
    case 'startGroupAction': {
      const denied = gmOnly();
      if (denied) return denied;
      if (state.characters[event.leadCharacterId] === undefined) {
        return fail('unknownCharacter', 'no such character to lead the action');
      }
      return ok({
        ...state,
        groupAction: { leadCharacterId: event.leadCharacterId, reactions: {} },
      });
    }
    case 'cancelGroupAction': {
      const denied = gmOnly();
      if (denied) return denied;
      return ok({ ...state, groupAction: null });
    }

    // --- GM: Fear ------------------------------------------------------------
    case 'gainFear': {
      const denied = gmOnly();
      if (denied) return denied;
      return ok({ ...state, fear: gainFear(state.fear, event.amount) });
    }
    case 'spendFear': {
      const denied = gmOnly();
      if (denied) return denied;
      const fear = spendFear(state.fear, event.amount);
      if (fear === null) return fail('notEnoughFear', `not enough Fear (need ${event.amount})`);
      return ok({ ...state, fear });
    }

    // --- GM: spotlight, environment -----------------------------------------
    case 'setSpotlight': {
      const denied = gmOnly();
      if (denied) return denied;
      // "If the spotlight would swing to someone without any tokens, it swings to
      // someone else instead" (SRD 2.0 p.47).
      const tracker = state.spotlightTokens;
      if (tracker !== null && event.spotlight !== null) {
        const characterId = state.players.find((p) => p.id === event.spotlight)?.characterId;
        if (characterId !== null && characterId !== undefined && tracker.left[characterId] === 0) {
          return fail('noSpotlightTokens', 'that player is out of spotlight tokens');
        }
      }
      return ok({ ...state, spotlight: event.spotlight });
    }
    case 'setEnvironment': {
      const denied = gmOnly();
      if (denied) return denied;
      return ok({ ...state, activeEnvironment: event.environmentId });
    }

    // --- GM: countdowns ------------------------------------------------------
    case 'addCountdown': {
      const denied = gmOnly();
      if (denied) return denied;
      const countdown: Countdown = {
        id: event.id,
        name: event.name,
        kind: event.kind,
        value: event.startingValue,
        startingValue: event.startingValue,
        loop: event.loop,
        triggered: false,
      };
      return ok({ ...state, countdowns: [...state.countdowns, countdown] });
    }
    case 'advanceCountdown': {
      const denied = gmOnly();
      if (denied) return denied;
      if (!state.countdowns.some((c) => c.id === event.id)) {
        return fail('unknownCountdown', 'no such countdown');
      }
      // An explicit nudge moves the countdown by a stated amount rather than by a
      // roll outcome, which is how a GM ticks one by hand. A countdown that has
      // already triggered is left alone, as it is on a roll outcome.
      const countdowns = state.countdowns.map((c) =>
        c.id === event.id && !c.triggered ? advanceCountdown(c, event.amount).countdown : c,
      );
      return ok({ ...state, countdowns });
    }
    case 'setCountdownValue': {
      const denied = gmOnly();
      if (denied) return denied;
      if (!state.countdowns.some((c) => c.id === event.id)) {
        return fail('unknownCountdown', 'no such countdown');
      }
      // A countdown put back above zero is no longer a triggered one.
      const countdowns = state.countdowns.map((c) =>
        c.id === event.id ? { ...c, value: event.value, triggered: event.value === 0 } : c,
      );
      return ok({ ...state, countdowns });
    }
    case 'removeCountdown': {
      const denied = gmOnly();
      if (denied) return denied;
      return ok({ ...state, countdowns: state.countdowns.filter((c) => c.id !== event.id) });
    }
    case 'advanceCountdownsForRest': {
      const denied = gmOnly();
      if (denied) return denied;
      const { countdowns } = advanceOnRest(state.countdowns, event.amount);
      return ok({ ...state, countdowns });
    }

    // --- GM: downtime --------------------------------------------------------
    case 'beginRest': {
      const denied = gmOnly();
      if (denied) return denied;
      if (state.rest !== null) return fail('alreadyResting', 'the party is already resting');
      if (event.kind === 'short' && mustRestLong(state.consecutiveShortRests)) {
        return fail('mustRestLong', 'three short rests in a row: the next must be a long rest');
      }

      // Everyone with a character gets their two moves, the GM gets paid in Fear,
      // and a long rest also moves the long-term countdowns along.
      const characterIds = Object.keys(state.characters);
      const movesLeft: Record<string, number> = {};
      for (const id of characterIds) movesLeft[id] = MOVES_PER_REST;

      const fear = restFear(event.kind, characterIds.length, rng);
      const countdowns =
        event.kind === 'long' ? advanceOnRest(state.countdowns).countdowns : state.countdowns;

      // A long rest brings anyone unconscious back round (SRD 2.0 p.53).
      const characters =
        event.kind === 'long'
          ? Object.fromEntries(Object.entries(state.characters).map(([id, s]) => [id, wake(s)]))
          : state.characters;

      return ok({
        ...state,
        characters,
        rest: { kind: event.kind, movesLeft },
        consecutiveShortRests: event.kind === 'short' ? state.consecutiveShortRests + 1 : 0,
        fear: gainFear(state.fear, fear),
        countdowns,
      });
    }

    // --- GM: adversary rolls -------------------------------------------------
    case 'rollAdversaryAttack': {
      const denied = gmOnly();
      if (denied) return denied;
      const instance = state.adversaryInstances.find((a) => a.instanceId === event.instanceId);
      if (instance === undefined) return fail('unknownAdversary', 'no such adversary');
      const block = srd().adversaries.find((a) => a.id === instance.adversaryId);
      if (block === undefined) return fail('unknownAdversary', 'that stat block is not in the SRD');

      // A named Experience costs a Fear, and has to be one the adversary has.
      let fear = state.fear;
      let experience = 0;
      if (event.experience !== undefined) {
        const known = block.experiences.find((e) => e.name === event.experience);
        if (known === undefined) {
          return fail('unknownExperience', 'that adversary has no such Experience');
        }
        const spent = spendFear(fear, 1);
        if (spent === null) return fail('notEnoughFear', 'no Fear to spend on that Experience');
        fear = spent;
        experience = known.modifier;
      }

      const target = event.targetId === undefined ? null : state.characters[event.targetId];
      if (event.targetId !== undefined && target === undefined) {
        return fail('unknownCharacter', 'no such character to attack');
      }

      const roll = rollAdversaryAttack({
        modifier: block.attackModifier.flat ?? 0,
        modifierDice: block.attackModifier.roll,
        evasion: target?.character.evasion ?? null,
        advantage: event.advantage,
        disadvantage: event.disadvantage,
        experience,
        rng,
      });

      const entry: RollEntry = {
        kind: 'attack',
        id: `${now.toString(36)}-${event.instanceId}-atk`,
        at: now,
        by: instance.name,
        label: block.standardAttack.name,
        roll,
        evasion: target?.character.evasion ?? null,
        target: targetNameFor(state, event.targetId),
      };
      return okLogged({ ...state, fear }, actor, null, [entry], event.visibility);
    }

    case 'useEnvironmentFeature': {
      const denied = gmOnly();
      if (denied) return denied;
      if (state.activeEnvironment === null) {
        return fail('noEnvironment', 'no environment is active');
      }
      const environment = srd().environments.find((e) => e.id === state.activeEnvironment);
      if (environment === undefined) {
        return fail('noEnvironment', 'that environment is not in the SRD');
      }
      if (!environment.features.some((f) => f.name === event.featureName)) {
        return fail('unknownFeature', 'this environment has no such feature');
      }

      if (event.fearCost === 0) return ok(state);
      const spent = spendFear(state.fear, event.fearCost);
      if (spent === null) return fail('notEnoughFear', 'not enough Fear for that feature');
      return ok({ ...state, fear: spent });
    }

    case 'useAdversaryFeature': {
      const denied = gmOnly();
      if (denied) return denied;
      const instance = state.adversaryInstances.find((a) => a.instanceId === event.instanceId);
      if (instance === undefined) return fail('unknownAdversary', 'no such adversary');
      const block = srd().adversaries.find((a) => a.id === instance.adversaryId);
      if (block === undefined) return fail('unknownAdversary', 'that stat block is not in the SRD');

      const feature = block.features.find((f) => f.name === event.featureName);
      if (feature === undefined) return fail('unknownFeature', 'that adversary has no such feature');

      // An Evolution is a one-shot: once this adversary has used it, it is spent.
      if (feature.type === 'evolution' && instance.usedFeatures.includes(feature.name)) {
        return fail('featureSpent', 'that Evolution has already been used');
      }

      let fear = state.fear;
      if (event.fearCost > 0) {
        const spent = spendFear(fear, event.fearCost);
        if (spent === null) return fail('notEnoughFear', 'not enough Fear for that feature');
        fear = spent;
      }

      const usedFeatures =
        feature.type === 'evolution'
          ? [...instance.usedFeatures, feature.name]
          : instance.usedFeatures;

      return ok({
        ...state,
        fear,
        adversaryInstances: state.adversaryInstances.map((a) =>
          a.instanceId === event.instanceId ? { ...a, usedFeatures } : a,
        ),
      });
    }

    case 'rollAdversaryDamage': {
      const denied = gmOnly();
      if (denied) return denied;
      const instance = state.adversaryInstances.find((a) => a.instanceId === event.instanceId);
      if (instance === undefined) return fail('unknownAdversary', 'no such adversary');
      const block = srd().adversaries.find((a) => a.id === instance.adversaryId);
      if (block === undefined) return fail('unknownAdversary', 'that stat block is not in the SRD');

      const printed = block.standardAttack.damage;
      const roll = rollAdversaryDamage({
        // Minions deal flat damage with no dice, which reads as zero dice here.
        dice: { count: printed.count, die: printed.die ?? 1 },
        modifier: printed.modifier,
        critical: event.critical,
        rng,
      });

      const entry: RollEntry = {
        kind: 'damage',
        id: `${now.toString(36)}-${event.instanceId}-dmg`,
        at: now,
        by: instance.name,
        label: block.standardAttack.name,
        roll,
        critical: event.critical,
      };
      return okLogged(state, actor, null, [entry], event.visibility);
    }

    case 'endRest': {
      const denied = gmOnly();
      if (denied) return denied;
      if (state.rest === null) return fail('notResting', 'the party is not resting');
      return ok({ ...state, rest: null });
    }

    // --- GM: adversaries -----------------------------------------------------
    case 'addAdversary': {
      const denied = gmOnly();
      if (denied) return denied;
      const instance: AdversaryInstance = {
        usedFeatures: [],
        instanceId: event.instanceId,
        adversaryId: event.adversaryId,
        name: event.name,
        hpMarked: 0,
        stressMarked: 0,
      };
      return ok({ ...state, adversaryInstances: [...state.adversaryInstances, instance] });
    }
    case 'removeAdversary': {
      const denied = gmOnly();
      if (denied) return denied;
      return ok({
        ...state,
        adversaryInstances: state.adversaryInstances.filter(
          (a) => a.instanceId !== event.instanceId,
        ),
      });
    }
    // --- map ------------------------------------------------------------------
    case 'addScene':
    case 'renameScene':
    case 'removeScene':
    case 'setActiveScene':
    case 'setSceneImage':
    case 'setSceneGrid':
    case 'updateToken':
    case 'removeToken':
    case 'paintFog':
    case 'fillFog':
    case 'setFogEnabled':
    case 'addWall':
    case 'removeWall':
    case 'updateWall':
    case 'setSceneVisionMode':
      return applyMapEvent(state, actor, event);

    case 'addToken': {
      const scene = state.map.scenes.find((s) => s.id === event.sceneId);
      if (scene === undefined) return fail('unknownScene', 'no such scene');

      if (actor.role !== 'gm') {
        // The other map mutation a player may make: placing their own claimed
        // character's token, owned by themself, on the scene the table is
        // actually looking at — and only once.
        const isOwnCharacterToken =
          event.token.kind === 'pc' &&
          event.token.refId === actor.id &&
          event.token.ownerId === actor.id;
        if (!isOwnCharacterToken) return fail('notGameMaster', 'only the GM can change the map');
        if (state.map.activeSceneId !== scene.id) {
          return fail('unknownScene', 'that scene is not active');
        }
        if (scene.tokens.some((t) => t.kind === 'pc' && t.refId === actor.id)) {
          return fail('tokenExists', 'you already have a token on this scene');
        }
      }

      if (scene.tokens.some((t) => t.id === event.token.id)) {
        return fail('tokenExists', 'a token with that id is already on this scene');
      }
      const withToken = { ...scene, tokens: [...scene.tokens, event.token] };
      return ok(withScene(state, scene.id, revealVisionFor(withToken, event.token, event.token.x, event.token.y)));
    }

    case 'moveToken': {
      // The other player-permitted mutation: moving a token, only their own.
      const scene = state.map.scenes.find((s) => s.id === event.sceneId);
      if (scene === undefined) return fail('unknownScene', 'no such scene');
      const token = scene.tokens.find((t) => t.id === event.tokenId);
      if (token === undefined) return fail('unknownToken', 'no such token');

      if (actor.role !== 'gm' && token.ownerId !== actor.id) {
        return fail('notYourToken', 'you do not control that token');
      }
      // A player may only move a token on the scene the table is actually looking at.
      if (actor.role !== 'gm' && state.map.activeSceneId !== scene.id) {
        return fail('unknownScene', 'that scene is not active');
      }

      const moved = {
        ...scene,
        tokens: scene.tokens.map((t) => (t.id === token.id ? { ...t, x: event.x, y: event.y } : t)),
      };
      return ok(withScene(state, scene.id, revealVisionFor(moved, token, event.x, event.y)));
    }

    case 'updateAdversary': {
      const denied = gmOnly();
      if (denied) return denied;
      const target = state.adversaryInstances.find((a) => a.instanceId === event.instanceId);
      if (target === undefined) return fail('unknownAdversary', 'no such adversary');
      // Clamped to the stat block: an adversary cannot be marked past its own track.
      const block = srd().adversaries.find((a) => a.id === target.adversaryId);
      const hpCap = block?.hp ?? 99;
      const stressCap = block?.stress ?? 99;
      return ok({
        ...state,
        adversaryInstances: state.adversaryInstances.map((a) =>
          a.instanceId === event.instanceId
            ? {
                ...a,
                hpMarked: Math.min(hpCap, Math.max(0, event.hpMarked)),
                stressMarked: Math.min(stressCap, Math.max(0, event.stressMarked)),
              }
            : a,
        ),
      });
    }
  }
}

function applyCharacterEvent(
  state: RoomState,
  actor: Actor,
  event: CharacterRoomEvent,
  sheet: SheetState,
  rng: Rng,
  now: number,
): RoomResult {
  const rollerName = nameOf(state, actor);

  switch (event.type) {
    case 'markHP': {
      const t = markSheetHP(sheet, event.amount);
      return ok(withCharacter(state, event.characterId, t.sheet), t.effect);
    }
    case 'clearHP': {
      const t = clearSheetHP(sheet, event.amount);
      // "They return to consciousness when an ally clears 1 or more of their marked
      // Hit Points" (SRD 2.0 p.53).
      const healed = t.sheet.hpMarked < sheet.hpMarked;
      return ok(
        withCharacter(state, event.characterId, healed ? wake(t.sheet) : t.sheet),
        t.effect,
      );
    }
    case 'markStress': {
      const t = markSheetStress(sheet, event.amount);
      return ok(withCharacter(state, event.characterId, t.sheet), t.effect);
    }
    case 'clearStress': {
      const t = clearSheetStress(sheet, event.amount);
      return ok(withCharacter(state, event.characterId, t.sheet), t.effect);
    }
    case 'gainHope': {
      const t = gainSheetHope(sheet, event.amount);
      return ok(withCharacter(state, event.characterId, t.sheet), t.effect);
    }
    case 'spendHope': {
      const t = spendSheetHope(sheet, event.amount);
      return ok(withCharacter(state, event.characterId, t.sheet), t.effect);
    }
    case 'markArmorSlot': {
      const t = markSheetArmorSlot(sheet, event.amount);
      return ok(withCharacter(state, event.characterId, t.sheet), t.effect);
    }
    case 'clearArmorSlot': {
      const t = clearSheetArmorSlot(sheet, event.amount);
      return ok(withCharacter(state, event.characterId, t.sheet), t.effect);
    }
    case 'gainGold': {
      const t = gainSheetGold(sheet, event.amount, event.unit);
      return ok(withCharacter(state, event.characterId, t.sheet), t.effect);
    }
    case 'spendGold': {
      const t = spendSheetGold(sheet, event.amount, event.unit);
      return ok(withCharacter(state, event.characterId, t.sheet), t.effect);
    }
    case 'takeDamage': {
      // The client sends the hit, never the resulting HP: the rules decide.
      const t = takeDamage(sheet, {
        incoming: event.incoming,
        damageType: event.damageType,
        direct: event.direct,
        armorSlotsToMark: event.armorSlotsToMark,
      });
      return ok(withCharacter(state, event.characterId, t.sheet), t.effect);
    }
    case 'recallCard': {
      // Recalling is free during downtime, and the server is the one that knows
      // whether the party is resting.
      const t = recallFromVault(sheet, event.cardId, {
        duringRest: state.rest !== null,
        vaulting: event.vaulting,
      });
      if (!t.ok) return fail('rejected', t.effect.message ?? 'recall rejected');
      return ok(withCharacter(state, event.characterId, t.sheet), t.effect);
    }
    case 'setConditions': {
      // Duplicates are dropped: "the same condition can't be applied more than once
      // to the same target" (SRD 2.0 p.52).
      const conditions = [...new Set(event.conditions.map((c) => c.trim()).filter((c) => c !== ''))];
      return ok(withCharacter(state, event.characterId, { ...sheet, conditions }));
    }

    case 'setInventory': {
      const inventory = event.inventory.map((line) => line.trim()).filter((line) => line !== '');
      return ok(
        withCharacter(state, event.characterId, {
          ...sheet,
          character: { ...sheet.character, inventory },
        }),
      );
    }

    case 'useHopeFeature': {
      const t = spendSheetHope(sheet, HOPE_FEATURE_COST);
      // spendSheetHope leaves the sheet alone when it cannot pay, and says why.
      if (t.sheet === sheet) return fail('rejected', t.effect.message ?? 'not enough Hope');
      return ok(
        withCharacter(state, event.characterId, t.sheet),
        coded('hopeFeatureUsed', 'Hope feature used.', { cost: HOPE_FEATURE_COST }),
      );
    }

    case 'equipArmor': {
      const t = equipArmorOnSheet(sheet, event.armorId);
      if (!t.ok) return fail('rejected', t.effect.message ?? 'cannot equip that armor');
      return ok(withCharacter(state, event.characterId, t.sheet), t.effect);
    }

    case 'equipWeapon': {
      const t = equipWeaponOnSheet(sheet, event.slot, event.weaponId, state.rest !== null);
      if (!t.ok) return fail('rejected', t.effect.message ?? 'cannot equip that weapon');
      return ok(withCharacter(state, event.characterId, t.sheet), t.effect);
    }

    case 'setBeastform': {
      const t =
        event.beastformId === null
          ? dropBeastform(sheet)
          : enterBeastform(sheet, event.beastformId);
      if (t.sheet === sheet && t.effect.code !== null && t.effect.code !== 'droppedBeastform') {
        return fail('rejected', t.effect.message ?? 'cannot take that Beastform');
      }
      return ok(withCharacter(state, event.characterId, t.sheet), t.effect);
    }

    case 'setTransformation': {
      if (
        event.transformation !== null &&
        !srd().transformations.some((tr) => tr.id === event.transformation)
      ) {
        return fail('unknownTransformation', 'no such transformation in the SRD');
      }
      return ok(
        withCharacter(state, event.characterId, { ...sheet, transformation: event.transformation }),
      );
    }

    case 'deathMove': {
      if (sheet.dead) return fail('characterIsGone', 'that character\u2019s journey has ended');
      const t = makeDeathMove(sheet, event.choice, event.prefer, rng);
      const entry: RollEntry | null =
        t.outcome.choice === 'riskItAll'
          ? {
              kind: 'duality',
              id: `${now.toString(36)}-${event.characterId}-death`,
              at: now,
              by: rollerName,
              label: 'Risk It All',
              roll: t.outcome.roll,
              difficulty: 0,
              outcome: t.outcome.died ? 'failureFear' : 'successHope',
              experiences: [],
              reaction: false,
            }
          : null;
      const next = withCharacter(state, event.characterId, t.sheet);
      return entry === null
        ? ok(next, t.effect)
        : ok(appendEntries(next, [entry]), t.effect, [entry]);
    }

    case 'downtimeMove': {
      const rest = state.rest;
      if (rest === null) return fail('notResting', 'the party is not resting');
      if (!isMoveAvailable(event.move, rest.kind)) {
        return fail('moveNotAvailable', 'that move belongs to a long rest');
      }
      // The budget is the acting character's, even when the move heals an ally:
      // the SRD gives each PC two moves to spend, not two to receive.
      const left = rest.movesLeft[event.characterId] ?? 0;
      if (left <= 0) return fail('noMovesLeft', 'no downtime moves left');

      // Tending wounds and repairing armor can be done for someone else.
      const targetId = event.targetId ?? event.characterId;
      const target = state.characters[targetId];
      if (target === undefined) return fail('unknownCharacter', 'no such character to help');

      const effect = resolveDowntimeMove({
        move: event.move,
        kind: rest.kind,
        level: target.character.level,
        withParty: event.withParty,
        rng,
      });
      const t = applyDowntime(target, effect);

      const spent: Rest = {
        ...rest,
        movesLeft: { ...rest.movesLeft, [event.characterId]: left - 1 },
      };
      return ok({ ...withCharacter(state, targetId, t.sheet), rest: spent }, t.effect);
    }

    case 'vaultCard': {
      const t = sendToVault(sheet, event.cardId);
      if (!t.ok) return fail('rejected', t.effect.message ?? 'vault rejected');
      return ok(withCharacter(state, event.characterId, t.sheet), t.effect);
    }
    case 'levelUp': {
      // Rebuilt key by key: the wire schema makes fields optional-or-absent, and
      // `exactOptionalPropertyTypes` will not accept an explicit undefined.
      const choices: LevelUpChoices = { advancements: event.choices.advancements };
      if (event.choices.traitsToIncrease !== undefined) {
        choices.traitsToIncrease = event.choices.traitsToIncrease;
      }
      if (event.choices.experiencesToIncrease !== undefined) {
        choices.experiencesToIncrease = event.choices.experiencesToIncrease;
      }
      if (event.choices.newExperienceName !== undefined) {
        choices.newExperienceName = event.choices.newExperienceName;
      }
      if (event.choices.multiclass !== undefined) choices.multiclass = event.choices.multiclass;
      if (event.choices.extraDomainCardId !== undefined) {
        choices.extraDomainCardId = event.choices.extraDomainCardId;
      }
      if (event.choices.domainCardId !== undefined) {
        choices.domainCardId = event.choices.domainCardId;
      }

      const t = applyLevelUp(sheet, choices);
      if (!t.ok) return fail('rejected', t.effect.message ?? 'level up rejected');
      return ok(withCharacter(state, event.characterId, t.sheet), t.effect);
    }
    case 'rollDuality': {
      const group = state.groupAction;
      const tag = state.tagTeam;
      const inTagTeam =
        tag !== null &&
        (event.characterId === tag.initiatorId || event.characterId === tag.partnerId);
      const collaborating = group !== null && group.leadCharacterId !== event.characterId;
      const leading = group !== null && group.leadCharacterId === event.characterId;

      if (event.visibility === 'private' && (inTagTeam || collaborating)) {
        return fail('rejected', 'a shared roll cannot be private');
      }

      // A collaborator's roll and either half of a Tag Team roll generate no Hope or
      // Fear of their own: the lead roll and the chosen Tag Team roll do that.
      const request: DualityRollRequest = {
        ...event.request,
        ...(collaborating || inTagTeam ? { reaction: true } : {}),
        ...(leading
          ? { modifiers: event.request.modifiers + groupActionBonus(group.reactions) }
          : {}),
      };

      const t = makeDualityRoll(sheet, request, rng);
      if (t.outcome === null) return fail('rejected', t.effect.message ?? 'roll rejected');

      const entry: RollEntry = {
        kind: 'duality',
        id: `${now.toString(36)}-${event.characterId}`,
        at: now,
        by: rollerName,
        label: request.label,
        roll: t.outcome.roll,
        difficulty: request.difficulty,
        outcome: t.outcome.result.outcome,
        experiences: [...request.experiences],
        reaction: request.reaction ?? false,
      };

      let next = withCharacter(state, event.characterId, t.sheet);
      // A roll with Fear hands the GM a Fear token (SRD p.38).
      if (t.outcome.result.fearGained > 0) {
        next = { ...next, fear: gainFear(next.fear, t.outcome.result.fearGained) };
      }
      // Countdowns advance off the action roll's outcome (SRD p.69).
      const advanced = advanceOnActionRoll(next.countdowns, t.outcome.result.outcome);
      next = { ...next, countdowns: advanced.countdowns };

      if (inTagTeam && tag !== null) {
        next = {
          ...next,
          tagTeam: {
            ...tag,
            rolls: {
              ...tag.rolls,
              [event.characterId]: {
                outcome: t.outcome.result.outcome,
                total: t.outcome.roll.total,
              },
            },
          },
        };
      } else if (collaborating && group !== null) {
        next = {
          ...next,
          groupAction: {
            ...group,
            reactions: {
              ...group.reactions,
              [event.characterId]: succeeded(t.outcome.result.outcome),
            },
          },
        };
      } else if (leading) {
        // The lead roll is the group action: it closes when that roll lands.
        next = { ...next, groupAction: null };
      }

      // An action roll is taking an action, which is what a spotlight token pays
      // for; a reaction is not (SRD 2.0 p.47).
      if (request.reaction !== true) {
        next = { ...next, spotlightTokens: spendSpotlightToken(next.spotlightTokens, event.characterId) };
      }

      return okLogged(next, actor, t.effect, [entry], event.visibility);
    }
    case 'startTagTeam': {
      if (state.tagTeam !== null) return fail('rejected', 'a Tag Team Roll is already open');
      if (event.partnerCharacterId === event.characterId) {
        return fail('rejected', 'a Tag Team Roll needs two different characters');
      }
      if (state.characters[event.partnerCharacterId] === undefined) {
        return fail('unknownCharacter', 'no such character to team up with');
      }
      const spent = spendSheetHope(sheet, TAG_TEAM_HOPE_COST);
      if (spent.effect.code === 'notEnoughHope') {
        return fail('rejected', spent.effect.message ?? 'not enough Hope');
      }
      return ok(
        {
          ...withCharacter(state, event.characterId, spent.sheet),
          tagTeam: {
            initiatorId: event.characterId,
            partnerId: event.partnerCharacterId,
            rolls: {},
          },
        },
        spent.effect,
      );
    }
    case 'chooseTagTeam': {
      const tag = state.tagTeam;
      if (tag === null) return fail('rejected', 'no Tag Team Roll is open');
      if (event.characterId !== tag.initiatorId) {
        return fail('rejected', 'only the character who initiated it can choose');
      }
      if (Object.keys(tag.rolls).length < 2) {
        return fail('rejected', 'both characters have to roll first');
      }
      const chosen = tag.rolls[event.rollOf];
      if (chosen === undefined) return fail('rejected', 'that character has not rolled yet');

      // "On a roll with Hope, all PCs involved gain a Hope. On a roll with Fear, the
      // GM gains a Fear token for each PC involved."
      const involved = [tag.initiatorId, tag.partnerId];
      let next: RoomState = { ...state, tagTeam: null };
      if (withHope(chosen.outcome)) {
        for (const id of involved) {
          const theirs = next.characters[id];
          if (theirs === undefined) continue;
          next = withCharacter(next, id, gainSheetHope(theirs, 1).sheet);
        }
      } else {
        next = { ...next, fear: gainFear(next.fear, involved.length) };
      }
      return ok(next);
    }
    case 'rollDamage': {
      const roll = makeDamageRoll(
        {
          dice: event.dice,
          // The character's own Proficiency, not a number the client chose.
          proficiency: sheet.character.proficiency,
          modifier: event.modifier,
          critical: event.critical,
        },
        rng,
      );
      const entry: RollEntry = {
        kind: 'damage',
        id: `${now.toString(36)}-${event.characterId}-dmg`,
        at: now,
        by: rollerName,
        label: event.label,
        roll,
        critical: event.critical,
      };
      return okLogged(state, actor, null, [entry], event.visibility);
    }
  }
}


/** The display name the log signs an actor's entries with. */
function nameOf(state: RoomState, actor: Actor): string {
  return actor.role === 'gm'
    ? state.gm.name
    : state.players.find((p) => p.id === actor.id)?.name ?? 'Unknown';
}

/** The display name of whoever a roll was aimed at, for the log. */
function targetNameFor(state: RoomState, characterId: string | undefined): string | null {
  if (characterId === undefined) return null;
  const player = state.players.find((p) => p.characterId === characterId);
  return player?.name ?? state.characters[characterId]?.character.name ?? null;
}

/** Replaces one scene, leaving the rest of the map untouched. */
function withScene(state: RoomState, sceneId: string, scene: Scene): RoomState {
  return {
    ...state,
    map: {
      ...state.map,
      scenes: state.map.scenes.map((existing) => (existing.id === sceneId ? scene : existing)),
    },
  };
}

/**
 * Every map mutation except `addToken` and `moveToken` is GM-only. Those two are
 * handled in the main reducer because a player may send them for their own token.
 */
function applyMapEvent(
  state: RoomState,
  actor: Actor,
  event: Exclude<MapRoomEvent, { type: 'moveToken' | 'addToken' }>,
): RoomResult {
  if (actor.role !== 'gm') return fail('notGameMaster', 'only the GM can change the map');

  const findScene = (id: string): Scene | undefined =>
    state.map.scenes.find((scene) => scene.id === id);

  switch (event.type) {
    case 'addScene': {
      const scene = createScene(event.id, event.name);
      return ok({
        ...state,
        map: {
          scenes: [...state.map.scenes, scene],
          // The first scene added becomes the active one.
          activeSceneId: state.map.activeSceneId ?? scene.id,
        },
      });
    }

    case 'renameScene': {
      const scene = findScene(event.id);
      if (scene === undefined) return fail('unknownScene', 'no such scene');
      return ok(withScene(state, scene.id, { ...scene, name: event.name }));
    }

    case 'removeScene': {
      const removedScene = findScene(event.id);
      if (removedScene === undefined) return fail('unknownScene', 'no such scene');
      const remaining = state.map.scenes.filter((scene) => scene.id !== event.id);
      const activeSceneId =
        state.map.activeSceneId === event.id
          ? remaining[0]?.id ?? null
          : state.map.activeSceneId;
      // A target that pointed at a token on this scene cannot point at anything now.
      const removedTokenIds = new Set(removedScene.tokens.map((token) => token.id));
      return ok({
        ...state,
        map: { scenes: remaining, activeSceneId },
        targets: filterTargets(state.targets, (tokenId) => !removedTokenIds.has(tokenId)),
      });
    }

    case 'setActiveScene': {
      if (event.id !== null && findScene(event.id) === undefined) {
        return fail('unknownScene', 'no such scene');
      }
      return ok({ ...state, map: { ...state.map, activeSceneId: event.id } });
    }

    case 'setSceneImage': {
      const scene = findScene(event.sceneId);
      if (scene === undefined) return fail('unknownScene', 'no such scene');
      // The fog grid is resized to cover the new image.
      return ok(
        withScene(state, scene.id, {
          ...scene,
          image: event.image,
          fog: fitFogToImage(scene.fog, event.image),
        }),
      );
    }

    case 'setSceneGrid': {
      const scene = findScene(event.sceneId);
      if (scene === undefined) return fail('unknownScene', 'no such scene');
      return ok(withScene(state, scene.id, { ...scene, grid: event.grid }));
    }

    case 'updateToken': {
      const scene = findScene(event.sceneId);
      if (scene === undefined) return fail('unknownScene', 'no such scene');
      if (!scene.tokens.some((token) => token.id === event.token.id)) {
        return fail('unknownToken', 'no such token');
      }
      return ok(
        withScene(state, scene.id, {
          ...scene,
          tokens: scene.tokens.map((token) =>
            token.id === event.token.id ? (event.token as Token) : token,
          ),
        }),
      );
    }

    case 'removeToken': {
      const scene = findScene(event.sceneId);
      if (scene === undefined) return fail('unknownScene', 'no such scene');
      const withoutToken = withScene(state, scene.id, {
        ...scene,
        tokens: scene.tokens.filter((token) => token.id !== event.tokenId),
      });
      // Nobody can keep targeting a token that no longer exists.
      return ok({
        ...withoutToken,
        targets: filterTargets(state.targets, (tokenId) => tokenId !== event.tokenId),
      });
    }

    case 'paintFog': {
      const scene = findScene(event.sceneId);
      if (scene === undefined) return fail('unknownScene', 'no such scene');
      const cells = cellsInBrush(scene.fog, { x: event.x, y: event.y }, event.radius);
      const fog = event.reveal ? reveal(scene.fog, cells) : hide(scene.fog, cells);
      return ok(withScene(state, scene.id, { ...scene, fog }));
    }

    case 'fillFog': {
      const scene = findScene(event.sceneId);
      if (scene === undefined) return fail('unknownScene', 'no such scene');
      const cells = cellsInPolygon(scene.fog, event.points);
      const fog = event.reveal ? reveal(scene.fog, cells) : hide(scene.fog, cells);
      return ok(withScene(state, scene.id, { ...scene, fog }));
    }

    case 'setFogEnabled': {
      const scene = findScene(event.sceneId);
      if (scene === undefined) return fail('unknownScene', 'no such scene');
      return ok(
        withScene(state, scene.id, {
          ...scene,
          fog: fitFogToImage({ ...scene.fog, enabled: event.enabled }, scene.image),
        }),
      );
    }

    case 'addWall': {
      const scene = findScene(event.sceneId);
      if (scene === undefined) return fail('unknownScene', 'no such scene');
      if (scene.walls.length >= 500) return fail('tooManyWalls', 'wall limit reached');
      return ok(
        withScene(
          state,
          scene.id,
          revealVisionForAll({ ...scene, walls: [...scene.walls, event.wall] }),
        ),
      );
    }

    case 'removeWall': {
      const scene = findScene(event.sceneId);
      if (scene === undefined) return fail('unknownScene', 'no such scene');
      return ok(
        withScene(
          state,
          scene.id,
          revealVisionForAll({
            ...scene,
            walls: scene.walls.filter((wall) => wall.id !== event.wallId),
          }),
        ),
      );
    }

    case 'updateWall': {
      const scene = findScene(event.sceneId);
      if (scene === undefined) return fail('unknownScene', 'no such scene');
      // Covers opening a door, which is an update that stops blocking vision.
      return ok(
        withScene(
          state,
          scene.id,
          revealVisionForAll({
            ...scene,
            walls: scene.walls.map((wall) => (wall.id === event.wall.id ? event.wall : wall)),
          }),
        ),
      );
    }

    case 'setSceneVisionMode': {
      const scene = findScene(event.sceneId);
      if (scene === undefined) return fail('unknownScene', 'no such scene');
      let next: Scene = { ...scene, visionMode: event.visionMode };
      if (event.visionMode === 'auto') {
        for (const token of next.tokens) {
          if (token.kind === 'pc') next = revealVisionFor(next, token, token.x, token.y);
        }
      }
      return ok(withScene(state, scene.id, next));
    }
  }
}

export type { MapState };
