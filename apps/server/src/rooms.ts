import { randomBytes, randomInt } from 'node:crypto';

import {
  applyRoomEvent,
  createRoom,
  roomForRole,
  roomPatch,
  type Actor,
  type RoomEvent,
  type RoomPatch,
  type RoomState,
  type RollEntry,
  type SheetState,
} from '@daggerheart/protocol';
import { seededRng, type Rng } from '@daggerheart/rules';

/** Join codes avoid characters that are easy to misread aloud or on a screen. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

export function generateCode(random: (max: number) => number = (max) => randomInt(max)): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[random(CODE_ALPHABET.length)] ?? 'A';
  }
  return code;
}

/** A seat's secret. Presenting it on reconnect reclaims the seat, GM included. */
export function generateToken(): string {
  return randomBytes(24).toString('hex');
}

export interface Session {
  token: string;
  sessionId: string;
  role: 'gm' | 'player';
  code: string;
}

/**
 * Everything the server knows about a room. `state` is the broadcast-safe part;
 * tokens and the dice seed never leave this process.
 */
export interface RoomRecord {
  state: RoomState;
  /** token -> session. Tokens are secrets and are never broadcast. */
  sessions: Map<string, Session>;
  /** Seeds every roll in this room, so results are reproducible and auditable. */
  seed: number;
  /** How many rolls have happened; combined with the seed it identifies each roll. */
  rollCount: number;
  updatedAt: number;
}

/**
 * The rng for the nth roll in a room. Deterministic in (seed, index), so any roll
 * can be recomputed later from the log and audited.
 */
export function rngForRoll(seed: number, index: number): Rng {
  return seededRng(seed + index);
}

export interface ApplyOutcome {
  ok: boolean;
  /** What the GM is told changed. */
  patch: RoomPatch;
  /**
   * What players are told changed. Filtered: only the active scene, no GM-only
   * tokens, and no unrevealed fog. Computed here so the transport can't leak by
   * forgetting to filter.
   */
  playerPatch: RoomPatch;
  entries: readonly RollEntry[];
  error?: string;
  message?: string;
}

/** The room as a role may see it. */
export function viewFor(state: RoomState, role: 'gm' | 'player'): RoomState {
  return roomForRole(state, role);
}

/** Patches for both audiences, derived from the same before/after pair. */
function patchesFor(before: RoomState, after: RoomState): Pick<ApplyOutcome, 'patch' | 'playerPatch'> {
  return {
    patch: roomPatch(before, after),
    playerPatch: roomPatch(viewFor(before, 'player'), viewFor(after, 'player')),
  };
}

/**
 * In-memory room storage. The single source of truth: clients send intents, this
 * validates and applies them through the shared reducers, and returns what changed.
 */
export class RoomStore {
  private readonly rooms = new Map<string, RoomRecord>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  get size(): number {
    return this.rooms.size;
  }

  has(code: string): boolean {
    return this.rooms.has(code);
  }

  get(code: string): RoomRecord | null {
    return this.rooms.get(code) ?? null;
  }

  list(): readonly RoomRecord[] {
    return [...this.rooms.values()];
  }

  /** Creates a room with a unique code and seats the creator as GM. */
  createRoom(gmName: string, seed = randomInt(2 ** 31)): { room: RoomRecord; session: Session } {
    let code = generateCode();
    while (this.rooms.has(code)) code = generateCode();

    const sessionId = `gm-${code}`;
    const session: Session = { token: generateToken(), sessionId, role: 'gm', code };
    const room: RoomRecord = {
      state: createRoom(code, { id: sessionId, name: gmName, connected: true }),
      sessions: new Map([[session.token, session]]),
      seed,
      rollCount: 0,
      updatedAt: this.now(),
    };

    this.rooms.set(code, room);
    return { room, session };
  }

  /** Seats a new player. Returns null if the code is unknown. */
  joinRoom(code: string, name: string): { room: RoomRecord; session: Session } | null {
    const room = this.rooms.get(code);
    if (!room) return null;

    const sessionId = `pc-${randomBytes(6).toString('hex')}`;
    const session: Session = { token: generateToken(), sessionId, role: 'player', code };
    room.sessions.set(session.token, session);
    room.state = {
      ...room.state,
      players: [...room.state.players, { id: sessionId, name, connected: true, characterId: null }],
    };
    room.updatedAt = this.now();
    return { room, session };
  }

  /** Looks up a seat by its token. This is the only way an actor is identified. */
  resume(code: string, token: string): { room: RoomRecord; session: Session } | null {
    const room = this.rooms.get(code);
    if (!room) return null;
    const session = room.sessions.get(token);
    if (!session) return null;

    room.state = setConnected(room.state, session, true);
    room.updatedAt = this.now();
    return { room, session };
  }

  setConnected(code: string, token: string, connected: boolean): RoomPatch | null {
    const room = this.rooms.get(code);
    if (!room) return null;
    const session = room.sessions.get(token);
    if (!session) return null;

    const before = room.state;
    room.state = setConnected(before, session, connected);
    room.updatedAt = this.now();
    return roomPatch(before, room.state);
  }

  /** A player claims a character slot, uploading the sheet they created locally. */
  claimCharacter(
    code: string,
    token: string,
    characterId: string,
    sheet: SheetState,
  ): ApplyOutcome {
    const room = this.rooms.get(code);
    if (!room) {
      return { ok: false, patch: {}, playerPatch: {}, entries: [], error: 'unknownRoom' };
    }
    const session = room.sessions.get(token);
    if (!session) {
      return { ok: false, patch: {}, playerPatch: {}, entries: [], error: 'unknownSession' };
    }

    // One character per seat, and a character can't be claimed out from under a player.
    const claimedByAnother = room.state.players.some(
      (p) => p.characterId === characterId && p.id !== session.sessionId,
    );
    if (claimedByAnother) {
      return {
        ok: false,
        patch: {},
        playerPatch: {},
        entries: [],
        error: 'alreadyClaimed',
        message: 'another player controls that character',
      };
    }

    const before = room.state;
    room.state = {
      ...before,
      characters: { ...before.characters, [characterId]: sheet },
      players:
        session.role === 'player'
          ? before.players.map((p) => (p.id === session.sessionId ? { ...p, characterId } : p))
          : before.players,
    };
    room.updatedAt = this.now();
    return { ok: true, ...patchesFor(before, room.state), entries: [] };
  }

  /**
   * Applies one intent. The actor comes from the session token, never from the
   * message, so a client cannot claim to be someone else.
   */
  apply(code: string, token: string, event: RoomEvent): ApplyOutcome {
    const room = this.rooms.get(code);
    if (!room) {
      return { ok: false, patch: {}, playerPatch: {}, entries: [], error: 'unknownRoom' };
    }
    const session = room.sessions.get(token);
    if (!session) {
      return { ok: false, patch: {}, playerPatch: {}, entries: [], error: 'unknownSession' };
    }

    const actor: Actor = { id: session.sessionId, role: session.role };
    const rollsThisEvent = event.type === 'rollDuality' || event.type === 'rollDamage' ? 1 : 0;
    const rng = rngForRoll(room.seed, room.rollCount);

    const before = room.state;
    const result = applyRoomEvent(before, actor, event, rng, this.now());
    if (!result.ok) {
      return {
        ok: false,
        patch: {},
        playerPatch: {},
        entries: [],
        error: result.error,
        message: result.message,
      };
    }

    room.state = result.state;
    room.rollCount += rollsThisEvent;
    room.updatedAt = this.now();
    return { ok: true, ...patchesFor(before, result.state), entries: result.entries };
  }

  /** Restores rooms from a snapshot. Sessions and seeds are restored with them. */
  restore(records: readonly SerializedRoom[]): void {
    for (const record of records) {
      this.rooms.set(record.state.code, {
        state: record.state,
        sessions: new Map(record.sessions.map((s) => [s.token, s])),
        seed: record.seed,
        rollCount: record.rollCount,
        updatedAt: record.updatedAt,
      });
    }
  }

  /** A JSON-serializable copy of every room, for the periodic disk snapshot. */
  serialize(): SerializedRoom[] {
    return [...this.rooms.values()].map((room) => ({
      state: room.state,
      sessions: [...room.sessions.values()],
      seed: room.seed,
      rollCount: room.rollCount,
      updatedAt: room.updatedAt,
    }));
  }
}

export interface SerializedRoom {
  state: RoomState;
  sessions: Session[];
  seed: number;
  rollCount: number;
  updatedAt: number;
}

/** Flags a seat connected or disconnected, for the presence display. */
function setConnected(state: RoomState, session: Session, connected: boolean): RoomState {
  if (session.role === 'gm') {
    if (state.gm.connected === connected) return state;
    return { ...state, gm: { ...state.gm, connected } };
  }
  const player = state.players.find((p) => p.id === session.sessionId);
  if (player === undefined || player.connected === connected) return state;
  return {
    ...state,
    players: state.players.map((p) => (p.id === session.sessionId ? { ...p, connected } : p)),
  };
}
