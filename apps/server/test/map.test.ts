import { CHANNEL, type RoomPatch, type RoomState, type Token } from '@daggerheart/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createRoomAs, joinRoomAs, startTestServer, type TestServer } from './helpers.js';

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
  ...over,
});

/** Sets up a room with one scene and one player, returning both clients. */
async function tableWithScene(url: string) {
  const gm = await createRoomAs(url, 'GM');
  const player = await joinRoomAs(url, gm.session.code, 'Alice');

  const created = player.client.until<RoomPatch>(
    CHANNEL.roomPatch,
    (p) => (p.map?.scenes.length ?? 0) > 0,
  );
  gm.client.emit(CHANNEL.intent, { type: 'addScene', id: 'scene-1', name: 'The Bridge' });
  await created;

  return { gm, player, code: gm.session.code };
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
    const { gm, player, code } = await tableWithScene(server.url);

    const added = player.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.map?.scenes[0]?.tokens.length ?? 0) > 0,
    );
    gm.client.emit(CHANNEL.intent, { type: 'addToken', sceneId: 'scene-1', token: token() });
    await added;

    const moved = player.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => p.map?.scenes[0]?.tokens[0]?.x === 400,
    );
    gm.client.emit(CHANNEL.intent, {
      type: 'moveToken',
      sceneId: 'scene-1',
      tokenId: 'tok-1',
      x: 400,
      y: 250,
      commit: true,
    });

    const patch = await moved;
    expect(patch.map?.scenes[0]?.tokens[0]).toMatchObject({ x: 400, y: 250 });
    // The server's own copy agrees.
    const scene = server.store.get(code)?.state.map.scenes[0];
    expect(scene?.tokens[0]).toMatchObject({ x: 400, y: 250 });

    gm.client.close();
    player.client.close();
  });

  it('lets a player move only the token they own', async () => {
    const { gm, player, code } = await tableWithScene(server.url);
    const playerId = player.session.sessionId;

    const added = player.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.map?.scenes[0]?.tokens.length ?? 0) > 0,
    );
    gm.client.emit(CHANNEL.intent, {
      type: 'addToken',
      sceneId: 'scene-1',
      token: token({ ownerId: playerId }),
    });
    await added;

    const moved = gm.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => p.map?.scenes[0]?.tokens[0]?.x === 220,
    );
    player.client.emit(CHANNEL.intent, {
      type: 'moveToken',
      sceneId: 'scene-1',
      tokenId: 'tok-1',
      x: 220,
      y: 180,
      commit: true,
    });
    await moved;

    expect(server.store.get(code)?.state.map.scenes[0]?.tokens[0]).toMatchObject({
      x: 220,
      y: 180,
    });

    gm.client.close();
    player.client.close();
  });

  it('rejects a player moving a token they do not own, changing nothing', async () => {
    const { gm, player, code } = await tableWithScene(server.url);

    const added = player.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.map?.scenes[0]?.tokens.length ?? 0) > 0,
    );
    // ownerId null means GM-only.
    gm.client.emit(CHANNEL.intent, { type: 'addToken', sceneId: 'scene-1', token: token() });
    await added;

    const before = server.store.get(code)?.state.map.scenes[0]?.tokens[0];

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
    expect(server.store.get(code)?.state.map.scenes[0]?.tokens[0]).toEqual(before);

    gm.client.close();
    player.client.close();
  });

  it('rejects every other map mutation from a player', async () => {
    const { gm, player } = await tableWithScene(server.url);

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

    gm.client.close();
    player.client.close();
  });

  it('sends players revealed fog only, never the unrevealed regions', async () => {
    const { gm, player, code } = await tableWithScene(server.url);

    // Give the scene an image so the fog grid has a size, then switch fog on.
    const sized = gm.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.map?.scenes[0]?.fog.cols ?? 0) > 0,
    );
    gm.client.emit(CHANNEL.intent, {
      type: 'setSceneImage',
      sceneId: 'scene-1',
      image: { url: '/uploads/test.png', width: 1000, height: 1000 },
    });
    gm.client.emit(CHANNEL.intent, { type: 'setFogEnabled', sceneId: 'scene-1', enabled: true });
    await sized;

    const revealed = player.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.map?.scenes[0]?.fog.revealed.length ?? 0) > 0,
    );
    gm.client.emit(CHANNEL.intent, {
      type: 'paintFog',
      sceneId: 'scene-1',
      x: 100,
      y: 100,
      radius: 60,
      reveal: true,
    });

    const patch = await revealed;
    const playerFog = patch.map?.scenes[0]?.fog;
    expect(playerFog).toBeDefined();
    if (playerFog === undefined) return;

    // The player learns which cells are revealed...
    expect(playerFog.revealed.length).toBeGreaterThan(0);
    // ...and that is strictly fewer than the whole grid: the rest was never sent.
    expect(playerFog.revealed.length).toBeLessThan(playerFog.cols * playerFog.rows);

    // The server holds the same revealed set, so nothing was withheld incorrectly.
    const serverFog = server.store.get(code)?.state.map.scenes[0]?.fog;
    expect(serverFog?.revealed).toEqual(playerFog.revealed);

    gm.client.close();
    player.client.close();
  });

  it('never sends players an inactive scene or a GM-only token', async () => {
    const gm = await createRoomAs(server.url, 'GM');
    const player = await joinRoomAs(server.url, gm.session.code, 'Alice');

    const ready = player.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.map?.scenes[0]?.tokens.length ?? 0) > 0,
    );
    gm.client.emit(CHANNEL.intent, { type: 'addScene', id: 'visible', name: 'Visible' });
    gm.client.emit(CHANNEL.intent, { type: 'addScene', id: 'secret', name: 'Secret Lair' });
    gm.client.emit(CHANNEL.intent, {
      type: 'addToken',
      sceneId: 'visible',
      token: token({ id: 'seen', name: 'Seen' }),
    });
    gm.client.emit(CHANNEL.intent, {
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

    // The GM does see both scenes and the hidden token.
    const gmState = server.store.get(gm.session.code)?.state;
    expect(gmState?.map.scenes).toHaveLength(2);

    gm.client.close();
    player.client.close();
  });

  it('broadcasts only the newly active scene when the GM switches', async () => {
    const gm = await createRoomAs(server.url, 'GM');
    const player = await joinRoomAs(server.url, gm.session.code, 'Alice');

    gm.client.emit(CHANNEL.intent, { type: 'addScene', id: 'one', name: 'Scene One' });
    const second = player.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => p.map?.scenes[0]?.id === 'one',
    );
    gm.client.emit(CHANNEL.intent, { type: 'addScene', id: 'two', name: 'Scene Two' });
    await second;

    // Switching makes the other scene the only one players receive.
    const switched = player.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => p.map?.activeSceneId === 'two',
    );
    gm.client.emit(CHANNEL.intent, { type: 'setActiveScene', id: 'two' });

    const patch = await switched;
    expect(patch.map?.scenes).toHaveLength(1);
    expect(patch.map?.scenes[0]?.name).toBe('Scene Two');
    expect(JSON.stringify(patch)).not.toContain('Scene One');

    gm.client.close();
    player.client.close();
  });

  it('rejects a move on a scene that is not active', async () => {
    const { gm, player } = await tableWithScene(server.url);
    const playerId = player.session.sessionId;

    gm.client.emit(CHANNEL.intent, {
      type: 'addToken',
      sceneId: 'scene-1',
      token: token({ ownerId: playerId }),
    });
    const switched = gm.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => p.map?.activeSceneId === 'other',
    );
    gm.client.emit(CHANNEL.intent, { type: 'addScene', id: 'other', name: 'Elsewhere' });
    gm.client.emit(CHANNEL.intent, { type: 'setActiveScene', id: 'other' });
    await switched;

    const rejected = player.client.next<{ error: string }>(CHANNEL.rejected);
    player.client.emit(CHANNEL.intent, {
      type: 'moveToken',
      sceneId: 'scene-1',
      tokenId: 'tok-1',
      x: 10,
      y: 10,
      commit: true,
    });
    expect((await rejected).error).toBe('unknownScene');

    gm.client.close();
    player.client.close();
  });

  it('includes the map in the full state a reconnecting client receives', async () => {
    const { gm, player, code } = await tableWithScene(server.url);
    gm.client.emit(CHANNEL.intent, { type: 'addToken', sceneId: 'scene-1', token: token() });

    const seen = player.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.map?.scenes[0]?.tokens.length ?? 0) > 0,
    );
    await seen;

    const returning = await joinRoomAs(server.url, code, 'Late');
    const state: RoomState = returning.state;
    expect(state.map.scenes).toHaveLength(1);
    expect(state.map.scenes[0]?.tokens).toHaveLength(1);

    gm.client.close();
    player.client.close();
    returning.client.close();
  });
});
