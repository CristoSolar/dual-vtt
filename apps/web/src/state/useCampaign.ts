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
import { describeRejection, t } from '../i18n/index.js';
import { describeRollEntry } from './rollLog.js';
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
   * `CampaignSummary` (from the HTTP list) compared against this account's own id —
   * no separate state to drift, and known before the socket even connects.
   */
  role: 'gm' | 'player' | null;
  activeCampaignId: string | null;
  error: string | null;
  /** The most recent roll broadcast to the room, for a live "so-and-so rolled" toast. */
  lastRoll: { id: string; message: string } | null;
  dismissLastRoll: () => void;
  /** True while `createCampaign`/`addPlayer` is in flight — disable the form on
   * this, not just field validation, or a double-click fires the request twice. */
  pending: boolean;
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
  /** Clears a shown error — a rejection otherwise sticks until the next 'connect'. */
  dismissError: () => void;
}

/**
 * Owns the campaign list (HTTP), the live socket connection, and the joined
 * campaign's room state mirror. The client is never authoritative for room state:
 * it sends intents and renders whatever the server broadcasts back.
 */
export function useCampaign(
  storage: Storage,
  token: string | null,
  accountId: string | null,
): CampaignConnection {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(() => loadActiveCampaignId(storage));
  const [error, setError] = useState<string | null>(null);
  const [lastRoll, setLastRoll] = useState<{ id: string; message: string } | null>(null);
  const [pending, setPending] = useState(false);
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
      setError(t('campaign.connectFailed'));
    });

    socket.on(CHANNEL.roomState, (payload: unknown) => {
      const parsed = RoomStateSchema.safeParse(payload);
      if (!parsed.success) {
        setError(t('campaign.unreadableState'));
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
      const parsed = RolledSchema.safeParse(payload);
      if (!parsed.success || parsed.data.entries.length === 0) return;
      setLastRoll({
        id: parsed.data.entries.map((entry) => entry.id).join('-'),
        message: parsed.data.entries.map(describeRollEntry).join(' · '),
      });
    });

    socket.on(CHANNEL.rejected, (payload: unknown) => {
      const parsed = RejectedSchema.safeParse(payload);
      setError(parsed.success ? describeRejection(parsed.data.error) : t('reject.rejected'));
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
      setPending(true);
      try {
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
      } finally {
        setPending(false);
      }
    },
    [token, refreshCampaigns],
  );

  const addPlayer = useCallback(
    async (campaignId: string, username: string): Promise<boolean> => {
      if (token === null) return false;
      setPending(true);
      try {
        const response = await fetch(`${SERVER_URL}/campaigns/${campaignId}/players`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({ username }),
        });
        if (response.ok) await refreshCampaigns();
        return response.ok;
      } finally {
        setPending(false);
      }
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

  const dismissError = useCallback(() => setError(null), []);
  const dismissLastRoll = useCallback(() => setLastRoll(null), []);

  const role = useMemo<'gm' | 'player' | null>(() => {
    if (activeCampaignId === null || accountId === null) return null;
    const summary = campaigns.find((c) => c.id === activeCampaignId);
    if (summary === undefined) return null;
    return summary.ownerId === accountId ? 'gm' : 'player';
  }, [activeCampaignId, accountId, campaigns]);

  return useMemo(
    () => ({
      status,
      campaigns,
      room,
      role,
      activeCampaignId,
      error,
      lastRoll,
      dismissLastRoll,
      pending,
      refreshCampaigns,
      createCampaign,
      addPlayer,
      removePlayer,
      join,
      claimCharacter,
      send,
      leave,
      dismissError,
    }),
    [
      status,
      campaigns,
      room,
      role,
      activeCampaignId,
      error,
      lastRoll,
      dismissLastRoll,
      pending,
      refreshCampaigns,
      createCampaign,
      addPlayer,
      removePlayer,
      join,
      claimCharacter,
      send,
      leave,
      dismissError,
    ],
  );
}
