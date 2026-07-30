import {
  CHANNEL,
  RejectedSchema,
  RolledSchema,
  RoomPatchSchema,
  RoomStateSchema,
  SessionSchema,
  applyRoomPatch,
  type RoomEvent,
  type RoomState,
  type SessionMessage,
  type SheetState,
} from '@daggerheart/protocol';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

const SESSION_KEY = 'daggerheart-vtt:session';

/** Where the server lives. Configurable so the app can point at another machine. */
export const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:4000';

export type ConnectionStatus = 'offline' | 'connecting' | 'connected' | 'error';

/** The saved session, so a reload or a dropped connection reclaims the same seat. */
interface StoredSession {
  token: string;
  code: string;
  role: 'gm' | 'player';
  sessionId: string;
}

function loadSession(storage: Storage): StoredSession | null {
  const raw = storage.getItem(SESSION_KEY);
  if (raw === null) return null;
  try {
    const parsed = SessionSchema.safeParse(JSON.parse(raw) as unknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export interface RoomConnection {
  status: ConnectionStatus;
  room: RoomState | null;
  session: StoredSession | null;
  error: string | null;
  createRoom: (gmName: string) => void;
  joinRoom: (code: string, name: string) => void;
  claimCharacter: (characterId: string, sheet: SheetState) => void;
  /** Sends an intent. The server decides the result; this never mutates locally. */
  send: (event: RoomEvent) => void;
  leave: () => void;
}

/**
 * Owns the socket connection and the room state mirror.
 *
 * The client is never authoritative: it sends intents and renders whatever the
 * server broadcasts back. Nothing here computes a rule.
 */
export function useRoom(storage: Storage): RoomConnection {
  const [status, setStatus] = useState<ConnectionStatus>('offline');
  const [room, setRoom] = useState<RoomState | null>(null);
  const [session, setSession] = useState<StoredSession | null>(() => loadSession(storage));
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  /** Opens the socket once, wiring every server message to state. */
  const ensureSocket = useCallback((): Socket => {
    const existing = socketRef.current;
    if (existing !== null) return existing;

    setStatus('connecting');
    const socket = io(SERVER_URL, { transports: ['websocket'], autoConnect: true });
    socketRef.current = socket;

    socket.on('connect', () => {
      setStatus('connected');
      setError(null);
      // Reclaim the previous seat, GM included, after a reload or a drop.
      const saved = loadSession(storage);
      if (saved !== null) socket.emit(CHANNEL.resume, { code: saved.code, token: saved.token });
    });

    socket.on('disconnect', () => setStatus('connecting'));
    socket.on('connect_error', () => {
      setStatus('error');
      setError('Cannot reach the server. You can keep playing offline.');
    });

    socket.on(CHANNEL.session, (payload: unknown) => {
      const parsed = SessionSchema.safeParse(payload);
      if (!parsed.success) return;
      storage.setItem(SESSION_KEY, JSON.stringify(parsed.data));
      setSession(parsed.data);
    });

    socket.on(CHANNEL.roomState, (payload: unknown) => {
      const parsed = RoomStateSchema.safeParse(payload);
      if (!parsed.success) {
        setError('The server sent a room this client cannot read.');
        return;
      }
      setRoom(parsed.data);
    });

    socket.on(CHANNEL.roomPatch, (payload: unknown) => {
      const parsed = RoomPatchSchema.safeParse(payload);
      if (!parsed.success) return;
      // The server's copy always wins over anything shown optimistically.
      setRoom((current) => (current === null ? current : applyRoomPatch(current, parsed.data)));
    });

    socket.on(CHANNEL.rolled, (payload: unknown) => {
      // Rolls also arrive inside the room patch; this channel is the live notification.
      RolledSchema.safeParse(payload);
    });

    socket.on(CHANNEL.rejected, (payload: unknown) => {
      const parsed = RejectedSchema.safeParse(payload);
      setError(parsed.success ? parsed.data.message : 'The server rejected that.');
    });

    return socket;
  }, [storage]);

  useEffect(() => {
    // Only connect if there is a session to resume; otherwise stay offline until asked.
    if (loadSession(storage) !== null) ensureSocket();
    return () => {
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [ensureSocket, storage]);

  const createRoom = useCallback(
    (gmName: string) => {
      ensureSocket().emit(CHANNEL.createRoom, { gmName });
    },
    [ensureSocket],
  );

  const joinRoom = useCallback(
    (code: string, name: string) => {
      ensureSocket().emit(CHANNEL.joinRoom, { code: code.toUpperCase(), name });
    },
    [ensureSocket],
  );

  const claimCharacter = useCallback(
    (characterId: string, sheet: SheetState) => {
      socketRef.current?.emit(CHANNEL.claimCharacter, { characterId, sheet });
    },
    [],
  );

  const send = useCallback((event: RoomEvent) => {
    socketRef.current?.emit(CHANNEL.intent, event);
  }, []);

  const leave = useCallback(() => {
    storage.removeItem(SESSION_KEY);
    socketRef.current?.close();
    socketRef.current = null;
    setSession(null);
    setRoom(null);
    setStatus('offline');
  }, [storage]);

  return useMemo(
    () => ({ status, room, session, error, createRoom, joinRoom, claimCharacter, send, leave }),
    [status, room, session, error, createRoom, joinRoom, claimCharacter, send, leave],
  );
}

export type { SessionMessage };
