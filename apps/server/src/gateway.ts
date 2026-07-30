import {
  CHANNEL,
  ClaimCharacterSchema,
  CreateRoomSchema,
  JoinRoomSchema,
  ResumeSchema,
  RoomEventSchema,
  type RoomPatch,
  type RoomState,
} from '@daggerheart/protocol';
import type { Server, Socket } from 'socket.io';

import { viewFor, type RoomStore } from './rooms.js';

/**
 * The transport layer. It validates every message, resolves who is asking from the
 * socket's session, and hands the intent to the store — it contains no game logic
 * of its own, and never trusts a value the client sent about itself.
 */

/** What the server remembers about a live socket. Set only by the server. */
interface SocketSession {
  code: string;
  token: string;
  role: 'gm' | 'player';
}

const sessions = new WeakMap<Socket, SocketSession>();

const reject = (socket: Socket, error: string, message: string): void => {
  socket.emit(CHANNEL.rejected, { error, message });
};

/**
 * Rooms are broadcast to two socket.io rooms per code: one for the GM and one for
 * the players. They receive different payloads, because a player must never be sent
 * unrevealed fog, inactive scenes, or GM-only tokens.
 */
const channelFor = (code: string): string => `room:${code}`;
const gmChannelFor = (code: string): string => `room:${code}:gm`;
const playerChannelFor = (code: string): string => `room:${code}:players`;

function sendFullState(socket: Socket, state: RoomState, role: 'gm' | 'player'): void {
  socket.emit(CHANNEL.roomState, viewFor(state, role));
}

/** Sends each audience the patch it is allowed to see. */
function broadcastPatches(
  io: Server,
  code: string,
  outcome: { patch: RoomPatch; playerPatch: RoomPatch },
): void {
  if (Object.keys(outcome.patch).length > 0) {
    io.to(gmChannelFor(code)).emit(CHANNEL.roomPatch, outcome.patch);
  }
  if (Object.keys(outcome.playerPatch).length > 0) {
    io.to(playerChannelFor(code)).emit(CHANNEL.roomPatch, outcome.playerPatch);
  }
}

/** Puts a socket in the room channels appropriate to its role. */
function joinChannels(socket: Socket, code: string, role: 'gm' | 'player'): void {
  void socket.join(channelFor(code));
  void socket.join(role === 'gm' ? gmChannelFor(code) : playerChannelFor(code));
}

export function registerGateway(io: Server, store: RoomStore): void {
  io.on('connection', (socket) => {
    socket.on(CHANNEL.createRoom, (payload: unknown) => {
      const parsed = CreateRoomSchema.safeParse(payload);
      if (!parsed.success) return reject(socket, 'badRequest', 'invalid createRoom');

      const { room, session } = store.createRoom(parsed.data.gmName);
      sessions.set(socket, { code: session.code, token: session.token, role: session.role });
      joinChannels(socket, session.code, session.role);

      socket.emit(CHANNEL.session, {
        token: session.token,
        sessionId: session.sessionId,
        role: session.role,
        code: session.code,
      });
      sendFullState(socket, room.state, session.role);
    });

    socket.on(CHANNEL.joinRoom, (payload: unknown) => {
      const parsed = JoinRoomSchema.safeParse(payload);
      if (!parsed.success) return reject(socket, 'badRequest', 'invalid joinRoom');

      const joined = store.joinRoom(parsed.data.code, parsed.data.name);
      if (joined === null) return reject(socket, 'unknownRoom', 'no room with that code');

      const { room, session } = joined;
      sessions.set(socket, { code: session.code, token: session.token, role: session.role });
      joinChannels(socket, session.code, session.role);

      socket.emit(CHANNEL.session, {
        token: session.token,
        sessionId: session.sessionId,
        role: session.role,
        code: session.code,
      });
      // The joiner gets the view for their role; the rest of the table just gets the
      // new seat.
      sendFullState(socket, room.state, session.role);
      socket.to(channelFor(session.code)).emit(CHANNEL.roomPatch, { players: room.state.players });
    });

    socket.on(CHANNEL.resume, (payload: unknown) => {
      const parsed = ResumeSchema.safeParse(payload);
      if (!parsed.success) return reject(socket, 'badRequest', 'invalid resume');

      const resumed = store.resume(parsed.data.code, parsed.data.token);
      if (resumed === null) return reject(socket, 'unknownSession', 'that session has expired');

      const { room, session } = resumed;
      sessions.set(socket, { code: session.code, token: session.token, role: session.role });
      joinChannels(socket, session.code, session.role);

      socket.emit(CHANNEL.session, {
        token: session.token,
        sessionId: session.sessionId,
        role: session.role,
        code: session.code,
      });
      // A reconnecting client is handed its whole current view, not a diff.
      sendFullState(socket, room.state, session.role);
      socket
        .to(channelFor(session.code))
        .emit(CHANNEL.roomPatch, { players: room.state.players, gm: room.state.gm });
    });

    socket.on(CHANNEL.claimCharacter, (payload: unknown) => {
      const session = sessions.get(socket);
      if (!session) return reject(socket, 'noSession', 'join a room first');

      const parsed = ClaimCharacterSchema.safeParse(payload);
      if (!parsed.success) return reject(socket, 'badRequest', 'invalid character');

      const outcome = store.claimCharacter(
        session.code,
        session.token,
        parsed.data.characterId,
        parsed.data.sheet,
      );
      if (!outcome.ok) {
        return reject(socket, outcome.error ?? 'rejected', outcome.message ?? 'claim rejected');
      }
      broadcastPatches(io, session.code, outcome);
    });

    socket.on(CHANNEL.intent, (payload: unknown) => {
      const session = sessions.get(socket);
      if (!session) return reject(socket, 'noSession', 'join a room first');

      const parsed = RoomEventSchema.safeParse(payload);
      if (!parsed.success) return reject(socket, 'badRequest', 'invalid intent');

      const outcome = store.apply(session.code, session.token, parsed.data);
      if (!outcome.ok) {
        return reject(socket, outcome.error ?? 'rejected', outcome.message ?? 'rejected');
      }

      // Everyone, including the sender, gets the authoritative result — filtered to
      // what their role may see.
      broadcastPatches(io, session.code, outcome);
      if (outcome.entries.length > 0) {
        io.to(channelFor(session.code)).emit(CHANNEL.rolled, { entries: outcome.entries });
      }
    });

    socket.on('disconnect', () => {
      const session = sessions.get(socket);
      if (!session) return;
      const patch = store.setConnected(session.code, session.token, false);
      if (patch !== null) io.to(channelFor(session.code)).emit(CHANNEL.roomPatch, patch);
    });
  });
}
