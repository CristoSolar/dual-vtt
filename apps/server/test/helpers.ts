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

import { CampaignStore } from '../src/campaigns.js';
import { registerGateway } from '../src/gateway.js';
import { SessionStore } from '../src/sessions.js';
import { UserStore } from '../src/users.js';

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

/** A running server plus everything a test needs to authenticate against it. */
export interface TestServer {
  url: string;
  campaigns: CampaignStore;
  users: UserStore;
  sessions: SessionStore;
  /** Times `registerGateway`'s persist callback has fired — lets a test confirm an
   * event triggered an immediate snapshot rather than waiting on a periodic timer,
   * which nothing in this harness runs. */
  persistCount: () => number;
  close: () => Promise<void>;
}

export async function startTestServer(seed = 1234): Promise<TestServer> {
  const http: HttpServer = createServer();
  const io = new Server(http, { cors: { origin: '*' } });

  const campaigns = new CampaignStore();
  const originalCreate = campaigns.createCampaign.bind(campaigns);
  campaigns.createCampaign = (ownerId: string, ownerUsername: string, name: string) =>
    originalCreate(ownerId, ownerUsername, name, seed);

  const users = new UserStore();
  const sessions = new SessionStore();

  let persists = 0;
  registerGateway(io, campaigns, sessions, users, () => {
    persists += 1;
  });

  await new Promise<void>((resolve) => http.listen(0, resolve));
  const address = http.address() as AddressInfo;

  return {
    url: `http://localhost:${address.port}`,
    campaigns,
    users,
    sessions,
    persistCount: () => persists,
    close: async () => {
      await io.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

/** A connected, authenticated socket client with promise-based helpers. */
export class TestClient {
  private constructor(readonly socket: Socket) {}

  static async connect(url: string, token: string): Promise<TestClient> {
    const socket = connect(url, { transports: ['websocket'], forceNew: true, auth: { token } });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    return new TestClient(socket);
  }

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

export interface AccountFixture {
  id: string;
  username: string;
  token: string;
}

/** Creates a fresh account on the running test server and logs it in (no HTTP round trip needed). */
export async function accountFor(
  server: TestServer,
  username: string,
  role: 'gm' | 'player' = 'player',
): Promise<AccountFixture> {
  const user = await server.users.createUser(username, 'password', role);
  const token = server.sessions.create(user.id);
  return { id: user.id, username, token };
}

/** Creates a campaign owned by `gm`, connects its socket, and seats it. */
export async function createCampaignAs(
  server: TestServer,
  gm: AccountFixture,
  name = 'Test Campaign',
): Promise<{ client: TestClient; campaignId: string; state: RoomState }> {
  const record = server.campaigns.createCampaign(gm.id, gm.username, name);
  const client = await TestClient.connect(server.url, gm.token);
  const state = client.next<RoomState>(CHANNEL.roomState);
  client.emit(CHANNEL.joinCampaign, { campaignId: record.id });
  return { client, campaignId: record.id, state: await state };
}

/** Adds `player` as a member of `campaignId` and connects/seats their socket. */
export async function joinCampaignAs(
  server: TestServer,
  gm: AccountFixture,
  campaignId: string,
  player: AccountFixture,
): Promise<{ client: TestClient; state: RoomState }> {
  server.campaigns.addMember(campaignId, gm.id, player.id);
  const client = await TestClient.connect(server.url, player.token);
  const state = client.next<RoomState>(CHANNEL.roomState);
  client.emit(CHANNEL.joinCampaign, { campaignId });
  return { client, state: await state };
}

export type { RoomPatch };
