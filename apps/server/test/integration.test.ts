import { CHANNEL, type RoomPatch, type RoomState } from '@daggerheart/protocol';
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
    await expect(TestClient.connect(server.url, 'not-a-real-token')).rejects.toBeDefined();
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
});
