import { randomBytes, randomInt } from 'node:crypto';

import {
  applyRoomEvent,
  claimCharacterInRoom,
  createRoomState,
  releaseCharacterInRoom,
  roomForRole,
  roomPatch,
  type Actor,
  type GameMaster,
  type PrivateEntry,
  type RoomEvent,
  type RoomPatch,
  type RoomState,
  type RollEntry,
  type SheetState,
  type SheetEffect,
} from '@daggerheart/protocol';
import { seededRng, type Rng } from '@daggerheart/rules';

/**
 * A campaign wraps a `RoomState` (the existing reducer/broadcast engine) with
 * account-based ownership. Where the old `RoomStore` gated entry with a shared
 * 6-character code and an ephemeral seat token, a campaign gates entry with account
 * membership — `ownerId` is always seated as GM, `memberIds` as players.
 * `invitedIds` are accounts the GM invited that have not answered yet; they are
 * not members, and nothing lets them in until they accept.
 */
export interface CampaignRecord {
  id: string;
  name: string;
  ownerId: string;
  memberIds: string[];
  invitedIds: string[];
  /**
   * Every account that has ever had a character in this room. Joining it is what
   * brings the GM a Fear; swapping characters later does not.
   */
  partyIds: string[];
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
  /** Private rolls and whispers, each delivered only to its audience and the GM. */
  privateEntries: readonly PrivateEntry[];
  /** What to tell the acting client beyond the new state. Null when there is nothing. */
  effect?: SheetEffect | null;
  error?: string;
  message?: string;
}

export function patchesFor(before: RoomState, after: RoomState): Pick<ApplyOutcome, 'patch' | 'playerPatch'> {
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
  privateEntries: [],
  error,
  message,
});

/**
 * The dice for roll `index` of a campaign. Seed and index are hashed together first:
 * xorshift seeded with neighbouring numbers (`seed + index`) gives nearly the same
 * opening values, so consecutive rolls kept landing on the same faces.
 */
export function rngForRoll(seed: number, index: number): Rng {
  let h = (seed ^ Math.imul(index + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return seededRng((h ^ (h >>> 16)) >>> 0);
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

  all(): CampaignRecord[] {
    return [...this.campaigns.values()];
  }

  /** Every campaign this account owns or belongs to. */
  listFor(accountId: string): CampaignRecord[] {
    return [...this.campaigns.values()].filter(
      (c) => c.ownerId === accountId || c.memberIds.includes(accountId),
    );
  }

  /** Every campaign that has invited this account and is waiting on its answer. */
  listInvitedFor(accountId: string): CampaignRecord[] {
    return [...this.campaigns.values()].filter((c) => c.invitedIds.includes(accountId));
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
      invitedIds: [],
      partyIds: [],
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

  /** Only the owner invites; the owner and current members cannot be invited. */
  invite(campaignId: string, requesterId: string, accountId: string): 'ok' | 'forbidden' | 'alreadyMember' {
    const campaign = this.campaigns.get(campaignId);
    if (campaign === undefined || campaign.ownerId !== requesterId) return 'forbidden';
    if (this.roleOf(campaignId, accountId) !== null) return 'alreadyMember';
    if (!campaign.invitedIds.includes(accountId)) campaign.invitedIds.push(accountId);
    campaign.updatedAt = this.now();
    return 'ok';
  }

  /** The owner withdraws an invitation. False if not the owner or nothing was pending. */
  cancelInvite(campaignId: string, requesterId: string, accountId: string): boolean {
    const campaign = this.campaigns.get(campaignId);
    if (campaign === undefined || campaign.ownerId !== requesterId) return false;
    return this.dropInvite(campaign, accountId);
  }

  /** The invited account joins as a player. False if it had no pending invitation. */
  acceptInvite(campaignId: string, accountId: string): boolean {
    const campaign = this.campaigns.get(campaignId);
    if (campaign === undefined || !this.dropInvite(campaign, accountId)) return false;
    if (!campaign.memberIds.includes(accountId)) campaign.memberIds.push(accountId);
    return true;
  }

  /** The invited account says no; the invitation is gone. */
  declineInvite(campaignId: string, accountId: string): boolean {
    const campaign = this.campaigns.get(campaignId);
    return campaign !== undefined && this.dropInvite(campaign, accountId);
  }

  private dropInvite(campaign: CampaignRecord, accountId: string): boolean {
    if (!campaign.invitedIds.includes(accountId)) return false;
    campaign.invitedIds = campaign.invitedIds.filter((id) => id !== accountId);
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
          : [
              ...campaign.state.players,
              {
                id: accountId,
                name: username,
                connected: true,
                // A character linked from the library before this account ever sat
                // down is already in the room; the seat must control it.
                characterId: campaign.state.characters[accountId] === undefined ? null : accountId,
              },
            ],
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
    // The reducer lives in `protocol` with every other room rule, including the
    // Fear a new PC brings to the GM's pool.
    const isNewToTheParty = !campaign.partyIds.includes(accountId);
    campaign.state = claimCharacterInRoom(before, accountId, sheet, isNewToTheParty);
    if (isNewToTheParty) campaign.partyIds.push(accountId);
    campaign.updatedAt = this.now();
    return { ok: true, ...patchesFor(before, campaign.state), entries: [], privateEntries: [] };
  }

  /**
   * Takes this account's character out of the room and returns the sheet as it
   * stood there — the live copy, for the library to keep.
   */
  releaseCharacter(
    campaignId: string,
    accountId: string,
  ): { sheet: SheetState | null; patch: RoomPatch; playerPatch: RoomPatch } {
    const campaign = this.campaigns.get(campaignId);
    const sheet = campaign?.state.characters[accountId];
    if (campaign === undefined || sheet === undefined) return { sheet: null, patch: {}, playerPatch: {} };
    const before = campaign.state;
    campaign.state = releaseCharacterInRoom(before, accountId);
    campaign.updatedAt = this.now();
    return { sheet, ...patchesFor(before, campaign.state) };
  }

  /** Applies one validated intent. The actor's role must already be known (via `seatFor`). */
  apply(campaignId: string, actor: Actor, event: RoomEvent): ApplyOutcome {
    const campaign = this.campaigns.get(campaignId);
    if (campaign === undefined) return fail('unknownCampaign', 'no such campaign');

    const baseRng = rngForRoll(campaign.seed, campaign.rollCount);
    let rngWasCalled = false;
    const rng: Rng = () => {
      rngWasCalled = true;
      return baseRng();
    };

    const before = campaign.state;
    const result = applyRoomEvent(before, actor, event, rng, this.now());
    if (!result.ok) return fail(result.error, result.message);

    campaign.state = result.state;
    if (rngWasCalled) campaign.rollCount += 1;
    campaign.updatedAt = this.now();
    return {
      ok: true,
      ...patchesFor(before, result.state),
      entries: result.entries,
      privateEntries: result.privateEntries,
      effect: result.effect,
    };
  }

  restore(records: readonly SerializedCampaign[]): void {
    for (const record of records) {
      this.campaigns.set(record.id, {
        id: record.id,
        name: record.name,
        ownerId: record.ownerId,
        memberIds: [...record.memberIds],
        invitedIds: [...record.invitedIds],
        // Snapshots from before this field: whoever holds a character has joined.
        partyIds: [...(record.partyIds ?? Object.keys(record.state.characters))],
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
      invitedIds: c.invitedIds,
      partyIds: c.partyIds,
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
  invitedIds: string[];
  /** Absent from snapshots written before it existed; `restore` derives it. */
  partyIds?: string[] | undefined;
  state: RoomState;
  seed: number;
  rollCount: number;
  updatedAt: number;
}
