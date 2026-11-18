import { CHANNEL, type PingedMessage, type PrivateEntry, type RoomPatch, type RoomState } from '@daggerheart/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  accountFor,
  buildSheet,
  createCampaignAs,
  joinCampaignAs,
  startTestServer,
  TestClient,
  type TestServer,
} from './helpers.js';

describe('campaign lifecycle over a socket', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it('creates a campaign and seats its owner as GM', async () => {
    const gm = await accountFor(server, 'gm', 'gm');
    const { client, state } = await createCampaignAs(server, gm, 'The Campaign');

    expect(state.gm.id).toBe(gm.id);
    expect(state.gm.name).toBe('gm');
    expect(state.fear).toBe(0);
    expect(state.players).toEqual([]);

    client.close();
  });

  it('rejects joining a campaign the account is not a member of', async () => {
    const gm = await accountFor(server, 'gm2', 'gm');
    const stranger = await accountFor(server, 'stranger');
    const campaign = server.campaigns.createCampaign(gm.id, gm.username, 'Private');

    const client = await TestClient.connect(server.url, stranger.token);
    const rejected = client.next<{ error: string }>(CHANNEL.rejected);
    client.emit(CHANNEL.joinCampaign, { campaignId: campaign.id });

    expect((await rejected).error).toBe('forbidden');
    client.close();
  });

  it('rejects malformed messages instead of crashing', async () => {
    const gm = await accountFor(server, 'gm3', 'gm');
    const client = await TestClient.connect(server.url, gm.token);
    const rejected = client.next<{ error: string }>(CHANNEL.rejected);
    client.emit(CHANNEL.joinCampaign, { campaignId: 123 });

    expect((await rejected).error).toBe('badRequest');
    client.close();
  });

  it('disconnects a socket with no valid login token', async () => {
    // The web client tells this apart from a network failure by the message, and
    // sends the player back to the login screen on it.
    await expect(TestClient.connect(server.url, 'not-a-real-token')).rejects.toMatchObject({
      message: 'unauthorized',
    });
  });

  it('persists immediately when a character is claimed, not just on the periodic snapshot', async () => {
    const gm = await accountFor(server, 'gm-persist', 'gm');
    const alicePlayer = await accountFor(server, 'alice-persist');
    const { client: gmClient, campaignId } = await createCampaignAs(server, gm, 'Persist Test');
    const alice = await joinCampaignAs(server, gm, campaignId, alicePlayer);

    const before = server.persistCount();
    const claimed = gmClient.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => p.characters?.[alicePlayer.id] !== undefined,
    );
    alice.client.emit(CHANNEL.claimCharacter, { sheet: buildSheet() });
    await claimed;

    // No periodic timer runs in this test harness — a restart between the claim
    // and the next tick would otherwise lose the character with no warning.
    expect(server.persistCount()).toBeGreaterThan(before);

    gmClient.close();
    alice.client.close();
  });

  it('files a character claimed over the socket in the player’s library, linked there', async () => {
    const gm = await accountFor(server, 'gm-library', 'gm');
    const alicePlayer = await accountFor(server, 'alice-library');
    const { client: gmClient, campaignId } = await createCampaignAs(server, gm, 'Library Test');
    const alice = await joinCampaignAs(server, gm, campaignId, alicePlayer);

    const claimed = gmClient.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => p.characters?.[alicePlayer.id] !== undefined,
    );
    alice.client.emit(CHANNEL.claimCharacter, { sheet: buildSheet() });
    await claimed;

    const entries = server.characters.listFor(alicePlayer.id);
    expect(entries.map((e) => e.campaignId)).toEqual([campaignId]);

    gmClient.close();
    alice.client.close();
  });

  it('broadcasts one client’s damage to the other within a single broadcast', async () => {
    const gm = await accountFor(server, 'gm4', 'gm');
    const alicePlayer = await accountFor(server, 'alice4');
    const bobPlayer = await accountFor(server, 'bob4');
    const { client: gmClient, campaignId } = await createCampaignAs(server, gm, 'Damage Test');
    const alice = await joinCampaignAs(server, gm, campaignId, alicePlayer);
    const bob = await joinCampaignAs(server, gm, campaignId, bobPlayer);

    const sheet = buildSheet('guardian');
    const claimed = bob.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => p.characters?.[alicePlayer.id] !== undefined,
    );
    alice.client.emit(CHANNEL.claimCharacter, { sheet });
    await claimed;

    const thresholds = sheet.character.thresholds;

    const bobSees = bob.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.characters?.[alicePlayer.id]?.hpMarked ?? 0) > 0,
    );
    alice.client.emit(CHANNEL.intent, {
      type: 'takeDamage',
      characterId: alicePlayer.id,
      incoming: thresholds.severe,
      damageType: 'physical',
      direct: false,
      armorSlotsToMark: 0,
    });

    const patch = await bobSees;
    expect(patch.characters?.[alicePlayer.id]?.hpMarked).toBe(3);
    expect(server.campaigns.get(campaignId)?.state.characters[alicePlayer.id]?.hpMarked).toBe(3);

    gmClient.close();
    alice.client.close();
    bob.client.close();
  });

  it('computes damage server-side rather than trusting a client-sent result', async () => {
    const gm = await accountFor(server, 'gm5', 'gm');
    const alicePlayer = await accountFor(server, 'alice5');
    const { client: gmClient, campaignId } = await createCampaignAs(server, gm, 'Server Damage');
    const alice = await joinCampaignAs(server, gm, campaignId, alicePlayer);

    const sheet = buildSheet('guardian');
    const claimed = gmClient.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => p.characters?.[alicePlayer.id] !== undefined,
    );
    alice.client.emit(CHANNEL.claimCharacter, { sheet });
    await claimed;

    const seen = gmClient.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.characters?.[alicePlayer.id]?.hpMarked ?? 0) > 0,
    );
    alice.client.emit(CHANNEL.intent, {
      type: 'takeDamage',
      characterId: alicePlayer.id,
      incoming: Math.max(1, sheet.character.thresholds.major - 1),
      damageType: 'physical',
      direct: false,
      armorSlotsToMark: 0,
      hpMarked: 0,
    });

    expect((await seen).characters?.[alicePlayer.id]?.hpMarked).toBe(1);

    gmClient.close();
    alice.client.close();
  });

  it('rejects a player mutating a character they do not own, changing nothing', async () => {
    const gm = await accountFor(server, 'gm6', 'gm');
    const alicePlayer = await accountFor(server, 'alice6');
    const bobPlayer = await accountFor(server, 'bob6');
    const { client: gmClient, campaignId } = await createCampaignAs(server, gm, 'Ownership Test');
    const alice = await joinCampaignAs(server, gm, campaignId, alicePlayer);
    const bob = await joinCampaignAs(server, gm, campaignId, bobPlayer);

    const claimed = bob.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => p.characters?.[alicePlayer.id] !== undefined,
    );
    alice.client.emit(CHANNEL.claimCharacter, { sheet: buildSheet() });
    await claimed;

    const before = server.campaigns.get(campaignId)?.state.characters[alicePlayer.id]?.hpMarked;

    const rejected = bob.client.next<{ error: string }>(CHANNEL.rejected);
    bob.client.emit(CHANNEL.intent, { type: 'markHP', characterId: alicePlayer.id, amount: 3 });

    expect((await rejected).error).toBe('notYourCharacter');
    expect(server.campaigns.get(campaignId)?.state.characters[alicePlayer.id]?.hpMarked).toBe(before);

    gmClient.close();
    alice.client.close();
    bob.client.close();
  });

  it('rejects intents from a seated socket whose member was removed', async () => {
    const gm = await accountFor(server, 'gm-removed', 'gm');
    const alicePlayer = await accountFor(server, 'alice-removed');
    const { client: gmClient, campaignId } = await createCampaignAs(server, gm, 'Removal Test');
    const alice = await joinCampaignAs(server, gm, campaignId, alicePlayer);

    const claimed = alice.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => p.characters?.[alicePlayer.id] !== undefined,
    );
    alice.client.emit(CHANNEL.claimCharacter, { sheet: buildSheet() });
    await claimed;

    // The GM removes them while their socket is still open and seated.
    server.campaigns.removeMember(campaignId, gm.id, alicePlayer.id);

    const rejected = alice.client.next<{ error: string }>(CHANNEL.rejected);
    alice.client.emit(CHANNEL.intent, { type: 'markHP', characterId: alicePlayer.id, amount: 1 });
    expect((await rejected).error).toBe('forbidden');

    // Their roster entry and character are gone, and the intent changed nothing.
    const state = server.campaigns.get(campaignId)?.state;
    expect(state?.players.some((p) => p.id === alicePlayer.id)).toBe(false);
    expect(state?.characters[alicePlayer.id]).toBeUndefined();

    gmClient.close();
    alice.client.close();
  });

  it('rejects spendFear from a non-GM client', async () => {
    const gm = await accountFor(server, 'gm7', 'gm');
    const alicePlayer = await accountFor(server, 'alice7');
    const { client: gmClient, campaignId } = await createCampaignAs(server, gm, 'Fear Test');
    const alice = await joinCampaignAs(server, gm, campaignId, alicePlayer);

    const gained = alice.client.until<RoomPatch>(CHANNEL.roomPatch, (p) => p.fear !== undefined);
    gmClient.emit(CHANNEL.intent, { type: 'gainFear', amount: 3 });
    expect((await gained).fear).toBe(3);

    const rejected = alice.client.next<{ error: string }>(CHANNEL.rejected);
    alice.client.emit(CHANNEL.intent, { type: 'spendFear', amount: 1 });

    expect((await rejected).error).toBe('notGameMaster');
    expect(server.campaigns.get(campaignId)?.state.fear).toBe(3);

    gmClient.close();
    alice.client.close();
  });

  it('lets only the GM change spotlight, countdowns, adversaries, and environment', async () => {
    const gm = await accountFor(server, 'gm8', 'gm');
    const alicePlayer = await accountFor(server, 'alice8');
    const { client: gmClient, campaignId } = await createCampaignAs(server, gm, 'GM Only Test');
    const alice = await joinCampaignAs(server, gm, campaignId, alicePlayer);

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

    gmClient.close();
    alice.client.close();
  });

  it('reflects presence when a client disconnects, and lets it rejoin later', async () => {
    const gm = await accountFor(server, 'gm9', 'gm');
    const alicePlayer = await accountFor(server, 'alice9');
    const { client: gmClient, campaignId } = await createCampaignAs(server, gm, 'Reconnect Test');
    const alice = await joinCampaignAs(server, gm, campaignId, alicePlayer);

    const claimed = gmClient.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => p.characters?.[alicePlayer.id] !== undefined,
    );
    alice.client.emit(CHANNEL.claimCharacter, { sheet: buildSheet() });
    await claimed;

    const stressed = gmClient.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.characters?.[alicePlayer.id]?.stressMarked ?? 0) === 2,
    );
    alice.client.emit(CHANNEL.intent, { type: 'markStress', characterId: alicePlayer.id, amount: 2 });
    await stressed;

    const disconnected = gmClient.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => p.players?.some((player) => !player.connected) === true,
    );
    alice.client.close();
    const presence = await disconnected;
    expect(presence.players?.find((p) => p.id === alicePlayer.id)?.connected).toBe(false);

    // Logging back in with the same account and rejoining the same campaign
    // restores the same seat and the campaign's whole current state.
    const returning = await TestClient.connect(server.url, alicePlayer.token);
    const full = returning.next<RoomState>(CHANNEL.roomState);
    returning.emit(CHANNEL.joinCampaign, { campaignId });

    const state = await full;
    expect(state.characters[alicePlayer.id]?.stressMarked).toBe(2);
    expect(state.players.find((p) => p.id === alicePlayer.id)?.connected).toBe(true);
    expect(state.id).toBe(campaignId);

    gmClient.close();
    returning.close();
  });

  it('broadcasts rolls to the whole table with the roller’s name', async () => {
    const gm = await accountFor(server, 'gm10', 'gm');
    const alicePlayer = await accountFor(server, 'alice10');
    const { client: gmClient, campaignId } = await createCampaignAs(server, gm, 'Rolls Test');
    const alice = await joinCampaignAs(server, gm, campaignId, alicePlayer);

    const claimed = gmClient.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => p.characters?.[alicePlayer.id] !== undefined,
    );
    alice.client.emit(CHANNEL.claimCharacter, { sheet: buildSheet() });
    await claimed;

    const rolled = gmClient.next<{ entries: { by: string; kind: string }[] }>(CHANNEL.rolled);
    alice.client.emit(CHANNEL.intent, {
      type: 'rollDuality',
      characterId: alicePlayer.id,
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
    expect(entries[0]?.by).toBe('alice10');
    expect(entries[0]?.kind).toBe('duality');

    gmClient.close();
    alice.client.close();
  });

  it('delivers a whisper to its audience and the GM only', async () => {
    const gm = await accountFor(server, 'gm-whisper', 'gm');
    const alicePlayer = await accountFor(server, 'alice-whisper');
    const bobPlayer = await accountFor(server, 'bob-whisper');
    const carolPlayer = await accountFor(server, 'carol-whisper');
    const { client: gmClient, campaignId } = await createCampaignAs(server, gm, 'Whisper Test');
    const alice = await joinCampaignAs(server, gm, campaignId, alicePlayer);
    const bob = await joinCampaignAs(server, gm, campaignId, bobPlayer);
    const carol = await joinCampaignAs(server, gm, campaignId, carolPlayer);

    const carolPrivate: unknown[] = [];
    carol.client.socket.on(CHANNEL.privateRolled, (payload: unknown) => carolPrivate.push(payload));

    const bobGets = bob.client.next<{ entries: PrivateEntry[] }>(CHANNEL.privateRolled);
    const gmGets = gmClient.next<{ entries: PrivateEntry[] }>(CHANNEL.privateRolled);
    const aliceGets = alice.client.next<{ entries: PrivateEntry[] }>(CHANNEL.privateRolled);
    alice.client.emit(CHANNEL.intent, { type: 'sendMessage', text: 'psst', whisperTo: [bobPlayer.id] });

    for (const received of await Promise.all([bobGets, gmGets, aliceGets])) {
      expect(received.entries).toHaveLength(1);
      expect(received.entries[0]?.entry).toMatchObject({ kind: 'message', text: 'psst' });
      expect(received.entries[0]?.audience).toEqual([bobPlayer.id, alicePlayer.id]);
    }

    // Socket.io delivers in order per socket, so once Carol sees this public
    // message, any whisper sent to her before it would already have arrived.
    const carolSync = carol.client.next(CHANNEL.rolled);
    alice.client.emit(CHANNEL.intent, { type: 'sendMessage', text: 'hello all', whisperTo: [] });
    await carolSync;
    expect(carolPrivate).toEqual([]);

    gmClient.close();
    alice.client.close();
    bob.client.close();
    carol.client.close();
  });

  it('a reconnecting player gets their private entries back in roomState', async () => {
    const gm = await accountFor(server, 'gm-private-back', 'gm');
    const alicePlayer = await accountFor(server, 'alice-private-back');
    const bobPlayer = await accountFor(server, 'bob-private-back');
    const { client: gmClient, campaignId } = await createCampaignAs(server, gm, 'Private Reconnect');
    const alice = await joinCampaignAs(server, gm, campaignId, alicePlayer);
    const bob = await joinCampaignAs(server, gm, campaignId, bobPlayer);

    const claimed = gmClient.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => p.characters?.[alicePlayer.id] !== undefined,
    );
    alice.client.emit(CHANNEL.claimCharacter, { sheet: buildSheet() });
    await claimed;

    const delivered = alice.client.next(CHANNEL.privateRolled);
    alice.client.emit(CHANNEL.intent, {
      type: 'rollDuality',
      characterId: alicePlayer.id,
      request: {
        label: 'Sneak',
        modifiers: 0,
        difficulty: 12,
        advantage: 0,
        disadvantage: 0,
        experiences: [],
      },
      visibility: 'private',
    });
    await delivered;

    const disconnected = gmClient.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => p.players?.find((player) => player.id === alicePlayer.id)?.connected === false,
    );
    alice.client.close();
    await disconnected;

    const returning = await TestClient.connect(server.url, alicePlayer.token);
    const full = returning.next<RoomState>(CHANNEL.roomState);
    returning.emit(CHANNEL.joinCampaign, { campaignId });
    const state = await full;
    expect(state.privateLog).toHaveLength(1);
    expect(state.privateLog[0]?.audience).toEqual([alicePlayer.id]);
    expect(state.privateLog[0]?.entry.kind).toBe('duality');

    // Another player rejoining sees none of it.
    bob.client.close();
    const bobBack = await TestClient.connect(server.url, bobPlayer.token);
    const bobFull = bobBack.next<RoomState>(CHANNEL.roomState);
    bobBack.emit(CHANNEL.joinCampaign, { campaignId });
    expect((await bobFull).privateLog).toEqual([]);

    gmClient.close();
    returning.close();
    bobBack.close();
  });

  it('no roomPatch to the player channel carries privateLog', async () => {
    const gm = await accountFor(server, 'gm-no-patch', 'gm');
    const alicePlayer = await accountFor(server, 'alice-no-patch');
    const carolPlayer = await accountFor(server, 'carol-no-patch');
    const { client: gmClient, campaignId } = await createCampaignAs(server, gm, 'No Private Patch');
    const alice = await joinCampaignAs(server, gm, campaignId, alicePlayer);
    const carol = await joinCampaignAs(server, gm, campaignId, carolPlayer);

    const carolPatches: RoomPatch[] = [];
    carol.client.socket.on(CHANNEL.roomPatch, (patch: RoomPatch) => carolPatches.push(patch));

    const gmGets = gmClient.next(CHANNEL.privateRolled);
    alice.client.emit(CHANNEL.intent, { type: 'sendMessage', text: 'secret', whisperTo: [] });
    gmClient.emit(CHANNEL.intent, { type: 'sendMessage', text: 'gm aside', whisperTo: [alicePlayer.id] });
    await gmGets;

    const carolSync = carol.client.next(CHANNEL.rolled);
    gmClient.emit(CHANNEL.intent, { type: 'sendMessage', text: 'public', whisperTo: [] });
    await carolSync;
    expect(carolPatches.some((patch) => 'privateLog' in patch)).toBe(false);

    gmClient.close();
    alice.client.close();
    carol.client.close();
  });
  it('relays a player ping on the active scene to the whole table, stamped with its sender', async () => {
    const gm = await accountFor(server, 'gm-ping', 'gm');
    const alicePlayer = await accountFor(server, 'alice-ping');
    const bobPlayer = await accountFor(server, 'bob-ping');
    const { client: gmClient, campaignId } = await createCampaignAs(server, gm, 'Ping Test');
    const alice = await joinCampaignAs(server, gm, campaignId, alicePlayer);
    const bob = await joinCampaignAs(server, gm, campaignId, bobPlayer);

    const ready = bob.client.until<RoomPatch>(CHANNEL.roomPatch, (p) => p.map?.activeSceneId === 'scene-1');
    gmClient.emit(CHANNEL.intent, { type: 'addScene', id: 'scene-1', name: 'Bridge' });
    await ready;

    const gets = [gmClient, alice.client, bob.client].map((c) => c.next<PingedMessage>(CHANNEL.pinged));
    alice.client.emit(CHANNEL.ping, { sceneId: 'scene-1', x: 10, y: 20, byId: 'forged' });
    for (const received of await Promise.all(gets)) {
      expect(received).toEqual({ sceneId: 'scene-1', x: 10, y: 20, byId: alicePlayer.id });
    }

    gmClient.close();
    alice.client.close();
    bob.client.close();
  });

  it('drops a player ping on a scene that is not active', async () => {
    const gm = await accountFor(server, 'gm-ping-inactive', 'gm');
    const alicePlayer = await accountFor(server, 'alice-ping-inactive');
    const { client: gmClient, campaignId } = await createCampaignAs(server, gm, 'Ping Inactive');
    const alice = await joinCampaignAs(server, gm, campaignId, alicePlayer);

    const ready = alice.client.until<RoomPatch>(CHANNEL.roomPatch, (p) => p.map?.activeSceneId === 'visible');
    gmClient.emit(CHANNEL.intent, { type: 'addScene', id: 'visible', name: 'Visible' });
    gmClient.emit(CHANNEL.intent, { type: 'addScene', id: 'secret', name: 'Secret' });
    await ready;

    const gmPings: PingedMessage[] = [];
    const alicePings: PingedMessage[] = [];
    gmClient.socket.on(CHANNEL.pinged, (p: PingedMessage) => gmPings.push(p));
    alice.client.socket.on(CHANNEL.pinged, (p: PingedMessage) => alicePings.push(p));

    // Per-socket order: once the message that follows lands, the ping would have too.
    const sync = [gmClient.next(CHANNEL.rolled), alice.client.next(CHANNEL.rolled)];
    alice.client.emit(CHANNEL.ping, { sceneId: 'secret', x: 1, y: 1 });
    alice.client.emit(CHANNEL.intent, { type: 'sendMessage', text: 'sync', whisperTo: [] });
    await Promise.all(sync);
    expect(gmPings).toEqual([]);
    expect(alicePings).toEqual([]);

    gmClient.close();
    alice.client.close();
  });

  it('sends a GM ping on an inactive scene to the GM channel only', async () => {
    const gm = await accountFor(server, 'gm-ping-gm', 'gm');
    const alicePlayer = await accountFor(server, 'alice-ping-gm');
    const { client: gmClient, campaignId } = await createCampaignAs(server, gm, 'Ping GM');
    const alice = await joinCampaignAs(server, gm, campaignId, alicePlayer);

    const ready = alice.client.until<RoomPatch>(CHANNEL.roomPatch, (p) => p.map?.activeSceneId === 'visible');
    gmClient.emit(CHANNEL.intent, { type: 'addScene', id: 'visible', name: 'Visible' });
    gmClient.emit(CHANNEL.intent, { type: 'addScene', id: 'secret', name: 'Secret' });
    await ready;

    const alicePings: PingedMessage[] = [];
    alice.client.socket.on(CHANNEL.pinged, (p: PingedMessage) => alicePings.push(p));

    const gmGets = gmClient.next<PingedMessage>(CHANNEL.pinged);
    gmClient.emit(CHANNEL.ping, { sceneId: 'secret', x: 5, y: 5 });
    expect(await gmGets).toEqual({ sceneId: 'secret', x: 5, y: 5, byId: gm.id });

    const aliceSync = alice.client.next<PingedMessage>(CHANNEL.pinged);
    alice.client.emit(CHANNEL.ping, { sceneId: 'visible', x: 2, y: 2 });
    await aliceSync;
    expect(alicePings.map((p) => p.sceneId)).toEqual(['visible']);

    gmClient.close();
    alice.client.close();
  });

  it('relays only the first of two pings within the cooldown from one socket', async () => {
    const gm = await accountFor(server, 'gm-ping-cool', 'gm');
    const alicePlayer = await accountFor(server, 'alice-ping-cool');
    const { client: gmClient, campaignId } = await createCampaignAs(server, gm, 'Ping Cooldown');
    const alice = await joinCampaignAs(server, gm, campaignId, alicePlayer);

    const ready = alice.client.until<RoomPatch>(CHANNEL.roomPatch, (p) => p.map?.activeSceneId === 'scene-1');
    gmClient.emit(CHANNEL.intent, { type: 'addScene', id: 'scene-1', name: 'Bridge' });
    await ready;

    const gmPings: PingedMessage[] = [];
    gmClient.socket.on(CHANNEL.pinged, (p: PingedMessage) => gmPings.push(p));

    const sync = gmClient.next(CHANNEL.rolled);
    alice.client.emit(CHANNEL.ping, { sceneId: 'scene-1', x: 1, y: 1 });
    alice.client.emit(CHANNEL.ping, { sceneId: 'scene-1', x: 2, y: 2 });
    alice.client.emit(CHANNEL.intent, { type: 'sendMessage', text: 'sync', whisperTo: [] });
    await sync;
    expect(gmPings.map((p) => p.x)).toEqual([1]);

    // Another socket has its own cooldown.
    const gmOwn = gmClient.next<PingedMessage>(CHANNEL.pinged);
    gmClient.emit(CHANNEL.ping, { sceneId: 'scene-1', x: 3, y: 3 });
    expect((await gmOwn).byId).toBe(gm.id);

    gmClient.close();
    alice.client.close();
  });
});
