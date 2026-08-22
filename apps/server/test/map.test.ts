import { CHANNEL, type RoomPatch, type RoomState, type Token } from '@daggerheart/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { accountFor, createCampaignAs, joinCampaignAs, startTestServer, type TestServer } from './helpers.js';

const token = (over: Partial<Token> = {}): Token => ({
  id: 'tok-1',
  kind: 'pc',
  refId: 'pc1',
  name: 'Alice',
  x: 100,
  y: 100,
  width: 50,
  height: 50,
  rotation: 0,
  ownerId: null,
  hidden: false,
  showRings: false,
  color: '#e2b857',
  image: null,
  colorFrame: false,
  visionRadius: 720,
  ...over,
});

/** Sets up a campaign with one scene and one player, returning both clients. */
async function tableWithScene(server: TestServer, suffix: string) {
  const gm = await accountFor(server, `gm-map-${suffix}`, 'gm');
  const alicePlayer = await accountFor(server, `alice-map-${suffix}`);
  const { client: gmClient, campaignId } = await createCampaignAs(server, gm, 'Map Test');
  const player = await joinCampaignAs(server, gm, campaignId, alicePlayer);

  const created = player.client.until<RoomPatch>(CHANNEL.roomPatch, (p) => (p.map?.scenes.length ?? 0) > 0);
  gmClient.emit(CHANNEL.intent, { type: 'addScene', id: 'scene-1', name: 'The Bridge' });
  await created;

  return { gm, gmClient, player, campaignId, playerId: alicePlayer.id };
}

describe('map sync', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it('broadcasts a GM token move to a connected player', async () => {
    const { gmClient, player, campaignId } = await tableWithScene(server, 'a');

    const added = player.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.map?.scenes[0]?.tokens.length ?? 0) > 0,
    );
    gmClient.emit(CHANNEL.intent, { type: 'addToken', sceneId: 'scene-1', token: token() });
    await added;

    const moved = player.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => p.map?.scenes[0]?.tokens[0]?.x === 400,
    );
    gmClient.emit(CHANNEL.intent, {
      type: 'moveToken',
      sceneId: 'scene-1',
      tokenId: 'tok-1',
      x: 400,
      y: 250,
      commit: true,
    });

    const patch = await moved;
    expect(patch.map?.scenes[0]?.tokens[0]).toMatchObject({ x: 400, y: 250 });
    const scene = server.campaigns.get(campaignId)?.state.map.scenes[0];
    expect(scene?.tokens[0]).toMatchObject({ x: 400, y: 250 });

    gmClient.close();
    player.client.close();
  });

  it('lets a player move only the token they own', async () => {
    const { gmClient, player, campaignId, playerId } = await tableWithScene(server, 'b');

    const added = player.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.map?.scenes[0]?.tokens.length ?? 0) > 0,
    );
    gmClient.emit(CHANNEL.intent, {
      type: 'addToken',
      sceneId: 'scene-1',
      token: token({ ownerId: playerId }),
    });
    await added;

    const moved = gmClient.until<RoomPatch>(CHANNEL.roomPatch, (p) => p.map?.scenes[0]?.tokens[0]?.x === 220);
    player.client.emit(CHANNEL.intent, {
      type: 'moveToken',
      sceneId: 'scene-1',
      tokenId: 'tok-1',
      x: 220,
      y: 180,
      commit: true,
    });
    await moved;

    expect(server.campaigns.get(campaignId)?.state.map.scenes[0]?.tokens[0]).toMatchObject({
      x: 220,
      y: 180,
    });

    gmClient.close();
    player.client.close();
  });

  it('rejects a player moving a token they do not own, changing nothing', async () => {
    const { gmClient, player, campaignId } = await tableWithScene(server, 'c');

    const added = player.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.map?.scenes[0]?.tokens.length ?? 0) > 0,
    );
    gmClient.emit(CHANNEL.intent, { type: 'addToken', sceneId: 'scene-1', token: token() });
    await added;

    const before = server.campaigns.get(campaignId)?.state.map.scenes[0]?.tokens[0];

    const rejected = player.client.next<{ error: string }>(CHANNEL.rejected);
    player.client.emit(CHANNEL.intent, {
      type: 'moveToken',
      sceneId: 'scene-1',
      tokenId: 'tok-1',
      x: 999,
      y: 999,
      commit: true,
    });

    expect((await rejected).error).toBe('notYourToken');
    expect(server.campaigns.get(campaignId)?.state.map.scenes[0]?.tokens[0]).toEqual(before);

    gmClient.close();
    player.client.close();
  });

  it('rejects every other map mutation from a player', async () => {
    const { gmClient, player } = await tableWithScene(server, 'd');

    const playerIntents: unknown[] = [
      { type: 'addScene', id: 'sneaky', name: 'Sneaky' },
      { type: 'removeScene', id: 'scene-1' },
      { type: 'setActiveScene', id: null },
      { type: 'addToken', sceneId: 'scene-1', token: token({ id: 'tok-x' }) },
      { type: 'removeToken', sceneId: 'scene-1', tokenId: 'tok-1' },
      { type: 'paintFog', sceneId: 'scene-1', x: 0, y: 0, radius: 50, reveal: true },
      { type: 'setFogEnabled', sceneId: 'scene-1', enabled: false },
    ];

    for (const intent of playerIntents) {
      const rejected = player.client.next<{ error: string }>(CHANNEL.rejected);
      player.client.emit(CHANNEL.intent, intent);
      expect((await rejected).error, JSON.stringify(intent)).toBe('notGameMaster');
    }

    gmClient.close();
    player.client.close();
  });

  it('lets the GM manage walls and vision mode, but never a player', async () => {
    const { gmClient, player, campaignId } = await tableWithScene(server, 'walls-a');

    const added = gmClient.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.map?.scenes[0]?.walls?.length ?? 0) > 0,
    );
    gmClient.emit(CHANNEL.intent, {
      type: 'addWall',
      sceneId: 'scene-1',
      wall: { id: 'w1', x1: 0, y1: 0, x2: 100, y2: 0, kind: 'wall', open: false },
    });
    await added;
    expect(server.campaigns.get(campaignId)?.state.map.scenes[0]?.walls).toHaveLength(1);

    const doored = gmClient.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => p.map?.scenes[0]?.walls?.[0]?.open === true,
    );
    gmClient.emit(CHANNEL.intent, {
      type: 'updateWall',
      sceneId: 'scene-1',
      wall: { id: 'w1', x1: 0, y1: 0, x2: 100, y2: 0, kind: 'door', open: true },
    });
    await doored;

    const modeSet = gmClient.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => p.map?.scenes[0]?.visionMode === 'auto',
    );
    gmClient.emit(CHANNEL.intent, { type: 'setSceneVisionMode', sceneId: 'scene-1', visionMode: 'auto' });
    await modeSet;

    const removed = gmClient.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.map?.scenes[0]?.walls?.length ?? 0) === 0,
    );
    gmClient.emit(CHANNEL.intent, { type: 'removeWall', sceneId: 'scene-1', wallId: 'w1' });
    await removed;

    const playerIntents: unknown[] = [
      { type: 'addWall', sceneId: 'scene-1', wall: { id: 'sneaky', x1: 0, y1: 0, x2: 1, y2: 1, kind: 'wall', open: false } },
      { type: 'removeWall', sceneId: 'scene-1', wallId: 'w1' },
      { type: 'updateWall', sceneId: 'scene-1', wall: { id: 'w1', x1: 0, y1: 0, x2: 1, y2: 1, kind: 'wall', open: false } },
      { type: 'setSceneVisionMode', sceneId: 'scene-1', visionMode: 'auto' },
    ];
    for (const intent of playerIntents) {
      const rejected = player.client.next<{ error: string }>(CHANNEL.rejected);
      player.client.emit(CHANNEL.intent, intent);
      expect((await rejected).error, JSON.stringify(intent)).toBe('notGameMaster');
    }

    gmClient.close();
    player.client.close();
  });

  it('sends players revealed fog only, never the unrevealed regions', async () => {
    const { gmClient, player, campaignId } = await tableWithScene(server, 'e');

    const sized = gmClient.until<RoomPatch>(CHANNEL.roomPatch, (p) => (p.map?.scenes[0]?.fog.cols ?? 0) > 0);
    gmClient.emit(CHANNEL.intent, {
      type: 'setSceneImage',
      sceneId: 'scene-1',
      image: { url: '/uploads/test.png', width: 1000, height: 1000 },
    });
    gmClient.emit(CHANNEL.intent, { type: 'setFogEnabled', sceneId: 'scene-1', enabled: true });
    await sized;

    const revealed = player.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.map?.scenes[0]?.fog.revealed.length ?? 0) > 0,
    );
    gmClient.emit(CHANNEL.intent, { type: 'paintFog', sceneId: 'scene-1', x: 100, y: 100, radius: 60, reveal: true });

    const patch = await revealed;
    const playerFog = patch.map?.scenes[0]?.fog;
    expect(playerFog).toBeDefined();
    if (playerFog === undefined) return;

    expect(playerFog.revealed.length).toBeGreaterThan(0);
    expect(playerFog.revealed.length).toBeLessThan(playerFog.cols * playerFog.rows);

    const serverFog = server.campaigns.get(campaignId)?.state.map.scenes[0]?.fog;
    expect(serverFog?.revealed).toEqual(playerFog.revealed);

    gmClient.close();
    player.client.close();
  });

  it('never sends players an inactive scene or a GM-only token', async () => {
    const gm = await accountFor(server, 'gm-map-f', 'gm');
    const alicePlayer = await accountFor(server, 'alice-map-f');
    const { client: gmClient, campaignId } = await createCampaignAs(server, gm, 'Hidden Scene Test');
    const player = await joinCampaignAs(server, gm, campaignId, alicePlayer);

    const ready = player.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.map?.scenes[0]?.tokens.length ?? 0) > 0,
    );
    gmClient.emit(CHANNEL.intent, { type: 'addScene', id: 'visible', name: 'Visible' });
    gmClient.emit(CHANNEL.intent, { type: 'addScene', id: 'secret', name: 'Secret Lair' });
    gmClient.emit(CHANNEL.intent, { type: 'addToken', sceneId: 'visible', token: token({ id: 'seen', name: 'Seen' }) });
    gmClient.emit(CHANNEL.intent, {
      type: 'addToken',
      sceneId: 'visible',
      token: token({ id: 'ambush', name: 'Ambusher', hidden: true }),
    });
    const patch = await ready;

    const serialized = JSON.stringify(patch);
    expect(serialized).not.toContain('Secret Lair');
    expect(serialized).not.toContain('Ambusher');
    expect(patch.map?.scenes).toHaveLength(1);
    expect(patch.map?.scenes[0]?.tokens.map((t) => t.id)).toEqual(['seen']);

    const gmState = server.campaigns.get(campaignId)?.state;
    expect(gmState?.map.scenes).toHaveLength(2);

    gmClient.close();
    player.client.close();
  });

  it('broadcasts only the newly active scene when the GM switches', async () => {
    const gm = await accountFor(server, 'gm-map-g', 'gm');
    const alicePlayer = await accountFor(server, 'alice-map-g');
    const { client: gmClient, campaignId } = await createCampaignAs(server, gm, 'Switch Scene Test');
    const player = await joinCampaignAs(server, gm, campaignId, alicePlayer);

    gmClient.emit(CHANNEL.intent, { type: 'addScene', id: 'one', name: 'Scene One' });
    const second = player.client.until<RoomPatch>(CHANNEL.roomPatch, (p) => p.map?.scenes[0]?.id === 'one');
    gmClient.emit(CHANNEL.intent, { type: 'addScene', id: 'two', name: 'Scene Two' });
    await second;

    const switched = player.client.until<RoomPatch>(CHANNEL.roomPatch, (p) => p.map?.activeSceneId === 'two');
    gmClient.emit(CHANNEL.intent, { type: 'setActiveScene', id: 'two' });

    const patch = await switched;
    expect(patch.map?.scenes).toHaveLength(1);
    expect(patch.map?.scenes[0]?.name).toBe('Scene Two');
    expect(JSON.stringify(patch)).not.toContain('Scene One');

    gmClient.close();
    player.client.close();
    void campaignId;
  });

  it('rejects a move on a scene that is not active', async () => {
    const { gmClient, player, playerId } = await tableWithScene(server, 'h');

    gmClient.emit(CHANNEL.intent, { type: 'addToken', sceneId: 'scene-1', token: token({ ownerId: playerId }) });
    const switched = gmClient.until<RoomPatch>(CHANNEL.roomPatch, (p) => p.map?.activeSceneId === 'other');
    gmClient.emit(CHANNEL.intent, { type: 'addScene', id: 'other', name: 'Elsewhere' });
    gmClient.emit(CHANNEL.intent, { type: 'setActiveScene', id: 'other' });
    await switched;

    const rejected = player.client.next<{ error: string }>(CHANNEL.rejected);
    player.client.emit(CHANNEL.intent, { type: 'moveToken', sceneId: 'scene-1', tokenId: 'tok-1', x: 10, y: 10, commit: true });
    expect((await rejected).error).toBe('unknownScene');

    gmClient.close();
    player.client.close();
  });

  it('lets a player place their own character token, once', async () => {
    const { player, campaignId, playerId } = await tableWithScene(server, 'j');

    const added = player.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.map?.scenes[0]?.tokens.length ?? 0) > 0,
    );
    player.client.emit(CHANNEL.intent, {
      type: 'addToken',
      sceneId: 'scene-1',
      token: token({ id: 'self-tok', refId: playerId, ownerId: playerId }),
    });
    await added;

    expect(server.campaigns.get(campaignId)?.state.map.scenes[0]?.tokens).toHaveLength(1);

    // A second token for the same character is rejected — one per player.
    const rejected = player.client.next<{ error: string }>(CHANNEL.rejected);
    player.client.emit(CHANNEL.intent, {
      type: 'addToken',
      sceneId: 'scene-1',
      token: token({ id: 'self-tok-2', refId: playerId, ownerId: playerId }),
    });
    expect((await rejected).error).toBe('tokenExists');

    player.client.close();
  });

  it('rejects a player placing a token for someone else, or unowned by themself', async () => {
    const { player, playerId } = await tableWithScene(server, 'k');

    const otherRefId = player.client.next<{ error: string }>(CHANNEL.rejected);
    player.client.emit(CHANNEL.intent, {
      type: 'addToken',
      sceneId: 'scene-1',
      token: token({ id: 'x1', refId: 'someone-else', ownerId: playerId }),
    });
    expect((await otherRefId).error).toBe('notGameMaster');

    const unowned = player.client.next<{ error: string }>(CHANNEL.rejected);
    player.client.emit(CHANNEL.intent, {
      type: 'addToken',
      sceneId: 'scene-1',
      token: token({ id: 'x2', refId: playerId, ownerId: null }),
    });
    expect((await unowned).error).toBe('notGameMaster');

    player.client.close();
  });

  it('includes the map in the full state a reconnecting client receives', async () => {
    const { gm, gmClient, player, campaignId } = await tableWithScene(server, 'i');
    gmClient.emit(CHANNEL.intent, { type: 'addToken', sceneId: 'scene-1', token: token() });

    const seen = player.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.map?.scenes[0]?.tokens.length ?? 0) > 0,
    );
    await seen;

    const late = await accountFor(server, 'late-i');
    const returning = await joinCampaignAs(server, gm, campaignId, late);
    const state: RoomState = returning.state;
    expect(state.map.scenes).toHaveLength(1);
    expect(state.map.scenes[0]?.tokens).toHaveLength(1);

    gmClient.close();
    player.client.close();
    returning.client.close();
  });

  it('auto-reveals fog around a player token when the scene is in auto vision mode', async () => {
    const { gmClient, player, campaignId, playerId } = await tableWithScene(server, 'walls-b');

    gmClient.emit(CHANNEL.intent, {
      type: 'setSceneImage',
      sceneId: 'scene-1',
      image: { url: '/uploads/test.png', width: 1000, height: 1000 },
    });
    gmClient.emit(CHANNEL.intent, { type: 'setFogEnabled', sceneId: 'scene-1', enabled: true });
    gmClient.emit(CHANNEL.intent, { type: 'setSceneVisionMode', sceneId: 'scene-1', visionMode: 'auto' });

    const revealed = player.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.map?.scenes[0]?.fog.revealed.length ?? 0) > 0,
    );
    gmClient.emit(CHANNEL.intent, {
      type: 'addToken',
      sceneId: 'scene-1',
      token: token({ id: 'auto-1', kind: 'pc', refId: playerId, ownerId: playerId, x: 500, y: 500 }),
    });

    const patch = await revealed;
    const playerFog = patch.map?.scenes[0]?.fog;
    expect(playerFog).toBeDefined();
    if (playerFog === undefined) return;
    expect(playerFog.revealed.length).toBeGreaterThan(0);

    const serverFog = server.campaigns.get(campaignId)?.state.map.scenes[0]?.fog;
    expect(serverFog?.revealed).toEqual(playerFog.revealed);

    gmClient.close();
    player.client.close();
  });

  it('casts auto-reveal vision from the token centre, not its top-left corner', async () => {
    const { gmClient, player, campaignId, playerId } = await tableWithScene(server, 'walls-centre');

    gmClient.emit(CHANNEL.intent, {
      type: 'setSceneImage',
      sceneId: 'scene-1',
      image: { url: '/uploads/test.png', width: 1000, height: 1000 },
    });
    gmClient.emit(CHANNEL.intent, { type: 'setFogEnabled', sceneId: 'scene-1', enabled: true });
    gmClient.emit(CHANNEL.intent, { type: 'setSceneVisionMode', sceneId: 'scene-1', visionMode: 'auto' });
    // A tall wall at x=110 sits between the token's top-left corner (100,100)
    // and its centre (125,125) for a 50x50 token: the corner is left of the
    // wall, the centre is already on the right of it.
    const walled = gmClient.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.map?.scenes[0]?.walls?.length ?? 0) > 0,
    );
    gmClient.emit(CHANNEL.intent, {
      type: 'addWall',
      sceneId: 'scene-1',
      wall: { id: 'centre-wall', x1: 110, y1: 0, x2: 110, y2: 1000, kind: 'wall', open: false },
    });
    await walled;

    const revealed = player.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.map?.scenes[0]?.fog.revealed.length ?? 0) > 0,
    );
    gmClient.emit(CHANNEL.intent, {
      type: 'addToken',
      sceneId: 'scene-1',
      token: token({ id: 'centre-tok', kind: 'pc', refId: playerId, ownerId: playerId, x: 100, y: 100 }),
    });
    await revealed;

    const fog = server.campaigns.get(campaignId)?.state.map.scenes[0]?.fog;
    expect(fog).toBeDefined();
    if (fog === undefined) return;

    // Right of the wall (x > 110): reachable from the centre (125,125).
    const rightCol = Math.floor(300 / fog.cellSize);
    const rightRow = Math.floor(125 / fog.cellSize);
    expect(fog.revealed).toContain(rightRow * fog.cols + rightCol);

    // Left of the wall (x < 110): would only be reachable if vision were
    // (wrongly) cast from the corner at (100,100), which sits left of the
    // wall itself.
    const leftCol = Math.floor(50 / fog.cellSize);
    const leftRow = Math.floor(125 / fog.cellSize);
    expect(fog.revealed).not.toContain(leftRow * fog.cols + leftCol);

    gmClient.close();
    player.client.close();
  });

  it('rejects adding a wall past the 500-wall cap on a scene', async () => {
    const { gmClient, campaignId } = await tableWithScene(server, 'walls-cap');

    const record = server.campaigns.get(campaignId);
    expect(record).not.toBeNull();
    if (record === null || record === undefined) return;
    const scene = record.state.map.scenes[0];
    expect(scene).toBeDefined();
    if (scene === undefined) return;

    const walls = Array.from({ length: 500 }, (_, i) => ({
      id: `cap-wall-${i}`,
      x1: 0,
      y1: i,
      x2: 10,
      y2: i,
      kind: 'wall' as const,
      open: false,
    }));
    record.state = {
      ...record.state,
      map: {
        ...record.state.map,
        scenes: record.state.map.scenes.map((s) => (s.id === scene.id ? { ...s, walls } : s)),
      },
    };

    const rejected = gmClient.next<{ error: string }>(CHANNEL.rejected);
    gmClient.emit(CHANNEL.intent, {
      type: 'addWall',
      sceneId: 'scene-1',
      wall: { id: 'one-too-many', x1: 0, y1: 0, x2: 1, y2: 1, kind: 'wall', open: false },
    });
    expect((await rejected).error).toBe('tooManyWalls');
    expect(server.campaigns.get(campaignId)?.state.map.scenes[0]?.walls).toHaveLength(500);

    gmClient.close();
  });

  it('auto-reveals fog around existing tokens immediately when vision mode switches to auto', async () => {
    const { gmClient, player, campaignId, playerId } = await tableWithScene(server, 'walls-switch');

    gmClient.emit(CHANNEL.intent, {
      type: 'setSceneImage',
      sceneId: 'scene-1',
      image: { url: '/uploads/test.png', width: 1000, height: 1000 },
    });
    const fogReady = player.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.map?.scenes[0]?.fog.cols ?? 0) > 0,
    );
    gmClient.emit(CHANNEL.intent, { type: 'setFogEnabled', sceneId: 'scene-1', enabled: true });
    await fogReady;

    const added = player.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.map?.scenes[0]?.tokens.length ?? 0) > 0,
    );
    gmClient.emit(CHANNEL.intent, {
      type: 'addToken',
      sceneId: 'scene-1',
      token: token({ id: 'presw-1', kind: 'pc', refId: playerId, ownerId: playerId, x: 500, y: 500 }),
    });
    await added;

    // No moveToken/addToken happens after this: fog must reveal purely from
    // the mode switch itself.
    const revealed = player.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.map?.scenes[0]?.fog.revealed.length ?? 0) > 0,
    );
    gmClient.emit(CHANNEL.intent, { type: 'setSceneVisionMode', sceneId: 'scene-1', visionMode: 'auto' });

    const patch = await revealed;
    expect(patch.map?.scenes[0]?.fog.revealed.length ?? 0).toBeGreaterThan(0);

    const serverFog = server.campaigns.get(campaignId)?.state.map.scenes[0]?.fog;
    expect(serverFog?.revealed).toEqual(patch.map?.scenes[0]?.fog.revealed);

    gmClient.close();
    player.client.close();
  });

  it('does not auto-reveal in manual mode', async () => {
    const { gmClient, player, playerId } = await tableWithScene(server, 'walls-c');

    gmClient.emit(CHANNEL.intent, {
      type: 'setSceneImage',
      sceneId: 'scene-1',
      image: { url: '/uploads/test.png', width: 1000, height: 1000 },
    });
    gmClient.emit(CHANNEL.intent, { type: 'setFogEnabled', sceneId: 'scene-1', enabled: true });
    // visionMode left at its default: 'manual'.

    const added = player.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.map?.scenes[0]?.tokens.length ?? 0) > 0,
    );
    gmClient.emit(CHANNEL.intent, {
      type: 'addToken',
      sceneId: 'scene-1',
      token: token({ id: 'manual-1', kind: 'pc', refId: playerId, ownerId: playerId, x: 500, y: 500 }),
    });
    const patch = await added;
    expect(patch.map?.scenes[0]?.fog.revealed ?? []).toEqual([]);

    gmClient.close();
    player.client.close();
  });
});
