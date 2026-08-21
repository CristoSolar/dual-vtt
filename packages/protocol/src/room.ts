import { CharacterSchema } from '@daggerheart/character';
import {
  MAX_FEAR,
  gainFear,
  spendFear,
  type LevelUpChoices,
  type Rng,
} from '@daggerheart/rules';
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
import { RollEntrySchema, type RollEntry } from './rollLog.js';
import {
  SheetStateSchema,
  applyLevelUp,
  clearSheetArmorSlot,
  clearSheetHP,
  clearSheetStress,
  gainSheetGold,
  gainSheetHope,
  makeDamageRoll,
  makeDualityRoll,
  markSheetArmorSlot,
  markSheetHP,
  markSheetStress,
  recallFromVault,
  sendToVault,
  spendSheetGold,
  spendSheetHope,
  takeDamage,
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

/** One adversary in play, tracked independently of its stat block. */
export const AdversaryInstanceSchema = z.object({
  instanceId: z.string().min(1),
  /** Id into `srd-data`'s adversaries. */
  adversaryId: z.string().min(1),
  /** Editable so a GM can field "Guard A" and "Guard B". */
  name: z.string().min(1),
  hpMarked: z.number().int().nonnegative(),
  stressMarked: z.number().int().nonnegative(),
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
  /** Scenes, tokens, and fog. Players receive only the active scene. */
  map: MapStateSchema,
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
    map: createMapState(),
  };
}

/**
 * The room as a given role is allowed to see it. The GM sees everything; a player
 * sees only the active scene, without GM-only tokens, and never receives the fog
 * regions that have not been revealed.
 */
export function roomForRole(state: RoomState, role: Actor['role']): RoomState {
  if (role === 'gm') return state;
  return { ...state, map: mapForPlayer(state.map) };
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
  | 'rejected';

export type RoomResult =
  | { ok: true; state: RoomState; effect: SheetEffect | null; entries: readonly RollEntry[] }
  | { ok: false; error: RoomError; message: string };

const fail = (error: RoomError, message: string): RoomResult => ({ ok: false, error, message });

const ok = (
  state: RoomState,
  effect: SheetEffect | null = null,
  entries: readonly RollEntry[] = [],
): RoomResult => ({ ok: true, state, effect, entries });

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

export { advanceOnActionRoll, advanceOnRest };
export type { Countdown, SheetEffect, SheetState };

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
      // roll outcome, which is how a GM ticks one by hand.
      const countdowns = state.countdowns.map((c) =>
        c.id === event.id ? advanceCountdown(c, event.amount).countdown : c,
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

    // --- GM: adversaries -----------------------------------------------------
    case 'addAdversary': {
      const denied = gmOnly();
      if (denied) return denied;
      const instance: AdversaryInstance = {
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
    case 'setFogEnabled':
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

      return ok(withScene(state, scene.id, { ...scene, tokens: [...scene.tokens, event.token] }));
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

      return ok(
        withScene(state, scene.id, {
          ...scene,
          tokens: scene.tokens.map((t) =>
            t.id === token.id ? { ...t, x: event.x, y: event.y } : t,
          ),
        }),
      );
    }

    case 'updateAdversary': {
      const denied = gmOnly();
      if (denied) return denied;
      const target = state.adversaryInstances.find((a) => a.instanceId === event.instanceId);
      if (target === undefined) return fail('unknownAdversary', 'no such adversary');
      return ok({
        ...state,
        adversaryInstances: state.adversaryInstances.map((a) =>
          a.instanceId === event.instanceId
            ? {
                ...a,
                hpMarked: Math.max(0, event.hpMarked),
                stressMarked: Math.max(0, event.stressMarked),
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
  const rollerName =
    actor.role === 'gm'
      ? state.gm.name
      : state.players.find((p) => p.id === actor.id)?.name ?? 'Unknown';

  switch (event.type) {
    case 'markHP': {
      const t = markSheetHP(sheet, event.amount);
      return ok(withCharacter(state, event.characterId, t.sheet), t.effect);
    }
    case 'clearHP': {
      const t = clearSheetHP(sheet, event.amount);
      return ok(withCharacter(state, event.characterId, t.sheet), t.effect);
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
      const t = recallFromVault(sheet, event.cardId, event.recallCost, {
        duringRest: event.duringRest,
        vaulting: event.vaulting,
      });
      if (!t.ok) return fail('rejected', t.effect.message ?? 'recall rejected');
      return ok(withCharacter(state, event.characterId, t.sheet), t.effect);
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
      if (event.choices.domainCardId !== undefined) {
        choices.domainCardId = event.choices.domainCardId;
      }

      const t = applyLevelUp(sheet, choices);
      if (!t.ok) return fail('rejected', t.effect.message ?? 'level up rejected');
      return ok(withCharacter(state, event.characterId, t.sheet), t.effect);
    }
    case 'rollDuality': {
      const t = makeDualityRoll(sheet, event.request, rng);
      if (t.outcome === null) return fail('rejected', t.effect.message ?? 'roll rejected');

      const entry: RollEntry = {
        kind: 'duality',
        id: `${now.toString(36)}-${event.characterId}`,
        at: now,
        by: rollerName,
        label: event.request.label,
        roll: t.outcome.roll,
        difficulty: event.request.difficulty,
        outcome: t.outcome.result.outcome,
        experiences: event.request.experiences.map((e) => e.name),
      };

      let next = withCharacter(state, event.characterId, t.sheet);
      // A roll with Fear hands the GM a Fear token (SRD p.38).
      if (t.outcome.result.fearGained > 0) {
        next = { ...next, fear: gainFear(next.fear, t.outcome.result.fearGained) };
      }
      // Countdowns advance off the action roll's outcome (SRD p.69).
      const advanced = advanceOnActionRoll(next.countdowns, t.outcome.result.outcome);
      next = { ...next, countdowns: advanced.countdowns };

      return ok(appendEntries(next, [entry]), t.effect, [entry]);
    }
    case 'rollDamage': {
      const roll = makeDamageRoll(
        {
          dice: event.dice,
          proficiency: event.proficiency,
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
      return ok(appendEntries(state, [entry]), null, [entry]);
    }
  }
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
      const remaining = state.map.scenes.filter((scene) => scene.id !== event.id);
      if (remaining.length === state.map.scenes.length) {
        return fail('unknownScene', 'no such scene');
      }
      const activeSceneId =
        state.map.activeSceneId === event.id
          ? remaining[0]?.id ?? null
          : state.map.activeSceneId;
      return ok({ ...state, map: { scenes: remaining, activeSceneId } });
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
      return ok(
        withScene(state, scene.id, {
          ...scene,
          tokens: scene.tokens.filter((token) => token.id !== event.tokenId),
        }),
      );
    }

    case 'paintFog': {
      const scene = findScene(event.sceneId);
      if (scene === undefined) return fail('unknownScene', 'no such scene');
      const cells = cellsInBrush(scene.fog, { x: event.x, y: event.y }, event.radius);
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
  }
}

export type { MapState };
