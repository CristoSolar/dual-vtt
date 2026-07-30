import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  applyChoice,
  availableOptions,
  createInitialState,
  finalize,
  spellcastTrait,
  type Character,
} from '@daggerheart/character';
import { CHANNEL, createSheet, type RoomPatch, type RoomState, type SheetState } from '@daggerheart/protocol';
import { classes, type ClassId } from '@daggerheart/srd-data';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';

import { registerGateway } from '../src/gateway.js';
import { RoomStore } from '../src/rooms.js';

/** Builds a finished character through the real creation reducer. */
export function buildCharacter(classId: ClassId = 'guardian'): Character {
  const characterClass = classes.find((c) => c.id === classId);
  if (!characterClass) throw new Error(`no such class: ${classId}`);

  let state = createInitialState();
  state = applyChoice(state, { type: 'chooseClass', classId });
  const subclassId = characterClass.subclasses[0];
  if (subclassId === undefined) throw new Error('no subclass');
  state = applyChoice(state, { type: 'chooseSubclass', subclassId });
  state = applyChoice(state, { type: 'chooseAncestry', ancestryId: 'human' });
  state = applyChoice(state, { type: 'chooseCommunity', communityId: 'wanderborne' });
  state = applyChoice(state, {
    type: 'assignTraits',
    traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
  });

  const equipment = availableOptions(state, 5);
  const primary = equipment.primaryWeapons[0];
  const armorPiece = equipment.armor[0];
  const classItem = equipment.classItems[0];
  if (!primary || !armorPiece || !classItem) throw new Error('no equipment');

  state = applyChoice(state, {
    type: 'chooseEquipment',
    equipment: {
      primaryWeaponId: primary.id,
      secondaryWeaponId: null,
      armorId: armorPiece.id,
      potion: 'health',
      classItem,
      spellCarrier: spellcastTrait(state) === null ? null : 'A worn spellbook',
    },
  });

  state = applyChoice(state, { type: 'setName', name: `${characterClass.name} PC` });
  state = applyChoice(state, { type: 'setBackground', background: 'A long road.' });
  state = applyChoice(state, {
    type: 'setExperiences',
    experiences: [
      { name: 'Blacksmith', modifier: 2 },
      { name: 'Survivor', modifier: 2 },
    ],
  });
  const cards = availableOptions(state, 8).cards.slice(0, 2);
  state = applyChoice(state, { type: 'chooseDomainCards', cardIds: cards.map((c) => c.id) });
  state = applyChoice(state, { type: 'setConnections', connections: [] });

  return finalize(state);
}

export const buildSheet = (classId: ClassId = 'guardian'): SheetState =>
  createSheet(buildCharacter(classId));

/** A running server plus a helper to open clients against it. */
export interface TestServer {
  url: string;
  store: RoomStore;
  close: () => Promise<void>;
}

export async function startTestServer(seed = 1234): Promise<TestServer> {
  const http: HttpServer = createServer();
  const io = new Server(http, { cors: { origin: '*' } });
  // Fixed seed so every roll in a test is reproducible.
  const store = new RoomStore();
  const originalCreate = store.createRoom.bind(store);
  store.createRoom = (gmName: string) => originalCreate(gmName, seed);

  registerGateway(io, store);

  await new Promise<void>((resolve) => http.listen(0, resolve));
  const address = http.address() as AddressInfo;

  return {
    url: `http://localhost:${address.port}`,
    store,
    close: async () => {
      await io.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

/** A connected client with promise-based helpers for the messages tests care about. */
export class TestClient {
  private constructor(readonly socket: Socket) {}

  static async connect(url: string): Promise<TestClient> {
    const socket = connect(url, { transports: ['websocket'], forceNew: true });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    return new TestClient(socket);
  }

  /** Waits for the next message on a channel, or rejects on timeout. */
  next<T>(channel: string, timeoutMs = 2000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.socket.off(channel, handler);
        reject(new Error(`timed out waiting for ${channel}`));
      }, timeoutMs);
      const handler = (payload: T) => {
        clearTimeout(timer);
        this.socket.off(channel, handler);
        resolve(payload);
      };
      this.socket.on(channel, handler);
    });
  }

  /**
   * Waits for the next message on a channel that satisfies `predicate`. Patches
   * arrive for every change in the room, so a test must wait for the one it means
   * rather than simply the next one.
   */
  until<T>(channel: string, predicate: (payload: T) => boolean, timeoutMs = 3000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.socket.off(channel, handler);
        reject(new Error(`timed out waiting for a matching ${channel}`));
      }, timeoutMs);
      const handler = (payload: T) => {
        if (!predicate(payload)) return;
        clearTimeout(timer);
        this.socket.off(channel, handler);
        resolve(payload);
      };
      this.socket.on(channel, handler);
    });
  }

  emit(channel: string, payload: unknown): void {
    this.socket.emit(channel, payload);
  }

  close(): void {
    this.socket.disconnect();
  }
}

export interface SessionInfo {
  token: string;
  sessionId: string;
  role: 'gm' | 'player';
  code: string;
}

/** Creates a room and returns the GM's client, session, and initial state. */
export async function createRoomAs(
  url: string,
  gmName = 'GM',
): Promise<{ client: TestClient; session: SessionInfo; state: RoomState }> {
  const client = await TestClient.connect(url);
  const session = client.next<SessionInfo>(CHANNEL.session);
  const state = client.next<RoomState>(CHANNEL.roomState);
  client.emit(CHANNEL.createRoom, { gmName });
  return { client, session: await session, state: await state };
}

/** Joins an existing room and returns the player's client, session, and state. */
export async function joinRoomAs(
  url: string,
  code: string,
  name: string,
): Promise<{ client: TestClient; session: SessionInfo; state: RoomState }> {
  const client = await TestClient.connect(url);
  const session = client.next<SessionInfo>(CHANNEL.session);
  const state = client.next<RoomState>(CHANNEL.roomState);
  client.emit(CHANNEL.joinRoom, { code, name });
  return { client, session: await session, state: await state };
}

export type { RoomPatch };
