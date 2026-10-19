import {
  CampaignSummarySchema,
  CHANNEL,
  EffectMessageSchema,
  PingedSchema,
  PrivateRolledSchema,
  RejectedSchema,
  RolledSchema,
  RoomPatchSchema,
  RoomStateSchema,
  applyRoomPatch,
  type CampaignSummary,
  type EffectMessage,
  type PingedMessage,
  type RoomEvent,
  type RoomState,
  type SheetState,
} from '@daggerheart/protocol';
import { describeRejection, t } from '../i18n/index.js';
import { isAuthRejection } from './auth.js';
import { hasDice, joinBurst, type DiceRoll } from './diceNotation.js';
import { appendPrivate } from './feed.js';
import { describeRollEntry } from './rollLog.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

const ACTIVE_CAMPAIGN_KEY = 'daggerheart-vtt:active-campaign';

/** Where the server lives. Configurable so the app can point at another machine. */
export const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:4000';

/** How long a ping stays on the map, animation included. */
export const PING_DURATION_MS = 2000;

/** A ping currently on the map. The id tells two pings at the same spot apart. */
export type ActivePing = PingedMessage & { id: number };

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
  /**
   * The entries of the most recent roll, for the dice overlay. Kept apart from
   * `lastRoll` so dismissing the toast does not snatch the dice off the table.
   */
  lastDice: DiceRoll | null;
  /**
   * The effect of this account's most recent accepted intent — what the sheet
   * would have reported offline. Carries an id so a repeat of the same effect
   * still counts as a new one.
   */
  lastEffect: { id: number; effect: EffectMessage } | null;
  dismissLastEffect: () => void;
  /** Pings received in the last `PING_DURATION_MS`. Never part of the room. */
  pings: readonly ActivePing[];
  /** Pings a point on a scene. The server stamps who sent it and may drop it. */
  ping: (sceneId: string, x: number, y: number) => void;
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
  /** Called when the server refuses the token, over HTTP or the socket. */
  onSessionExpired: () => void,
): CampaignConnection {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(() => loadActiveCampaignId(storage));
  const [error, setError] = useState<string | null>(null);
  const [lastRoll, setLastRoll] = useState<{ id: string; message: string } | null>(null);
  const [lastDice, setLastDice] = useState<DiceRoll | null>(null);
  const [lastEffect, setLastEffect] = useState<{ id: number; effect: EffectMessage } | null>(null);
  const effectCount = useRef(0);
  const [pings, setPings] = useState<ActivePing[]>([]);
  const pingCount = useRef(0);
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
    if (response.status === 401) return onSessionExpired();
    if (!response.ok) return;
    const body = (await response.json()) as unknown;
    if (!Array.isArray(body)) return;
    const parsed = body.map((c) => CampaignSummarySchema.safeParse(c)).filter((r) => r.success);
    setCampaigns(parsed.map((r) => r.data));
  }, [token, onSessionExpired]);

  useEffect(() => {
    void refreshCampaigns();
  }, [refreshCampaigns]);

  const ensureSocket = useCallback((): Socket | null => {
    if (token === null) return null;
    const existing = socketRef.current;
    if (existing !== null) return existing;

    setStatus('connecting');
    // The campaign rides in the handshake, read afresh on every (re)connect, so the
    // server seats the socket before anything else arrives. Re-joining from the
    // 'connect' handler instead lost the race on a reconnect: socket.io flushes
    // whatever was emitted while offline — a finished wizard's claim — before
    // 'connect' listeners run, and the server rejected it with 'noSeat'.
    const socket = io(SERVER_URL, {
      transports: ['websocket'],
      autoConnect: true,
      auth: (cb) => {
        const campaignId = loadActiveCampaignId(storage);
        cb(campaignId === null ? { token } : { token, campaignId });
      },
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setStatus('connected');
      setError(null);
    });

    socket.on('disconnect', () => setStatus('connecting'));
    // socket.io gives up for good after a middleware rejection, so a dead token
    // would sit on the offline banner forever; send the player to log in instead.
    socket.on('connect_error', (err) => {
      if (isAuthRejection(err)) return onSessionExpired();
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
      setRoom((current) => {
        if (current !== null) return applyRoomPatch(current, parsed.data);
        // A patch with nothing to apply it to means this client missed the full
        // state. Ask for it again rather than silently dropping the change.
        const saved = loadActiveCampaignId(storage);
        if (saved !== null) socket.emit(CHANNEL.joinCampaign, { campaignId: saved });
        return current;
      });
    });

    socket.on(CHANNEL.effect, (payload: unknown) => {
      const parsed = EffectMessageSchema.safeParse(payload);
      if (!parsed.success) return;
      effectCount.current += 1;
      setLastEffect({ id: effectCount.current, effect: parsed.data });
    });

    socket.on(CHANNEL.rolled, (payload: unknown) => {
      const parsed = RolledSchema.safeParse(payload);
      if (!parsed.success || parsed.data.entries.length === 0) return;
      const id = parsed.data.entries.map((entry) => entry.id).join('-');
      setLastRoll({ id, message: parsed.data.entries.map(describeRollEntry).join(' · ') });
      const { entries } = parsed.data;
      if (hasDice(entries)) setLastDice((previous) => joinBurst(previous, { id, entries }));
    });

    // Whispers and private rolls reach only the GM and their audience, and no patch
    // carries the private log, so each one is folded into the room here.
    socket.on(CHANNEL.privateRolled, (payload: unknown) => {
      const parsed = PrivateRolledSchema.safeParse(payload);
      if (!parsed.success || parsed.data.entries.length === 0) return;
      const { entries } = parsed.data;
      setRoom((current) => (current === null ? current : appendPrivate(current, entries)));
      const id = entries.map((p) => p.entry.id).join('-');
      setLastRoll({ id, message: entries.map((p) => describeRollEntry(p.entry)).join(' · ') });
      const rolled = entries.map((p) => p.entry);
      if (hasDice(rolled)) setLastDice((previous) => joinBurst(previous, { id, entries: rolled }));
    });

    // A ping lives only here, for as long as it is drawn.
    socket.on(CHANNEL.pinged, (payload: unknown) => {
      const parsed = PingedSchema.safeParse(payload);
      if (!parsed.success) return;
      pingCount.current += 1;
      const id = pingCount.current;
      setPings((current) => [...current, { ...parsed.data, id }]);
      window.setTimeout(() => setPings((current) => current.filter((p) => p.id !== id)), PING_DURATION_MS);
    });

    socket.on(CHANNEL.rejected, (payload: unknown) => {
      const parsed = RejectedSchema.safeParse(payload);
      setError(parsed.success ? describeRejection(parsed.data.error) : t('reject.rejected'));
    });

    return socket;
  }, [token, storage, onSessionExpired]);

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
        if (response.status === 401) {
          onSessionExpired();
          return null;
        }
        if (!response.ok) {
          setError(t('campaign.createFailed'));
          return null;
        }
        const parsed = CampaignSummarySchema.safeParse(await response.json());
        if (!parsed.success) return null;
        await refreshCampaigns();
        return parsed.data;
      } finally {
        setPending(false);
      }
    },
    [token, refreshCampaigns, onSessionExpired],
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
        if (response.ok) {
          await refreshCampaigns();
        } else if (response.status === 401) {
          onSessionExpired();
        } else {
          // A 404 here is the ordinary case: the GM typed a username that has no
          // account. Saying nothing made it look like the player had been added.
          setError(response.status === 404 ? t('campaign.noSuchPlayer') : t('campaign.addPlayerFailed'));
        }
        return response.ok;
      } finally {
        setPending(false);
      }
    },
    [token, refreshCampaigns, onSessionExpired],
  );

  const removePlayer = useCallback(
    async (campaignId: string, userId: string): Promise<boolean> => {
      if (token === null) return false;
      const response = await fetch(`${SERVER_URL}/campaigns/${campaignId}/players/${userId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      });
      if (response.ok) await refreshCampaigns();
      if (response.status === 401) onSessionExpired();
      return response.ok;
    },
    [token, refreshCampaigns, onSessionExpired],
  );

  const join = useCallback(
    (campaignId: string) => {
      storage.setItem(ACTIVE_CAMPAIGN_KEY, campaignId);
      setActiveCampaignId(campaignId);
      const socket = ensureSocket();
      // A socket that is still connecting will join from its handshake, which
      // reads the id just stored; emitting here too would join twice.
      if (socket?.connected === true) socket.emit(CHANNEL.joinCampaign, { campaignId });
    },
    [storage, ensureSocket],
  );

  const claimCharacter = useCallback((sheet: SheetState) => {
    socketRef.current?.emit(CHANNEL.claimCharacter, { sheet });
  }, []);

  const send = useCallback((event: RoomEvent) => {
    socketRef.current?.emit(CHANNEL.intent, event);
  }, []);

  const ping = useCallback((sceneId: string, x: number, y: number) => {
    socketRef.current?.emit(CHANNEL.ping, { sceneId, x, y });
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
  const dismissLastEffect = useCallback(() => setLastEffect(null), []);

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
      lastDice,
      lastEffect,
      dismissLastEffect,
      pings,
      ping,
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
      lastDice,
      lastEffect,
      dismissLastEffect,
      pings,
      ping,
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
