import {
  CampaignSummarySchema,
  CHANNEL,
  RejectedSchema,
  RolledSchema,
  RoomPatchSchema,
  RoomStateSchema,
  applyRoomPatch,
  type CampaignSummary,
  type RoomEvent,
  type RoomState,
  type SheetState,
} from '@daggerheart/protocol';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

const ACTIVE_CAMPAIGN_KEY = 'daggerheart-vtt:active-campaign';

/** Where the server lives. Configurable so the app can point at another machine. */
export const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:4000';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error';

function loadActiveCampaignId(storage: Storage): string | null {
  return storage.getItem(ACTIVE_CAMPAIGN_KEY);
}

export interface CampaignConnection {
  status: ConnectionStatus;
  /** Every campaign this account owns or belongs to, from `GET /campaigns`. */
  campaigns: readonly CampaignSummary[];
  /** The live room state for the campaign currently joined, or null if none. */
  room: RoomState | null;
  /**
   * Derived, not stored: the owner id already present in the matching
   * `CampaignSummary` (from the HTTP list) compared against the connected room's
   * `gm.id` (the account id the server seated as GM) — no separate state to drift.
   */
  role: 'gm' | 'player' | null;
  activeCampaignId: string | null;
  error: string | null;
  refreshCampaigns: () => Promise<void>;
  createCampaign: (name: string) => Promise<CampaignSummary | null>;
  addPlayer: (campaignId: string, username: string) => Promise<boolean>;
  removePlayer: (campaignId: string, userId: string) => Promise<boolean>;
  /** Joins a campaign's live room over the socket. */
  join: (campaignId: string) => void;
  claimCharacter: (sheet: SheetState) => void;
  /** Sends an intent. The server decides the result; this never mutates locally. */
  send: (event: RoomEvent) => void;
  leave: () => void;
}

/**
 * Owns the campaign list (HTTP), the live socket connection, and the joined
 * campaign's room state mirror. The client is never authoritative for room state:
 * it sends intents and renders whatever the server broadcasts back.
 */
export function useCampaign(storage: Storage, token: string | null): CampaignConnection {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(() => loadActiveCampaignId(storage));
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const refreshCampaigns = useCallback(async () => {
    if (token === null) {
      setCampaigns([]);
      return;
    }
    const response = await fetch(`${SERVER_URL}/campaigns`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) return;
    const body = (await response.json()) as unknown;
    if (!Array.isArray(body)) return;
    const parsed = body.map((c) => CampaignSummarySchema.safeParse(c)).filter((r) => r.success);
    setCampaigns(parsed.map((r) => r.data));
  }, [token]);

  useEffect(() => {
    void refreshCampaigns();
  }, [refreshCampaigns]);

  const ensureSocket = useCallback((): Socket | null => {
    if (token === null) return null;
    const existing = socketRef.current;
    if (existing !== null) return existing;

    setStatus('connecting');
    const socket = io(SERVER_URL, { transports: ['websocket'], autoConnect: true, auth: { token } });
    socketRef.current = socket;

    socket.on('connect', () => {
      setStatus('connected');
      setError(null);
      const saved = loadActiveCampaignId(storage);
      if (saved !== null) socket.emit(CHANNEL.joinCampaign, { campaignId: saved });
    });

    socket.on('disconnect', () => setStatus('connecting'));
    socket.on('connect_error', () => {
      setStatus('error');
      setError('No se pudo conectar con el servidor.');
    });

    socket.on(CHANNEL.roomState, (payload: unknown) => {
      const parsed = RoomStateSchema.safeParse(payload);
      if (!parsed.success) {
        setError('El servidor envió un estado que este cliente no puede leer.');
        return;
      }
      setRoom(parsed.data);
    });

    socket.on(CHANNEL.roomPatch, (payload: unknown) => {
      const parsed = RoomPatchSchema.safeParse(payload);
      if (!parsed.success) return;
      setRoom((current) => (current === null ? current : applyRoomPatch(current, parsed.data)));
    });

    socket.on(CHANNEL.rolled, (payload: unknown) => {
      RolledSchema.safeParse(payload);
    });

    socket.on(CHANNEL.rejected, (payload: unknown) => {
      const parsed = RejectedSchema.safeParse(payload);
      setError(parsed.success ? parsed.data.message : 'El servidor rechazó esa acción.');
    });

    return socket;
  }, [token, storage]);

  useEffect(() => {
    if (token !== null && loadActiveCampaignId(storage) !== null) ensureSocket();
    return () => {
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [token, storage, ensureSocket]);

  const createCampaign = useCallback(
    async (name: string): Promise<CampaignSummary | null> => {
      if (token === null) return null;
      const response = await fetch(`${SERVER_URL}/campaigns`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) return null;
      const parsed = CampaignSummarySchema.safeParse(await response.json());
      if (!parsed.success) return null;
      await refreshCampaigns();
      return parsed.data;
    },
    [token, refreshCampaigns],
  );

  const addPlayer = useCallback(
    async (campaignId: string, username: string): Promise<boolean> => {
      if (token === null) return false;
      const response = await fetch(`${SERVER_URL}/campaigns/${campaignId}/players`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ username }),
      });
      if (response.ok) await refreshCampaigns();
      return response.ok;
    },
    [token, refreshCampaigns],
  );

  const removePlayer = useCallback(
    async (campaignId: string, userId: string): Promise<boolean> => {
      if (token === null) return false;
      const response = await fetch(`${SERVER_URL}/campaigns/${campaignId}/players/${userId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      });
      if (response.ok) await refreshCampaigns();
      return response.ok;
    },
    [token, refreshCampaigns],
  );

  const join = useCallback(
    (campaignId: string) => {
      storage.setItem(ACTIVE_CAMPAIGN_KEY, campaignId);
      setActiveCampaignId(campaignId);
      ensureSocket()?.emit(CHANNEL.joinCampaign, { campaignId });
    },
    [storage, ensureSocket],
  );

  const claimCharacter = useCallback((sheet: SheetState) => {
    socketRef.current?.emit(CHANNEL.claimCharacter, { sheet });
  }, []);

  const send = useCallback((event: RoomEvent) => {
    socketRef.current?.emit(CHANNEL.intent, event);
  }, []);

  const leave = useCallback(() => {
    storage.removeItem(ACTIVE_CAMPAIGN_KEY);
    setActiveCampaignId(null);
    socketRef.current?.close();
    socketRef.current = null;
    setRoom(null);
    setStatus('idle');
  }, [storage]);

  const role = useMemo<'gm' | 'player' | null>(() => {
    if (activeCampaignId === null) return null;
    const summary = campaigns.find((c) => c.id === activeCampaignId);
    if (summary === undefined) return null;
    return room?.gm.id === summary.ownerId ? 'gm' : 'player';
  }, [activeCampaignId, campaigns, room]);

  return useMemo(
    () => ({
      status,
      campaigns,
      room,
      role,
      activeCampaignId,
      error,
      refreshCampaigns,
      createCampaign,
      addPlayer,
      removePlayer,
      join,
      claimCharacter,
      send,
      leave,
    }),
    [
      status,
      campaigns,
      room,
      role,
      activeCampaignId,
      error,
      refreshCampaigns,
      createCampaign,
      addPlayer,
      removePlayer,
      join,
      claimCharacter,
      send,
      leave,
    ],
  );
}
