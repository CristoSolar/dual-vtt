import { randomBytes, randomInt } from 'node:crypto';

import {
  applyRoomEvent,
  createRoomState,
  roomForRole,
  roomPatch,
  type Actor,
  type GameMaster,
  type RoomEvent,
  type RoomPatch,
  type RoomState,
  type RollEntry,
  type SheetState,
} from '@daggerheart/protocol';
import { seededRng, type Rng } from '@daggerheart/rules';

/**
 * A campaign wraps a `RoomState` (the existing reducer/broadcast engine) with
 * account-based ownership. Where the old `RoomStore` gated entry with a shared
 * 6-character code and an ephemeral seat token, a campaign gates entry with account
 * membership — `ownerId` is always seated as GM, `memberIds` as players.
 */
export interface CampaignRecord {
  id: string;
  name: string;
  ownerId: string;
  memberIds: string[];
  state: RoomState;
  /** Seeds every roll in this campaign, so results are reproducible and auditable. */
  seed: number;
  rollCount: number;
  updatedAt: number;
}

export interface ApplyOutcome {
  ok: boolean;
  patch: RoomPatch;
  playerPatch: RoomPatch;
  entries: readonly RollEntry[];
  error?: string;
  message?: string;
}

function patchesFor(before: RoomState, after: RoomState): Pick<ApplyOutcome, 'patch' | 'playerPatch'> {
  return {
    patch: roomPatch(before, after),
    playerPatch: roomPatch(roomForRole(before, 'player'), roomForRole(after, 'player')),
  };
}

const fail = (error: string, message: string): ApplyOutcome => ({
  ok: false,
  patch: {},
  playerPatch: {},
  entries: [],
  error,
  message,
});

export function rngForRoll(seed: number, index: number): Rng {
  return seededRng(seed + index);
}

/** In-memory campaign storage: the single source of truth for the whole table. */
export class CampaignStore {
  private readonly campaigns = new Map<string, CampaignRecord>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  get size(): number {
    return this.campaigns.size;
  }

  get(campaignId: string): CampaignRecord | null {
    return this.campaigns.get(campaignId) ?? null;
  }

  /** Every campaign this account owns or belongs to. */
  listFor(accountId: string): CampaignRecord[] {
    return [...this.campaigns.values()].filter(
      (c) => c.ownerId === accountId || c.memberIds.includes(accountId),
    );
  }

  roleOf(campaignId: string, accountId: string): 'gm' | 'player' | null {
    const campaign = this.campaigns.get(campaignId);
    if (campaign === null || campaign === undefined) return null;
    if (campaign.ownerId === accountId) return 'gm';
    if (campaign.memberIds.includes(accountId)) return 'player';
    return null;
  }

  createCampaign(ownerId: string, ownerUsername: string, name: string, seed = randomInt(2 ** 31)): CampaignRecord {
    const id = `c-${randomBytes(8).toString('hex')}`;
    const gm: GameMaster = { id: ownerId, name: ownerUsername, connected: false };
    const campaign: CampaignRecord = {
      id,
      name,
      ownerId,
      memberIds: [],
      state: createRoomState(id, gm),
      seed,
      rollCount: 0,
      updatedAt: this.now(),
    };
    this.campaigns.set(id, campaign);
    return campaign;
  }

  /** Only the owner may add a member. Returns false if not the owner or unknown campaign. */
  addMember(campaignId: string, requesterId: string, memberId: string): boolean {
    const campaign = this.campaigns.get(campaignId);
    if (campaign === undefined || campaign.ownerId !== requesterId) return false;
    if (!campaign.memberIds.includes(memberId)) campaign.memberIds.push(memberId);
    campaign.updatedAt = this.now();
    return true;
  }

  /**
   * Removing a member also strips them from the live room: leaving their roster entry
   * and character behind would keep them visible (and, once re-added, stale) even
   * though they are no longer allowed in.
   */
  removeMember(campaignId: string, requesterId: string, memberId: string): boolean {
    const campaign = this.campaigns.get(campaignId);
    if (campaign === undefined || campaign.ownerId !== requesterId) return false;
    campaign.memberIds = campaign.memberIds.filter((id) => id !== memberId);

    campaign.state = {
      ...campaign.state,
      players: campaign.state.players.filter((p) => p.id !== memberId),
      characters: Object.fromEntries(
        Object.entries(campaign.state.characters).filter(([id]) => id !== memberId),
      ),
    };
    campaign.updatedAt = this.now();
    return true;
  }

  /**
   * Seats an account live in its campaign's room, adding it to the roster the first
   * time it is seen. Returns its role, or null if it is not a member.
   */
  seatFor(campaignId: string, accountId: string, username: string): { role: 'gm' | 'player' } | null {
    const campaign = this.campaigns.get(campaignId);
    if (campaign === null || campaign === undefined) return null;
    const role = this.roleOf(campaignId, accountId);
    if (role === null) return null;

    if (role === 'gm') {
      campaign.state = { ...campaign.state, gm: { ...campaign.state.gm, connected: true } };
    } else {
      const already = campaign.state.players.some((p) => p.id === accountId);
      campaign.state = {
        ...campaign.state,
        players: already
          ? campaign.state.players.map((p) => (p.id === accountId ? { ...p, connected: true } : p))
          : [...campaign.state.players, { id: accountId, name: username, connected: true, characterId: null }],
      };
    }
    campaign.updatedAt = this.now();
    return { role };
  }

  setConnected(campaignId: string, accountId: string, connected: boolean): RoomPatch | null {
    const campaign = this.campaigns.get(campaignId);
    if (campaign === undefined) return null;
    const before = campaign.state;

    if (before.gm.id === accountId) {
      if (before.gm.connected === connected) return null;
      campaign.state = { ...before, gm: { ...before.gm, connected } };
    } else {
      const player = before.players.find((p) => p.id === accountId);
      if (player === undefined || player.connected === connected) return null;
      campaign.state = {
        ...before,
        players: before.players.map((p) => (p.id === accountId ? { ...p, connected } : p)),
      };
    }
    campaign.updatedAt = this.now();
    return roomPatch(before, campaign.state);
  }

  /** A player claims their one character for this campaign, keyed by their own account id. */
  claimCharacter(campaignId: string, accountId: string, sheet: SheetState): ApplyOutcome {
    const campaign = this.campaigns.get(campaignId);
    if (campaign === undefined) return fail('unknownCampaign', 'no such campaign');

    const before = campaign.state;
    campaign.state = {
      ...before,
      characters: { ...before.characters, [accountId]: sheet },
      players: before.players.map((p) => (p.id === accountId ? { ...p, characterId: accountId } : p)),
    };
    campaign.updatedAt = this.now();
    return { ok: true, ...patchesFor(before, campaign.state), entries: [] };
  }

  /** Applies one validated intent. The actor's role must already be known (via `seatFor`). */
  apply(campaignId: string, actor: Actor, event: RoomEvent): ApplyOutcome {
    const campaign = this.campaigns.get(campaignId);
    if (campaign === undefined) return fail('unknownCampaign', 'no such campaign');

    const rollsThisEvent = event.type === 'rollDuality' || event.type === 'rollDamage' ? 1 : 0;
    const rng = rngForRoll(campaign.seed, campaign.rollCount);

    const before = campaign.state;
    const result = applyRoomEvent(before, actor, event, rng, this.now());
    if (!result.ok) return fail(result.error, result.message);

    campaign.state = result.state;
    campaign.rollCount += rollsThisEvent;
    campaign.updatedAt = this.now();
    return { ok: true, ...patchesFor(before, result.state), entries: result.entries };
  }

  restore(records: readonly SerializedCampaign[]): void {
    for (const record of records) {
      this.campaigns.set(record.id, {
        id: record.id,
        name: record.name,
        ownerId: record.ownerId,
        memberIds: [...record.memberIds],
        state: record.state,
        seed: record.seed,
        rollCount: record.rollCount,
        updatedAt: record.updatedAt,
      });
    }
  }

  serialize(): SerializedCampaign[] {
    return [...this.campaigns.values()].map((c) => ({
      id: c.id,
      name: c.name,
      ownerId: c.ownerId,
      memberIds: c.memberIds,
      state: c.state,
      seed: c.seed,
      rollCount: c.rollCount,
      updatedAt: c.updatedAt,
    }));
  }
}

export interface SerializedCampaign {
  id: string;
  name: string;
  ownerId: string;
  memberIds: string[];
  state: RoomState;
  seed: number;
  rollCount: number;
  updatedAt: number;
}
