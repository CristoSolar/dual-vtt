import { CHANNEL, type RoomPatch, type RoomState } from '@daggerheart/protocol';
import { io as connect } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { accountFor, buildSheet, createCampaignAs, startTestServer, type TestServer } from './helpers.js';

/**
 * A seat belongs to one server-side socket, and a reconnect gets a new one. The
 * client buffers whatever it emits while disconnected and socket.io flushes that
 * buffer *before* any 'connect' listener runs, so a seat re-established by a
 * `joinCampaign` sent from 'connect' arrives after the buffered claim — which the
 * server then rejects with 'noSeat'. Seating from the handshake closes that gap.
 */
describe('a socket that reconnects mid-session', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it('is seated from the handshake, so a claim sent while disconnected lands after reconnecting', async () => {
    const gm = await accountFor(server, 'gm-reconnect', 'gm');
    const player = await accountFor(server, 'alice-reconnect');
    const { client: gmClient, campaignId } = await createCampaignAs(server, gm, 'Reconnect');
    server.campaigns.addMember(campaignId, gm.id, player.id);

    const socket = connect(server.url, {
      transports: ['websocket'],
      forceNew: true,
      reconnectionDelay: 10,
      auth: (cb) => cb({ token: player.token, campaignId }),
    });
    const rejections: string[] = [];
    socket.on(CHANNEL.rejected, (payload: { error: string }) => rejections.push(payload.error));

    // No explicit joinCampaign: the handshake alone seats the socket.
    await new Promise<RoomState>((resolve) => socket.once(CHANNEL.roomState, resolve));

    // Drop the transport (a Wi-Fi blip, a phone waking up) and finish the wizard
    // before the client has reconnected.
    const disconnected = new Promise<void>((resolve) => socket.once('disconnect', () => resolve()));
    socket.io.engine.close();
    await disconnected;
    const claimed = new Promise<RoomPatch>((resolve) => {
      const onPatch = (patch: RoomPatch): void => {
        if (patch.characters?.[player.id] === undefined) return;
        gmClient.socket.off(CHANNEL.roomPatch, onPatch);
        resolve(patch);
      };
      gmClient.socket.on(CHANNEL.roomPatch, onPatch);
    });
    socket.emit(CHANNEL.claimCharacter, { sheet: buildSheet() });

    await claimed;
    expect(rejections).toEqual([]);

    socket.disconnect();
    gmClient.close();
  });
});
