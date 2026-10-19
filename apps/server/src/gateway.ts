import {
  CHANNEL,
  ClaimCharacterSchema,
  JoinCampaignSchema,
  PING_COOLDOWN_MS,
  PingSchema,
  RoomEventSchema,
  roomForActor,
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
/** When each socket last had a ping relayed. Cleared on disconnect. */
const lastPingAt = new Map<Socket, number>();

const reject = (socket: Socket, error: string, message: string): void => {
  socket.emit(CHANNEL.rejected, { error, message });
};

const channelFor = (campaignId: string): string => `campaign:${campaignId}`;
const gmChannelFor = (campaignId: string): string => `campaign:${campaignId}:gm`;
const playerChannelFor = (campaignId: string): string => `campaign:${campaignId}:players`;
/** One account's sockets in one campaign — where its private rolls and whispers go. */
const userChannelFor = (campaignId: string, accountId: string): string =>
  `campaign:${campaignId}:user:${accountId}`;

/** Sends the whole current room, filtered to what this actor may see — never GM-only
 * tokens, unrevealed fog, or someone else's private entries to a player. */
function sendFullState(socket: Socket, campaigns: CampaignStore, campaignId: string, actor: Actor): void {
  const campaign = campaigns.get(campaignId);
  if (campaign === null) return;
  socket.emit(CHANNEL.roomState, roomForActor(campaign.state, actor));
}

function joinChannels(socket: Socket, campaignId: string, actor: Actor): void {
  void socket.join(channelFor(campaignId));
  void socket.join(actor.role === 'gm' ? gmChannelFor(campaignId) : playerChannelFor(campaignId));
  void socket.join(userChannelFor(campaignId, actor.id));
}

/**
 * Membership is re-checked on every seated message, not just at join: the GM can
 * remove a player while their socket is still open, and until they disconnect that
 * socket would otherwise keep sending intents and receiving broadcasts. On failure
 * the seat is dropped and the socket leaves every channel for that campaign.
 */
function stillMember(
  socket: Socket,
  campaigns: CampaignStore,
  seat: { campaignId: string; role: 'gm' | 'player' },
  account: string,
): boolean {
  if (campaigns.roleOf(seat.campaignId, account) !== null) return true;
  seatOf.delete(socket);
  void socket.leave(channelFor(seat.campaignId));
  void socket.leave(gmChannelFor(seat.campaignId));
  void socket.leave(playerChannelFor(seat.campaignId));
  void socket.leave(userChannelFor(seat.campaignId, account));
  reject(socket, 'forbidden', 'no longer a member of that campaign');
  return false;
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
  persist: () => void,
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
    const joinCampaign = (payload: unknown): void => {
      const parsed = JoinCampaignSchema.safeParse(payload);
      if (!parsed.success) return reject(socket, 'badRequest', 'invalid joinCampaign');

      const account = accountOf.get(socket);
      if (account === undefined) return; // unreachable: connection already required auth

      const user = users.findById(account);
      const seat = campaigns.seatFor(parsed.data.campaignId, account, user?.username ?? 'Jugador');
      if (seat === null) return reject(socket, 'forbidden', 'not a member of that campaign');

      seatOf.set(socket, { campaignId: parsed.data.campaignId, role: seat.role });
      const actor: Actor = { id: account, role: seat.role };
      joinChannels(socket, parsed.data.campaignId, actor);
      sendFullState(socket, campaigns, parsed.data.campaignId, actor);
      // The roster slices are the same for both roles (`roomForRole` filters only
      // the map), so one combined channel is right here. Skipped entirely if the
      // campaign vanished between the seat check and now, rather than broadcasting
      // a patch of undefined slices.
      const state = campaigns.get(parsed.data.campaignId)?.state;
      if (state !== undefined) {
        socket
          .to(channelFor(parsed.data.campaignId))
          .emit(CHANNEL.roomPatch, { players: state.players, gm: state.gm });
      }
    };
    socket.on(CHANNEL.joinCampaign, joinCampaign);

    // A client that names its campaign in the handshake is seated before it can
    // send anything. On a reconnect, socket.io flushes whatever the client emitted
    // while offline *before* its 'connect' listeners run, so a seat re-established
    // by a `joinCampaign` from there arrives after a buffered claim or intent, and
    // that message is rejected with 'noSeat'.
    const handshakeCampaignId = socket.handshake.auth?.campaignId as unknown;
    if (handshakeCampaignId !== undefined) joinCampaign({ campaignId: handshakeCampaignId });

    socket.on(CHANNEL.claimCharacter, (payload: unknown) => {
      const seat = seatOf.get(socket);
      if (seat === undefined) return reject(socket, 'noSeat', 'join a campaign first');

      const parsed = ClaimCharacterSchema.safeParse(payload);
      if (!parsed.success) return reject(socket, 'badRequest', 'invalid character');

      const account = accountOf.get(socket);
      if (account === undefined) return;
      if (!stillMember(socket, campaigns, seat, account)) return;

      const outcome = campaigns.claimCharacter(seat.campaignId, account, parsed.data.sheet);
      if (!outcome.ok) return reject(socket, outcome.error ?? 'rejected', outcome.message ?? 'claim rejected');
      broadcastPatches(io, seat.campaignId, outcome);
      // A one-time, high-value event per player — worth an immediate snapshot rather
      // than waiting on the periodic interval, so a restart between now and the next
      // tick can never quietly lose the character they just spent the wizard on.
      persist();
    });

    socket.on(CHANNEL.intent, (payload: unknown) => {
      const seat = seatOf.get(socket);
      if (seat === undefined) return reject(socket, 'noSeat', 'join a campaign first');

      const parsed = RoomEventSchema.safeParse(payload);
      if (!parsed.success) return reject(socket, 'badRequest', 'invalid intent');

      const account = accountOf.get(socket);
      if (account === undefined) return;
      if (!stillMember(socket, campaigns, seat, account)) return;

      const actor: Actor = { id: account, role: seat.role };
      const outcome = campaigns.apply(seat.campaignId, actor, parsed.data);
      if (!outcome.ok) return reject(socket, outcome.error ?? 'rejected', outcome.message ?? 'rejected');

      broadcastPatches(io, seat.campaignId, outcome);
      // The patch tells the whole table what changed; the effect tells the one
      // player who acted what it meant — a forced death move, Stress that became
      // HP, a payment they could not make.
      if (outcome.effect !== null && outcome.effect !== undefined) {
        socket.emit(CHANNEL.effect, outcome.effect);
      }
      if (outcome.entries.length > 0) {
        io.to(channelFor(seat.campaignId)).emit(CHANNEL.rolled, { entries: outcome.entries });
      }
      // Each private entry goes to the GM plus its own audience; a socket in more
      // than one of those rooms still receives it once.
      for (const entry of outcome.privateEntries) {
        io.to([
          gmChannelFor(seat.campaignId),
          ...entry.audience.map((id) => userChannelFor(seat.campaignId, id)),
        ]).emit(CHANNEL.privateRolled, { entries: [entry] });
      }
    });

    // Pings are relayed and forgotten: no reducer, no room state, no snapshot.
    socket.on(CHANNEL.ping, (payload: unknown) => {
      const seat = seatOf.get(socket);
      if (seat === undefined) return reject(socket, 'noSeat', 'join a campaign first');

      const parsed = PingSchema.safeParse(payload);
      if (!parsed.success) return reject(socket, 'badRequest', 'invalid ping');

      const account = accountOf.get(socket);
      if (account === undefined) return;
      if (!stillMember(socket, campaigns, seat, account)) return;

      const now = Date.now();
      const last = lastPingAt.get(socket);
      if (last !== undefined && now - last < PING_COOLDOWN_MS) return;

      // The active scene comes from the room, never the client. A player may only
      // ping the scene everyone is looking at; the GM may ping any, but a ping on a
      // scene players cannot see goes to the GM channel so its id never leaks.
      const activeSceneId = campaigns.get(seat.campaignId)?.state.map.activeSceneId ?? null;
      const onActive = parsed.data.sceneId === activeSceneId;
      if (!onActive && seat.role !== 'gm') return;

      lastPingAt.set(socket, now);
      const { sceneId, x, y } = parsed.data;
      io.to(onActive ? channelFor(seat.campaignId) : gmChannelFor(seat.campaignId)).emit(CHANNEL.pinged, {
        sceneId,
        x,
        y,
        byId: account,
      });
    });

    socket.on('disconnect', () => {
      lastPingAt.delete(socket);
      const seat = seatOf.get(socket);
      const account = accountOf.get(socket);
      if (seat === undefined || account === undefined) return;
      const patch = campaigns.setConnected(seat.campaignId, account, false);
      if (patch !== null) io.to(channelFor(seat.campaignId)).emit(CHANNEL.roomPatch, patch);
    });
  });
}
