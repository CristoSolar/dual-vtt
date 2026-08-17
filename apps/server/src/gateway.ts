import {
  CHANNEL,
  ClaimCharacterSchema,
  JoinCampaignSchema,
  RoomEventSchema,
  roomForRole,
  type Actor,
  type RoomPatch,
} from '@daggerheart/protocol';
import type { Server, Socket } from 'socket.io';

import type { CampaignStore } from './campaigns.js';
import type { SessionStore } from './sessions.js';
import type { UserStore } from './users.js';

/**
 * The transport layer. A socket authenticates once, at connection, with the same
 * login token Phase A already issues over HTTP — there is no separate per-campaign
 * seat token anymore. From there, `joinCampaign` seats it in one specific campaign
 * after checking membership, and every later message is scoped to that seat.
 */

/** Set once per socket, right after a successful connection-time auth check. */
const accountOf = new WeakMap<Socket, string>();
/** Set once the socket has joined a campaign; absent until then. */
const seatOf = new WeakMap<Socket, { campaignId: string; role: 'gm' | 'player' }>();

const reject = (socket: Socket, error: string, message: string): void => {
  socket.emit(CHANNEL.rejected, { error, message });
};

const channelFor = (campaignId: string): string => `campaign:${campaignId}`;
const gmChannelFor = (campaignId: string): string => `campaign:${campaignId}:gm`;
const playerChannelFor = (campaignId: string): string => `campaign:${campaignId}:players`;

/** Sends the whole current room, filtered to what this role may see — never GM-only
 * tokens or unrevealed fog to a player. */
function sendFullState(socket: Socket, campaigns: CampaignStore, campaignId: string, role: 'gm' | 'player'): void {
  const campaign = campaigns.get(campaignId);
  if (campaign === null) return;
  socket.emit(CHANNEL.roomState, roomForRole(campaign.state, role));
}

function joinChannels(socket: Socket, campaignId: string, role: 'gm' | 'player'): void {
  void socket.join(channelFor(campaignId));
  void socket.join(role === 'gm' ? gmChannelFor(campaignId) : playerChannelFor(campaignId));
}

function broadcastPatches(
  io: Server,
  campaignId: string,
  outcome: { patch: RoomPatch; playerPatch: RoomPatch },
): void {
  if (Object.keys(outcome.patch).length > 0) {
    io.to(gmChannelFor(campaignId)).emit(CHANNEL.roomPatch, outcome.patch);
  }
  if (Object.keys(outcome.playerPatch).length > 0) {
    io.to(playerChannelFor(campaignId)).emit(CHANNEL.roomPatch, outcome.playerPatch);
  }
}

export function registerGateway(
  io: Server,
  campaigns: CampaignStore,
  sessions: SessionStore,
  users: UserStore,
): void {
  // Auth runs in connection middleware, not the `connection` handler: by the time
  // that handler fires the client has already seen a `connect` event, so rejecting
  // there only produces a `disconnect` on a socket the client believes is live.
  // Rejecting here instead makes the client's connection attempt fail with
  // `connect_error`, before any `connect` event is ever emitted.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as unknown;
    const accountId = typeof token === 'string' ? sessions.resolve(token) : null;
    if (accountId === null) {
      next(new Error('unauthorized'));
      return;
    }
    accountOf.set(socket, accountId);
    next();
  });

  io.on('connection', (socket) => {
    socket.on(CHANNEL.joinCampaign, (payload: unknown) => {
      const parsed = JoinCampaignSchema.safeParse(payload);
      if (!parsed.success) return reject(socket, 'badRequest', 'invalid joinCampaign');

      const account = accountOf.get(socket);
      if (account === undefined) return; // unreachable: connection already required auth

      const user = users.findById(account);
      const seat = campaigns.seatFor(parsed.data.campaignId, account, user?.username ?? 'Jugador');
      if (seat === null) return reject(socket, 'forbidden', 'not a member of that campaign');

      seatOf.set(socket, { campaignId: parsed.data.campaignId, role: seat.role });
      joinChannels(socket, parsed.data.campaignId, seat.role);
      sendFullState(socket, campaigns, parsed.data.campaignId, seat.role);
      socket
        .to(channelFor(parsed.data.campaignId))
        .emit(CHANNEL.roomPatch, { players: campaigns.get(parsed.data.campaignId)?.state.players, gm: campaigns.get(parsed.data.campaignId)?.state.gm });
    });

    socket.on(CHANNEL.claimCharacter, (payload: unknown) => {
      const seat = seatOf.get(socket);
      if (seat === undefined) return reject(socket, 'noSeat', 'join a campaign first');

      const parsed = ClaimCharacterSchema.safeParse(payload);
      if (!parsed.success) return reject(socket, 'badRequest', 'invalid character');

      const account = accountOf.get(socket);
      if (account === undefined) return;

      const outcome = campaigns.claimCharacter(seat.campaignId, account, parsed.data.sheet);
      if (!outcome.ok) return reject(socket, outcome.error ?? 'rejected', outcome.message ?? 'claim rejected');
      broadcastPatches(io, seat.campaignId, outcome);
    });

    socket.on(CHANNEL.intent, (payload: unknown) => {
      const seat = seatOf.get(socket);
      if (seat === undefined) return reject(socket, 'noSeat', 'join a campaign first');

      const parsed = RoomEventSchema.safeParse(payload);
      if (!parsed.success) return reject(socket, 'badRequest', 'invalid intent');

      const account = accountOf.get(socket);
      if (account === undefined) return;

      const actor: Actor = { id: account, role: seat.role };
      const outcome = campaigns.apply(seat.campaignId, actor, parsed.data);
      if (!outcome.ok) return reject(socket, outcome.error ?? 'rejected', outcome.message ?? 'rejected');

      broadcastPatches(io, seat.campaignId, outcome);
      if (outcome.entries.length > 0) {
        io.to(channelFor(seat.campaignId)).emit(CHANNEL.rolled, { entries: outcome.entries });
      }
    });

    socket.on('disconnect', () => {
      const seat = seatOf.get(socket);
      const account = accountOf.get(socket);
      if (seat === undefined || account === undefined) return;
      const patch = campaigns.setConnected(seat.campaignId, account, false);
      if (patch !== null) io.to(channelFor(seat.campaignId)).emit(CHANNEL.roomPatch, patch);
    });
  });
}
