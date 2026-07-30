import { CHANNEL, type RoomPatch, type RoomState } from '@daggerheart/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildSheet,
  createRoomAs,
  joinRoomAs,
  startTestServer,
  TestClient,
  type SessionInfo,
  type TestServer,
} from './helpers.js';

describe('room lifecycle over a socket', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it('creates a room and issues the GM a token and a 6-character code', async () => {
    const { client, session, state } = await createRoomAs(server.url, 'The GM');

    expect(session.role).toBe('gm');
    expect(session.code).toHaveLength(6);
    expect(session.token.length).toBeGreaterThanOrEqual(8);
    expect(state.gm.name).toBe('The GM');
    expect(state.fear).toBe(0);
    expect(state.players).toEqual([]);
    // The GM's token is a secret and must never appear in broadcast state.
    expect(JSON.stringify(state)).not.toContain(session.token);

    client.close();
  });

  it('rejects a join with an unknown code', async () => {
    const client = await TestClient.connect(server.url);
    const rejected = client.next<{ error: string }>(CHANNEL.rejected);
    client.emit(CHANNEL.joinRoom, { code: 'ZZZZZZ', name: 'Nobody' });

    expect((await rejected).error).toBe('unknownRoom');
    client.close();
  });

  it('rejects malformed messages instead of crashing', async () => {
    const client = await TestClient.connect(server.url);
    const rejected = client.next<{ error: string }>(CHANNEL.rejected);
    client.emit(CHANNEL.createRoom, { gmName: '' });

    expect((await rejected).error).toBe('badRequest');
    client.close();
  });

  it('broadcasts one client’s damage to the other within a single broadcast', async () => {
    const gm = await createRoomAs(server.url, 'GM');
    const code = gm.session.code;

    const alice = await joinRoomAs(server.url, code, 'Alice');
    const bob = await joinRoomAs(server.url, code, 'Bob');

    // Alice claims a character.
    const sheet = buildSheet('guardian');
    const claimed = bob.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => p.characters?.['alice-pc'] !== undefined,
    );
    alice.client.emit(CHANNEL.claimCharacter, { characterId: 'alice-pc', sheet });
    await claimed;

    const thresholds = sheet.character.thresholds;

    // Alice takes damage at or above Severe: the server must mark 3 HP.
    const bobSees = bob.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.characters?.['alice-pc']?.hpMarked ?? 0) > 0,
    );
    alice.client.emit(CHANNEL.intent, {
      type: 'takeDamage',
      characterId: 'alice-pc',
      incoming: thresholds.severe,
      damageType: 'physical',
      direct: false,
      armorSlotsToMark: 0,
    });

    const patch = await bobSees;
    expect(patch.characters?.['alice-pc']?.hpMarked).toBe(3);

    // And the server's own copy agrees.
    expect(server.store.get(code)?.state.characters['alice-pc']?.hpMarked).toBe(3);

    gm.client.close();
    alice.client.close();
    bob.client.close();
  });

  it('computes damage server-side rather than trusting a client-sent result', async () => {
    const gm = await createRoomAs(server.url, 'GM');
    const alice = await joinRoomAs(server.url, gm.session.code, 'Alice');

    const sheet = buildSheet('guardian');
    const claimed = gm.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => p.characters?.['pc'] !== undefined,
    );
    alice.client.emit(CHANNEL.claimCharacter, { characterId: 'pc', sheet });
    await claimed;

    // A hit below the Major threshold marks exactly 1 HP, whatever the client hopes.
    const seen = gm.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.characters?.['pc']?.hpMarked ?? 0) > 0,
    );
    alice.client.emit(CHANNEL.intent, {
      type: 'takeDamage',
      characterId: 'pc',
      incoming: Math.max(1, sheet.character.thresholds.major - 1),
      damageType: 'physical',
      direct: false,
      armorSlotsToMark: 0,
      // A hostile client trying to dictate the outcome; the schema drops it.
      hpMarked: 0,
    });

    expect((await seen).characters?.['pc']?.hpMarked).toBe(1);

    gm.client.close();
    alice.client.close();
  });

  it('rejects a player mutating a character they do not own, changing nothing', async () => {
    const gm = await createRoomAs(server.url, 'GM');
    const code = gm.session.code;
    const alice = await joinRoomAs(server.url, code, 'Alice');
    const bob = await joinRoomAs(server.url, code, 'Bob');

    const claimed = bob.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => p.characters?.['alice-pc'] !== undefined,
    );
    alice.client.emit(CHANNEL.claimCharacter, { characterId: 'alice-pc', sheet: buildSheet() });
    await claimed;

    const before = server.store.get(code)?.state.characters['alice-pc']?.hpMarked;

    const rejected = bob.client.next<{ error: string }>(CHANNEL.rejected);
    bob.client.emit(CHANNEL.intent, { type: 'markHP', characterId: 'alice-pc', amount: 3 });

    expect((await rejected).error).toBe('notYourCharacter');
    expect(server.store.get(code)?.state.characters['alice-pc']?.hpMarked).toBe(before);

    gm.client.close();
    alice.client.close();
    bob.client.close();
  });

  it('rejects spendFear from a non-GM client', async () => {
    const gm = await createRoomAs(server.url, 'GM');
    const code = gm.session.code;
    const alice = await joinRoomAs(server.url, code, 'Alice');

    // Give the GM some Fear to attempt to spend.
    const gained = alice.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => p.fear !== undefined,
    );
    gm.client.emit(CHANNEL.intent, { type: 'gainFear', amount: 3 });
    expect((await gained).fear).toBe(3);

    const rejected = alice.client.next<{ error: string }>(CHANNEL.rejected);
    alice.client.emit(CHANNEL.intent, { type: 'spendFear', amount: 1 });

    expect((await rejected).error).toBe('notGameMaster');
    expect(server.store.get(code)?.state.fear).toBe(3);

    gm.client.close();
    alice.client.close();
  });

  it('lets only the GM change spotlight, countdowns, adversaries, and environment', async () => {
    const gm = await createRoomAs(server.url, 'GM');
    const alice = await joinRoomAs(server.url, gm.session.code, 'Alice');

    const gmOnlyIntents: unknown[] = [
      { type: 'setSpotlight', spotlight: 'someone' },
      { type: 'setEnvironment', environmentId: 'raging-river' },
      { type: 'addCountdown', id: 'c1', name: 'Alarm', kind: 'standard', startingValue: 3, loop: 'none' },
      { type: 'addAdversary', instanceId: 'a1', adversaryId: 'courtier', name: 'Courtier' },
    ];

    for (const intent of gmOnlyIntents) {
      const rejected = alice.client.next<{ error: string }>(CHANNEL.rejected);
      alice.client.emit(CHANNEL.intent, intent);
      expect((await rejected).error, JSON.stringify(intent)).toBe('notGameMaster');
    }

    gm.client.close();
    alice.client.close();
  });

  it('replays full state when a client reconnects with its token', async () => {
    const gm = await createRoomAs(server.url, 'GM');
    const code = gm.session.code;
    const alice = await joinRoomAs(server.url, code, 'Alice');
    const aliceToken = alice.session.token;

    // Build up some state before dropping the connection.
    const claimed = gm.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => p.characters?.['alice-pc'] !== undefined,
    );
    alice.client.emit(CHANNEL.claimCharacter, { characterId: 'alice-pc', sheet: buildSheet() });
    await claimed;

    const stressed = gm.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.characters?.['alice-pc']?.stressMarked ?? 0) === 2,
    );
    alice.client.emit(CHANNEL.intent, { type: 'markStress', characterId: 'alice-pc', amount: 2 });
    await stressed;

    const disconnected = gm.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => p.players?.some((player) => !player.connected) === true,
    );
    alice.client.close();
    // Presence flips to disconnected for the rest of the table.
    const presence = await disconnected;
    expect(presence.players?.find((p) => p.name === 'Alice')?.connected).toBe(false);

    // Reconnect with the token and receive the whole room back.
    const returning = await TestClient.connect(server.url);
    const session = returning.next<SessionInfo>(CHANNEL.session);
    const full = returning.next<RoomState>(CHANNEL.roomState);
    returning.emit(CHANNEL.resume, { code, token: aliceToken });

    expect((await session).sessionId).toBe(alice.session.sessionId);
    const state = await full;
    expect(state.characters['alice-pc']?.stressMarked).toBe(2);
    expect(state.players.find((p) => p.name === 'Alice')?.connected).toBe(true);
    expect(state.code).toBe(code);

    gm.client.close();
    returning.close();
  });

  it('rejects a resume with an unknown token', async () => {
    const gm = await createRoomAs(server.url, 'GM');
    const client = await TestClient.connect(server.url);
    const rejected = client.next<{ error: string }>(CHANNEL.rejected);
    client.emit(CHANNEL.resume, { code: gm.session.code, token: 'a'.repeat(32) });

    expect((await rejected).error).toBe('unknownSession');
    gm.client.close();
    client.close();
  });

  it('broadcasts rolls to the whole table with the roller’s name', async () => {
    const gm = await createRoomAs(server.url, 'GM');
    const alice = await joinRoomAs(server.url, gm.session.code, 'Alice');

    const claimed = gm.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => p.characters?.['pc'] !== undefined,
    );
    alice.client.emit(CHANNEL.claimCharacter, { characterId: 'pc', sheet: buildSheet() });
    await claimed;

    const rolled = gm.client.next<{ entries: { by: string; kind: string }[] }>(CHANNEL.rolled);
    alice.client.emit(CHANNEL.intent, {
      type: 'rollDuality',
      characterId: 'pc',
      request: {
        label: 'Agility Roll',
        modifiers: 2,
        difficulty: 12,
        advantage: 0,
        disadvantage: 0,
        experiences: [],
      },
    });

    const entries = (await rolled).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.by).toBe('Alice');
    expect(entries[0]?.kind).toBe('duality');

    gm.client.close();
    alice.client.close();
  });
});
