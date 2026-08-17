# Fase B: Campañas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the join-code room model with account-based campaigns: a GM creates a campaign, adds player accounts to it (no shared code), each player creates their one character for that campaign directly on the server, everyone sees that campaign's map/scenes, and the GM sees everything.

**Architecture:** `RoomState` (the existing reducer/broadcast engine — map, characters, fear, countdowns, etc.) is kept as-is internally; a new `CampaignStore` on the server wraps it with account-based ownership (`ownerId`) and membership (`memberIds`), replacing `RoomStore`. The socket authenticates with the same login token Phase A already issues (via `SessionStore`), not a per-room join code/seat token — `Player.id`/`GameMaster.id` become the account id directly. Character creation's finish step sends the finished sheet straight to the campaign instead of `localStorage`.

**Tech Stack:** TypeScript, Zod, Socket.IO — no new dependencies.

## Global Constraints

- No new npm dependencies in any package.
- All new user-facing text in Spanish.
- `tsconfig.base.json` strict mode: relative imports use `.js` extensions even in `.ts` source, indexing yields `T | undefined`, optional fields can't be assigned explicit `undefined`, type-only imports use `import type` (or the inline `type` modifier).
- The actor's identity is always resolved server-side from the authenticated session — never trusted from a client-supplied field. This applies to the socket the same way Phase A applied it to HTTP.
- One character per player per campaign: a character's key in `RoomState.characters` is that player's account id, not a client-chosen id.
- The join-code flow (`createRoom`/`joinRoom`/`resume`/`session` socket messages, the 6-character code, `RoomStore`, `apps/web/src/routes/CampaignRoute.tsx`, the local character library in `localStorage`) is removed, not kept alongside campaigns.
- No linter/formatter exists in this repo — `pnpm -F <pkg> typecheck` is the static gate for every task, and `pnpm -F <pkg> test` for every task with automated tests.

---

### Task 1: Protocol — campaign schemas, `RoomState.id`, socket messages

**Files:**
- Create: `packages/protocol/src/campaign.ts`
- Modify: `packages/protocol/src/room.ts`
- Modify: `packages/protocol/src/events.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/map.ts` (comment only)
- Test: `packages/protocol/test/campaign.test.ts`
- Test: Modify `packages/protocol/test/map.test.ts` if it asserts on `RoomState.code` (it does not — verify by search, no change expected)

**Interfaces:**
- Consumes: nothing new outside `zod` (already a dependency).
- Produces: `CampaignSummarySchema`/`type CampaignSummary` (`{id, name, ownerId, ownerUsername, memberIds}`), `CreateCampaignRequestSchema`, `AddPlayerRequestSchema` (from `campaign.ts`); `RoomState.id: string` (renamed from `code`), `createRoomState(id, gm): RoomState` (renamed from `createRoom`) (from `room.ts`); `CHANNEL.joinCampaign`, `JoinCampaignSchema` (`{campaignId: string}`), trimmed `ClaimCharacterSchema` (`{sheet: SheetStateSchema}`, `characterId` removed) (from `events.ts`) — all consumed by Task 2 (server store), Task 4 (gateway), Task 8 (web).

- [ ] **Step 1: Write the campaign schemas**

Create `packages/protocol/src/campaign.ts`:

```ts
import { z } from 'zod';

/**
 * What a client sees about a campaign outside the live room — no full `RoomState`
 * here, that only travels over the socket once a client has joined.
 */
export const CampaignSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  ownerId: z.string().min(1),
  ownerUsername: z.string().min(1),
  /** Player account ids the GM has added. Does not include the owner. */
  memberIds: z.array(z.string().min(1)),
});
export type CampaignSummary = z.infer<typeof CampaignSummarySchema>;

export const CreateCampaignRequestSchema = z.object({
  name: z.string().min(1).max(60),
});
export type CreateCampaignRequest = z.infer<typeof CreateCampaignRequestSchema>;

export const AddPlayerRequestSchema = z.object({
  username: z.string().min(1),
});
export type AddPlayerRequest = z.infer<typeof AddPlayerRequestSchema>;
```

- [ ] **Step 2: Rename `RoomState.code` to `id`, and `createRoom` to `createRoomState`**

In `packages/protocol/src/room.ts`, find:

```ts
export const RoomStateSchema = z.object({
  code: z.string().length(6),
```

Replace with:

```ts
export const RoomStateSchema = z.object({
  /** Opaque campaign id. Not a code a player types in — membership gates joining. */
  id: z.string().min(1),
```

Find:

```ts
export function createRoom(code: string, gm: GameMaster): RoomState {
  return {
    code,
```

Replace with:

```ts
export function createRoomState(id: string, gm: GameMaster): RoomState {
  return {
    id,
```

Nothing else in `room.ts` references `code` (confirmed by search) — the rest of `applyRoomEvent`, `roomForRole`, `roomPatch`-adjacent logic is untouched.

- [ ] **Step 3: Update the socket message schemas**

In `packages/protocol/src/events.ts`, find the `CHANNEL` object:

```ts
export const CHANNEL = {
  /** client -> server */
  intent: 'intent',
  createRoom: 'createRoom',
  joinRoom: 'joinRoom',
  resume: 'resume',
  claimCharacter: 'claimCharacter',
  /** server -> client */
  session: 'session',
  roomState: 'roomState',
  roomPatch: 'roomPatch',
  rolled: 'rolled',
  rejected: 'rejected',
} as const;
```

Replace with:

```ts
export const CHANNEL = {
  /** client -> server */
  intent: 'intent',
  joinCampaign: 'joinCampaign',
  claimCharacter: 'claimCharacter',
  /** server -> client */
  roomState: 'roomState',
  roomPatch: 'roomPatch',
  rolled: 'rolled',
  rejected: 'rejected',
} as const;
```

Find the connection-message section:

```ts
// --- connection messages ----------------------------------------------------

export const CreateRoomSchema = z.object({
  gmName: z.string().min(1).max(40),
});
export type CreateRoomMessage = z.infer<typeof CreateRoomSchema>;

export const JoinRoomSchema = z.object({
  code: z.string().length(6),
  name: z.string().min(1).max(40),
});
export type JoinRoomMessage = z.infer<typeof JoinRoomSchema>;

/** Reconnect: the client presents the token it was issued and gets full state back. */
export const ResumeSchema = z.object({
  code: z.string().length(6),
  token: z.string().min(8).max(128),
});
export type ResumeMessage = z.infer<typeof ResumeSchema>;

/** A player claims a character slot, uploading the sheet they created locally. */
export const ClaimCharacterSchema = z.object({
  characterId: z.string().min(1).max(64),
  sheet: SheetStateSchema,
});
export type ClaimCharacterMessage = z.infer<typeof ClaimCharacterSchema>;

// --- server -> client -------------------------------------------------------

/** Issued once on create/join/resume. The token is how a client reclaims its seat. */
export const SessionSchema = z.object({
  token: z.string().min(8),
  sessionId: z.string().min(1),
  role: z.enum(['gm', 'player']),
  code: z.string().length(6),
});
export type SessionMessage = z.infer<typeof SessionSchema>;
```

Replace with:

```ts
// --- connection messages ----------------------------------------------------

/**
 * Enter a campaign's live room. The socket is already authenticated (its account id
 * came from the connection handshake); this only asks to be seated in one specific
 * campaign, and the server checks membership before seating it.
 */
export const JoinCampaignSchema = z.object({
  campaignId: z.string().min(1),
});
export type JoinCampaignMessage = z.infer<typeof JoinCampaignSchema>;

/** A player claims their one character for the campaign they are seated in. */
export const ClaimCharacterSchema = z.object({
  sheet: SheetStateSchema,
});
export type ClaimCharacterMessage = z.infer<typeof ClaimCharacterSchema>;
```

(The `// --- server -> client ---` section further down, starting at `RoomPatchSchema`, is untouched — only `SessionSchema` above it is deleted.)

- [ ] **Step 4: Update the `Token.ownerId` doc comment**

In `packages/protocol/src/map.ts`, find:

```ts
  /**
   * The player session id allowed to drag this token. Null means GM-only. The server
   * checks this; a client cannot move a token it does not own.
   */
```

Replace with:

```ts
  /**
   * The player account id allowed to drag this token. Null means GM-only. The
   * server checks this; a client cannot move a token it does not own.
   */
```

- [ ] **Step 5: Export the new module**

In `packages/protocol/src/index.ts`, add (the file currently ends with `export * from './map.js';`):

```ts
export * from './campaign.js';
```

- [ ] **Step 6: Write the test, then run it**

Create `packages/protocol/test/campaign.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  AddPlayerRequestSchema,
  CampaignSummarySchema,
  CreateCampaignRequestSchema,
} from '../src/index.js';

describe('campaign schemas', () => {
  it('accepts a well-formed campaign summary', () => {
    const summary = {
      id: 'c-1',
      name: 'Grupo Martes',
      ownerId: 'u-1',
      ownerUsername: 'gm',
      memberIds: ['u-2', 'u-3'],
    };
    expect(CampaignSummarySchema.parse(summary)).toEqual(summary);
  });

  it('rejects a campaign summary with an empty name', () => {
    expect(
      CampaignSummarySchema.safeParse({
        id: 'c-1',
        name: '',
        ownerId: 'u-1',
        ownerUsername: 'gm',
        memberIds: [],
      }).success,
    ).toBe(false);
  });

  it('validates create-campaign and add-player payload shapes', () => {
    expect(CreateCampaignRequestSchema.safeParse({ name: 'Grupo Martes' }).success).toBe(true);
    expect(CreateCampaignRequestSchema.safeParse({ name: '' }).success).toBe(false);
    expect(AddPlayerRequestSchema.safeParse({ username: 'alex' }).success).toBe(true);
    expect(AddPlayerRequestSchema.safeParse({ username: '' }).success).toBe(false);
  });
});
```

Run: `pnpm -F @daggerheart/protocol test campaign`
Expected: 3 assertions pass.

Run: `pnpm -F @daggerheart/protocol typecheck`
Expected: no errors. This will surface every other file in the workspace that still references `RoomState.code`, `CHANNEL.createRoom`, `SessionSchema`, etc. as a downstream compile error — those are fixed in later tasks, so `apps/server`/`apps/web` typecheck failures at this point are expected and out of scope for this task; only `@daggerheart/protocol` itself must be clean.

- [ ] **Step 7: Commit**

```bash
git add packages/protocol/src/campaign.ts packages/protocol/src/room.ts packages/protocol/src/events.ts packages/protocol/src/map.ts packages/protocol/src/index.ts packages/protocol/test/campaign.test.ts
git commit -m "feat(protocol): add campaign schemas, rename RoomState.code to id, replace join-code socket messages with joinCampaign"
```

---

### Task 2: Server — `CampaignStore` and its disk snapshot

**Files:**
- Create: `apps/server/src/campaigns.ts`
- Create: `apps/server/src/campaigns-snapshot.ts`
- Test: `apps/server/test/campaigns.test.ts`

**Interfaces:**
- Consumes: `createRoomState`, `type RoomState`, `type Actor`, `type RoomEvent`, `applyRoomEvent`, `roomForRole`, `roomPatch`, `type RoomPatch`, `type GameMaster`, `type SheetState`, `type RollEntry` from `@daggerheart/protocol` (Task 1); `seededRng`, `type Rng` from `@daggerheart/rules`.
- Produces: `class CampaignStore` with `createCampaign(ownerId, ownerUsername, name): CampaignRecord`, `addMember(campaignId, requesterId, memberId): boolean`, `removeMember(campaignId, requesterId, memberId): boolean`, `listFor(accountId): CampaignRecord[]`, `get(campaignId): CampaignRecord | null`, `roleOf(campaignId, accountId): 'gm' | 'player' | null`, `seatFor(campaignId, accountId, username): { role: 'gm' | 'player' } | null` (also adds a `Player`/`GameMaster` entry to `state` the first time this account is seen live, so the roster reflects who has actually connected), `setConnected(campaignId, accountId, connected): RoomPatch | null`, `claimCharacter(campaignId, accountId, sheet): ApplyOutcome`, `apply(campaignId, accountId, event): ApplyOutcome`, `restore(records)`, `serialize(): SerializedCampaign[]` (from `campaigns.ts`), consumed by Task 3 (HTTP), Task 4 (gateway), Task 6 (tests). `writeCampaignsSnapshot(path, campaigns)`, `readCampaignsSnapshot(path)` (from `campaigns-snapshot.ts`), consumed by Task 5 (`main.ts`).

- [ ] **Step 1: Write `CampaignStore`**

Create `apps/server/src/campaigns.ts`:

```ts
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

  removeMember(campaignId: string, requesterId: string, memberId: string): boolean {
    const campaign = this.campaigns.get(campaignId);
    if (campaign === undefined || campaign.ownerId !== requesterId) return false;
    campaign.memberIds = campaign.memberIds.filter((id) => id !== memberId);
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
```

- [ ] **Step 2: Write the snapshot read/write pair**

Create `apps/server/src/campaigns-snapshot.ts` (same shape as `users-snapshot.ts`):

```ts
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { RoomStateSchema } from '@daggerheart/protocol';
import { z } from 'zod';

import type { SerializedCampaign } from './campaigns.js';

const SerializedCampaignSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  ownerId: z.string().min(1),
  memberIds: z.array(z.string().min(1)),
  state: RoomStateSchema,
  seed: z.number(),
  rollCount: z.number().int().nonnegative(),
  updatedAt: z.number(),
});

const SnapshotSchema = z.object({
  version: z.literal(1),
  campaigns: z.array(SerializedCampaignSchema),
});

export const CAMPAIGNS_SNAPSHOT_VERSION = 1;

/** Atomic write: a crash mid-write must not leave a truncated file. */
export async function writeCampaignsSnapshot(
  path: string,
  campaigns: readonly SerializedCampaign[],
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const payload = JSON.stringify({ version: CAMPAIGNS_SNAPSHOT_VERSION, campaigns });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, payload, 'utf8');
  await rename(temporary, path);
}

/** Anything unreadable or from another version is discarded rather than crashing on boot. */
export async function readCampaignsSnapshot(path: string): Promise<SerializedCampaign[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return [];
  }

  try {
    const parsed = SnapshotSchema.safeParse(JSON.parse(raw) as unknown);
    if (!parsed.success) return [];
    return parsed.data.campaigns;
  } catch {
    return [];
  }
}
```

- [ ] **Step 3: Write the tests**

Create `apps/server/test/campaigns.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CampaignStore } from '../src/campaigns.js';
import { readCampaignsSnapshot, writeCampaignsSnapshot } from '../src/campaigns-snapshot.js';

describe('CampaignStore', () => {
  it('creates a campaign owned by its creator, with no members yet', () => {
    const store = new CampaignStore();
    const campaign = store.createCampaign('u-gm', 'gm', 'Grupo Martes');
    expect(campaign.ownerId).toBe('u-gm');
    expect(campaign.memberIds).toEqual([]);
    expect(campaign.state.gm.id).toBe('u-gm');
    expect(store.roleOf(campaign.id, 'u-gm')).toBe('gm');
  });

  it('only the owner can add or remove a member', () => {
    const store = new CampaignStore();
    const campaign = store.createCampaign('u-gm', 'gm', 'Grupo Martes');

    expect(store.addMember(campaign.id, 'u-someone-else', 'u-player')).toBe(false);
    expect(store.addMember(campaign.id, 'u-gm', 'u-player')).toBe(true);
    expect(store.roleOf(campaign.id, 'u-player')).toBe('player');

    expect(store.removeMember(campaign.id, 'u-someone-else', 'u-player')).toBe(false);
    expect(store.roleOf(campaign.id, 'u-player')).toBe('player');
    expect(store.removeMember(campaign.id, 'u-gm', 'u-player')).toBe(true);
    expect(store.roleOf(campaign.id, 'u-player')).toBeNull();
  });

  it('lists campaigns an account owns or belongs to, and none it does not', () => {
    const store = new CampaignStore();
    const owned = store.createCampaign('u-gm', 'gm', 'Owned');
    const memberOf = store.createCampaign('u-other-gm', 'other-gm', 'Member of');
    store.addMember(memberOf.id, 'u-other-gm', 'u-gm');
    store.createCampaign('u-third-gm', 'third-gm', 'Unrelated');

    const listed = store.listFor('u-gm').map((c) => c.name).sort();
    expect(listed).toEqual(['Member of', 'Owned']);
  });

  it('seats an account live and adds it to the roster the first time', () => {
    const store = new CampaignStore();
    const campaign = store.createCampaign('u-gm', 'gm', 'Grupo Martes');
    store.addMember(campaign.id, 'u-gm', 'u-player');

    const seat = store.seatFor(campaign.id, 'u-player', 'alex');
    expect(seat?.role).toBe('player');
    expect(store.get(campaign.id)?.state.players).toEqual([
      { id: 'u-player', name: 'alex', connected: true, characterId: null },
    ]);

    expect(store.seatFor(campaign.id, 'u-stranger', 'nobody')).toBeNull();
  });

  it('claims a character keyed by the claiming account id', () => {
    const store = new CampaignStore();
    const campaign = store.createCampaign('u-gm', 'gm', 'Grupo Martes');
    store.addMember(campaign.id, 'u-gm', 'u-player');
    store.seatFor(campaign.id, 'u-player', 'alex');

    const sheet = { fake: 'sheet' } as never;
    const outcome = store.claimCharacter(campaign.id, 'u-player', sheet);
    expect(outcome.ok).toBe(true);
    expect(store.get(campaign.id)?.state.characters['u-player']).toBe(sheet);
    expect(store.get(campaign.id)?.state.players[0]?.characterId).toBe('u-player');
  });

  it('round-trips through serialize/restore', () => {
    const store = new CampaignStore();
    const campaign = store.createCampaign('u-gm', 'gm', 'Grupo Martes');
    store.addMember(campaign.id, 'u-gm', 'u-player');

    const restored = new CampaignStore();
    restored.restore(store.serialize());

    expect(restored.get(campaign.id)?.name).toBe('Grupo Martes');
    expect(restored.roleOf(campaign.id, 'u-player')).toBe('player');
  });
});

describe('campaigns snapshot file', () => {
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'dh-campaigns-'));
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('reads back exactly what it wrote', async () => {
    const store = new CampaignStore();
    store.createCampaign('u-gm', 'gm', 'Grupo Martes');
    const path = join(directory, 'campaigns.json');

    await writeCampaignsSnapshot(path, store.serialize());
    const restored = await readCampaignsSnapshot(path);

    const fresh = new CampaignStore();
    fresh.restore(restored);
    expect(fresh.listFor('u-gm')).toHaveLength(1);
  });

  it('returns an empty array when the file does not exist', async () => {
    expect(await readCampaignsSnapshot(join(directory, 'missing.json'))).toEqual([]);
  });

  it('discards unreadable JSON instead of throwing', async () => {
    const path = join(directory, 'corrupt.json');
    await writeCampaignsSnapshot(path, []);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, 'not json', 'utf8');
    expect(await readCampaignsSnapshot(path)).toEqual([]);
  });
});
```

Run: `pnpm -F @daggerheart/server test campaigns`
Expected: all tests pass.

- [ ] **Step 4: Typecheck and commit**

Run: `pnpm -F @daggerheart/server typecheck`
Expected: errors are expected here too, from files this task does not yet touch (`gateway.ts`, `main.ts` still import `RoomStore`/old protocol names). Confirm the errors are confined to `rooms.ts`, `gateway.ts`, `main.ts`, and the existing test files — not to `campaigns.ts`/`campaigns-snapshot.ts`/`campaigns.test.ts` themselves.

```bash
git add apps/server/src/campaigns.ts apps/server/src/campaigns-snapshot.ts apps/server/test/campaigns.test.ts
git commit -m "feat(server): add CampaignStore and its disk snapshot"
```

---

### Task 3: Server — campaign HTTP endpoints

**Files:**
- Create: `apps/server/src/campaigns-http.ts`
- Test: `apps/server/test/campaigns-http.test.ts`

**Interfaces:**
- Consumes: `CampaignSummarySchema`, `type CampaignSummary`, `CreateCampaignRequestSchema`, `AddPlayerRequestSchema` from `@daggerheart/protocol` (Task 1); `CampaignStore`, `type CampaignRecord` from `./campaigns.js` (Task 2); `SessionStore` from `./sessions.js`, `UserStore` from `./users.js` (both already exist from Phase A); `readBody` from `./uploads.js` (already exported).
- Produces: `handleCampaigns(request, response, { campaigns, users, sessions }): Promise<boolean>` — same true/false fallthrough contract as `handleUploads`/`handleAuth`, consumed by Task 5 (`main.ts`).

- [ ] **Step 1: Write the handler**

Create `apps/server/src/campaigns-http.ts`:

```ts
import type { IncomingMessage, ServerResponse } from 'node:http';

import { AddPlayerRequestSchema, CreateCampaignRequestSchema, type CampaignSummary } from '@daggerheart/protocol';

import type { CampaignRecord, CampaignStore } from './campaigns.js';
import type { SessionStore } from './sessions.js';
import { readBody } from './uploads.js';
import type { User, UserStore } from './users.js';

const MAX_CAMPAIGNS_BODY_BYTES = 64 * 1024;

const json = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};

const noContent = (response: ServerResponse): void => {
  response.writeHead(204);
  response.end();
};

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const bytes = await readBody(request, MAX_CAMPAIGNS_BODY_BYTES);
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function bearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  if (header === undefined || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length);
}

function actorFor(request: IncomingMessage, sessions: SessionStore, users: UserStore): User | null {
  const token = bearerToken(request);
  if (token === null) return null;
  const userId = sessions.resolve(token);
  if (userId === null) return null;
  return users.findById(userId);
}

function toSummary(campaign: CampaignRecord, ownerUsername: string): CampaignSummary {
  return {
    id: campaign.id,
    name: campaign.name,
    ownerId: campaign.ownerId,
    ownerUsername,
    memberIds: campaign.memberIds,
  };
}

export interface CampaignsDeps {
  campaigns: CampaignStore;
  users: UserStore;
  sessions: SessionStore;
  /** Called after any mutation, so the caller can snapshot to disk right away. */
  persist: () => void;
}

/**
 * Handles `/campaigns` and its sub-routes. Mirrors `handleAuth`/`handleUploads`:
 * returns true when it handled the request, so the caller can fall through.
 */
export async function handleCampaigns(
  request: IncomingMessage,
  response: ServerResponse,
  { campaigns, users, sessions, persist }: CampaignsDeps,
): Promise<boolean> {
  const url = request.url ?? '';
  const method = request.method ?? 'GET';

  if (method === 'POST' && url === '/campaigns') {
    const actor = actorFor(request, sessions, users);
    if (actor === null) {
      json(response, 401, { error: 'unauthorized' });
      return true;
    }
    const parsed = CreateCampaignRequestSchema.safeParse(await readJsonBody(request).catch(() => null));
    if (!parsed.success) {
      json(response, 400, { error: 'badRequest' });
      return true;
    }
    const created = campaigns.createCampaign(actor.id, actor.username, parsed.data.name);
    persist();
    json(response, 201, toSummary(created, actor.username));
    return true;
  }

  if (method === 'GET' && url === '/campaigns') {
    const actor = actorFor(request, sessions, users);
    if (actor === null) {
      json(response, 401, { error: 'unauthorized' });
      return true;
    }
    const list = campaigns.listFor(actor.id).map((c) => {
      const owner = users.findById(c.ownerId);
      return toSummary(c, owner?.username ?? c.state.gm.name);
    });
    json(response, 200, list);
    return true;
  }

  const addPlayerMatch = /^\/campaigns\/([^/]+)\/players$/.exec(url);
  if (method === 'POST' && addPlayerMatch !== null) {
    const actor = actorFor(request, sessions, users);
    if (actor === null) {
      json(response, 401, { error: 'unauthorized' });
      return true;
    }
    const parsed = AddPlayerRequestSchema.safeParse(await readJsonBody(request).catch(() => null));
    if (!parsed.success) {
      json(response, 400, { error: 'badRequest' });
      return true;
    }
    const target = users.findByUsername(parsed.data.username);
    if (target === null) {
      json(response, 404, { error: 'unknownUsername' });
      return true;
    }
    const campaignId = addPlayerMatch[1] ?? '';
    const ok = campaigns.addMember(campaignId, actor.id, target.id);
    if (!ok) {
      json(response, 403, { error: 'forbidden' });
      return true;
    }
    persist();
    noContent(response);
    return true;
  }

  const removePlayerMatch = /^\/campaigns\/([^/]+)\/players\/([^/]+)$/.exec(url);
  if (method === 'DELETE' && removePlayerMatch !== null) {
    const actor = actorFor(request, sessions, users);
    if (actor === null) {
      json(response, 401, { error: 'unauthorized' });
      return true;
    }
    const campaignId = removePlayerMatch[1] ?? '';
    const memberId = removePlayerMatch[2] ?? '';
    const ok = campaigns.removeMember(campaignId, actor.id, memberId);
    if (!ok) {
      json(response, 403, { error: 'forbidden' });
      return true;
    }
    persist();
    noContent(response);
    return true;
  }

  return false;
}
```

- [ ] **Step 2: Write the tests**

Create `apps/server/test/campaigns-http.test.ts`:

```ts
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CampaignStore } from '../src/campaigns.js';
import { handleCampaigns } from '../src/campaigns-http.js';
import { SessionStore } from '../src/sessions.js';
import { UserStore } from '../src/users.js';

async function startCampaignsServer() {
  const users = new UserStore();
  const sessions = new SessionStore();
  const campaigns = new CampaignStore();
  const http: HttpServer = createServer((request, response) => {
    void handleCampaigns(request, response, { campaigns, users, sessions, persist: () => {} }).then(
      (handled) => {
        if (!handled) {
          response.writeHead(404);
          response.end();
        }
      },
    );
  });
  await new Promise<void>((resolve) => http.listen(0, resolve));
  const address = http.address() as AddressInfo;
  return {
    url: `http://localhost:${address.port}`,
    users,
    close: () => new Promise<void>((resolve) => http.close(() => resolve())),
  };
}

async function tokenFor(url: string, users: UserStore, username: string, password: string): Promise<string> {
  // The users store already has the account; login goes through the real auth
  // endpoint's twin logic path — simplest here is to mint a session directly,
  // since this suite is about /campaigns, not /login (already covered elsewhere).
  const user = await users.verifyLogin(username, password);
  if (user === null) throw new Error('setup: bad credentials');
  return user.id;
}

describe('campaigns HTTP endpoints', () => {
  let server: Awaited<ReturnType<typeof startCampaignsServer>>;
  let gmToken: string;
  let gmId: string;

  beforeAll(async () => {
    server = await startCampaignsServer();
    const gm = await server.users.createUser('gm', 'gm-pw', 'gm');
    gmId = gm.id;
    // Mint a real session token the way login does, without duplicating the HTTP
    // round trip this suite isn't testing.
    const sessions = new SessionStore();
    gmToken = sessions.create(gm.id);
    // Swap in the same sessions instance the server actually uses by recreating
    // the server with a shared reference instead — simplest fix: rebuild server
    // deps so the token this test minted is one the server recognizes.
  });

  afterAll(async () => {
    await server.close();
  });

  it('requires a logged-in account to create a campaign', async () => {
    const response = await fetch(`${server.url}/campaigns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Grupo Martes' }),
    });
    expect(response.status).toBe(401);
  });
});
```

The `beforeAll` above mints a token from a `SessionStore` instance that is not
the one the running server holds, which will not authenticate. Fix this before
finishing the step: build the server so the test keeps a reference to the same
`SessionStore` and mints the token from it. Replace the whole file with:

```ts
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CampaignStore } from '../src/campaigns.js';
import { handleCampaigns } from '../src/campaigns-http.js';
import { SessionStore } from '../src/sessions.js';
import { UserStore } from '../src/users.js';

async function startCampaignsServer() {
  const users = new UserStore();
  const sessions = new SessionStore();
  const campaigns = new CampaignStore();
  const http: HttpServer = createServer((request, response) => {
    void handleCampaigns(request, response, { campaigns, users, sessions, persist: () => {} }).then(
      (handled) => {
        if (!handled) {
          response.writeHead(404);
          response.end();
        }
      },
    );
  });
  await new Promise<void>((resolve) => http.listen(0, resolve));
  const address = http.address() as AddressInfo;
  return {
    url: `http://localhost:${address.port}`,
    users,
    sessions,
    close: () => new Promise<void>((resolve) => http.close(() => resolve())),
  };
}

describe('campaigns HTTP endpoints', () => {
  let server: Awaited<ReturnType<typeof startCampaignsServer>>;
  let gmToken: string;
  let playerToken: string;
  let playerId: string;

  beforeAll(async () => {
    server = await startCampaignsServer();
    const gm = await server.users.createUser('gm', 'gm-pw', 'gm');
    gmToken = server.sessions.create(gm.id);
    const player = await server.users.createUser('alex', 'player-pw', 'player');
    playerId = player.id;
    playerToken = server.sessions.create(player.id);
  });

  afterAll(async () => {
    await server.close();
  });

  it('requires a logged-in account to create a campaign', async () => {
    const response = await fetch(`${server.url}/campaigns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Grupo Martes' }),
    });
    expect(response.status).toBe(401);
  });

  it('creates a campaign for the logged-in account and lists it back', async () => {
    const created = await fetch(`${server.url}/campaigns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ name: 'Grupo Martes' }),
    });
    expect(created.status).toBe(201);
    const summary = (await created.json()) as { id: string; ownerUsername: string; memberIds: string[] };
    expect(summary.ownerUsername).toBe('gm');
    expect(summary.memberIds).toEqual([]);

    const list = await fetch(`${server.url}/campaigns`, { headers: { authorization: `Bearer ${gmToken}` } });
    const campaigns = (await list.json()) as { id: string }[];
    expect(campaigns.some((c) => c.id === summary.id)).toBe(true);

    // A player not yet added sees no campaigns.
    const playerList = await fetch(`${server.url}/campaigns`, {
      headers: { authorization: `Bearer ${playerToken}` },
    });
    expect(((await playerList.json()) as unknown[])).toEqual([]);
  });

  it('lets only the owner add a player, then that player sees the campaign', async () => {
    const created = await fetch(`${server.url}/campaigns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ name: 'Otra campaña' }),
    });
    const { id: campaignId } = (await created.json()) as { id: string };

    const forbidden = await fetch(`${server.url}/campaigns/${campaignId}/players`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${playerToken}` },
      body: JSON.stringify({ username: 'alex' }),
    });
    expect(forbidden.status).toBe(403);

    const added = await fetch(`${server.url}/campaigns/${campaignId}/players`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ username: 'alex' }),
    });
    expect(added.status).toBe(204);

    const playerList = await fetch(`${server.url}/campaigns`, {
      headers: { authorization: `Bearer ${playerToken}` },
    });
    const playerCampaigns = (await playerList.json()) as { id: string; memberIds: string[] }[];
    expect(playerCampaigns.some((c) => c.id === campaignId && c.memberIds.includes(playerId))).toBe(true);
  });

  it('404s adding an unknown username', async () => {
    const created = await fetch(`${server.url}/campaigns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ name: 'Tercera' }),
    });
    const { id: campaignId } = (await created.json()) as { id: string };

    const response = await fetch(`${server.url}/campaigns/${campaignId}/players`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ username: 'nobody-here' }),
    });
    expect(response.status).toBe(404);
  });

  it('lets the owner remove a member', async () => {
    const created = await fetch(`${server.url}/campaigns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ name: 'Cuarta' }),
    });
    const { id: campaignId } = (await created.json()) as { id: string };
    await fetch(`${server.url}/campaigns/${campaignId}/players`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ username: 'alex' }),
    });

    const removed = await fetch(`${server.url}/campaigns/${campaignId}/players/${playerId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${gmToken}` },
    });
    expect(removed.status).toBe(204);

    const playerList = await fetch(`${server.url}/campaigns`, {
      headers: { authorization: `Bearer ${playerToken}` },
    });
    const playerCampaigns = (await playerList.json()) as { id: string }[];
    expect(playerCampaigns.some((c) => c.id === campaignId)).toBe(false);
  });
});
```

Run: `pnpm -F @daggerheart/server test campaigns-http`
Expected: all tests pass.

- [ ] **Step 3: Typecheck and commit**

Run: `pnpm -F @daggerheart/server typecheck`
Expected: same expected-failures-elsewhere caveat as Task 2 — confirm no error originates in `campaigns-http.ts` or `campaigns-http.test.ts`.

```bash
git add apps/server/src/campaigns-http.ts apps/server/test/campaigns-http.test.ts
git commit -m "feat(server): add campaign HTTP endpoints (create, list, add/remove player)"
```

---

### Task 4: Server — rewrite the gateway, delete `RoomStore`

**Files:**
- Modify: `apps/server/src/gateway.ts` (full rewrite)
- Delete: `apps/server/src/rooms.ts`
- Delete: `apps/server/src/snapshot.ts`

**Interfaces:**
- Consumes: `CampaignStore` (Task 2), `SessionStore` (Phase A, `apps/server/src/sessions.ts` — unchanged), `UserStore` (Phase A, for the username used when first seating a player); `CHANNEL`, `JoinCampaignSchema`, `ClaimCharacterSchema`, `RoomEventSchema`, `type RoomPatch`, `type RoomState`, `type Actor` from `@daggerheart/protocol` (Task 1).
- Produces: `registerGateway(io, campaigns, sessions, users): void` (signature changed — two new parameters), consumed by Task 5 (`main.ts`).

- [ ] **Step 1: Delete the files this task replaces**

```bash
git rm apps/server/src/rooms.ts apps/server/src/snapshot.ts
```

(`campaigns.ts`/`campaigns-snapshot.ts` from Tasks 2 fully replace what these provided — `RoomStore` and its snapshot pair. Nothing else imports `snapshot.ts`; `users-snapshot.ts` is a separate, already-independent file from Phase A.)

- [ ] **Step 2: Rewrite the gateway**

Replace the entire contents of `apps/server/src/gateway.ts` with:

```ts
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
  io.on('connection', (socket) => {
    const token = socket.handshake.auth?.token as unknown;
    const accountId = typeof token === 'string' ? sessions.resolve(token) : null;
    if (accountId === null) {
      socket.disconnect(true);
      return;
    }
    accountOf.set(socket, accountId);

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
```

- [ ] **Step 3: Typecheck**

Run: `pnpm -F @daggerheart/server typecheck`
Expected: `gateway.ts` itself is now clean. `main.ts` and the existing `apps/server/test/*.ts` files still fail — that is Task 5 and Task 6. Confirm no error is reported inside `gateway.ts`.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/gateway.ts
git commit -m "feat(server): rewrite the gateway around account-based campaign membership, remove RoomStore"
```

---

### Task 5: Server — wire `main.ts` to `CampaignStore`

**Files:**
- Modify: `apps/server/src/main.ts` (full rewrite)

**Interfaces:**
- Consumes: `CampaignStore` (Task 2), `readCampaignsSnapshot`/`writeCampaignsSnapshot` (Task 2), `handleCampaigns` (Task 3), the rewritten `registerGateway` (Task 4, now taking `(io, campaigns, sessions, users)`).
- Produces: nothing further downstream — last server-side task before test rewrites.

- [ ] **Step 1: Replace the whole file**

Replace the entire contents of `apps/server/src/main.ts` with:

```ts
import { createServer } from 'node:http';

import { Server } from 'socket.io';

import { handleAuth } from './auth-http.js';
import { CampaignStore } from './campaigns.js';
import { handleCampaigns } from './campaigns-http.js';
import { readCampaignsSnapshot, writeCampaignsSnapshot } from './campaigns-snapshot.js';
import { registerGateway } from './gateway.js';
import { SessionStore } from './sessions.js';
import { handleUploads } from './uploads.js';
import { UserStore } from './users.js';
import { readUsersSnapshot, writeUsersSnapshot } from './users-snapshot.js';

const PORT = Number(process.env.PORT ?? 4000);
const CAMPAIGNS_SNAPSHOT_PATH = process.env.CAMPAIGNS_SNAPSHOT_PATH ?? '.data/campaigns.json';
const CAMPAIGNS_SNAPSHOT_INTERVAL_MS = Number(process.env.CAMPAIGNS_SNAPSHOT_INTERVAL_MS ?? 15_000);
/** Map images live beside the campaign snapshots. */
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? '.data/uploads';
const USERS_SNAPSHOT_PATH = process.env.USERS_SNAPSHOT_PATH ?? '.data/users.json';
/** The first GM account, created on boot if no account by this name exists yet. */
const GM_USERNAME = process.env.GM_USERNAME ?? 'gm';
const GM_PASSWORD = process.env.GM_PASSWORD ?? 'gm';

/** The web app's dev server and preview origins. This is a local tool, not public. */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin !== '');

async function main(): Promise<void> {
  const campaigns = new CampaignStore();
  campaigns.restore(await readCampaignsSnapshot(CAMPAIGNS_SNAPSHOT_PATH));
  if (campaigns.size > 0) {
    console.log(`restored ${campaigns.size} campaign(s) from ${CAMPAIGNS_SNAPSHOT_PATH}`);
  }
  const persistCampaigns = (): void => {
    void writeCampaignsSnapshot(CAMPAIGNS_SNAPSHOT_PATH, campaigns.serialize()).catch((error: unknown) =>
      console.error('campaigns snapshot failed', error),
    );
  };

  const users = new UserStore();
  users.restore(await readUsersSnapshot(USERS_SNAPSHOT_PATH));
  const persistUsers = (): void => {
    void writeUsersSnapshot(USERS_SNAPSHOT_PATH, users.serialize()).catch((error: unknown) =>
      console.error('users snapshot failed', error),
    );
  };
  if (users.findByUsername(GM_USERNAME) === null) {
    await users.createUser(GM_USERNAME, GM_PASSWORD, 'gm');
    persistUsers();
    const usingDefaults = GM_USERNAME === 'gm' && GM_PASSWORD === 'gm';
    console.warn(
      `No GM account named "${GM_USERNAME}" existed — created it.` +
        (usingDefaults
          ? ' Using the default gm/gm credentials — set GM_USERNAME and GM_PASSWORD to change them.'
          : ''),
    );
  }
  const sessions = new SessionStore();

  const http = createServer((request, response) => {
    // The web app runs on another origin in development.
    const origin = request.headers.origin;
    if (origin !== undefined && ALLOWED_ORIGINS.includes(origin)) {
      response.setHeader('access-control-allow-origin', origin);
      response.setHeader('access-control-allow-headers', 'content-type, authorization');
      response.setHeader('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS');
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    // A health probe, so `pnpm dev` can tell the server is actually up.
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, campaigns: campaigns.size }));
      return;
    }

    void handleAuth(request, response, { users, sessions, persist: persistUsers }).then((handled) => {
      if (handled) return;
      void handleCampaigns(request, response, { campaigns, users, sessions, persist: persistCampaigns }).then(
        (campaignsHandled) => {
          if (campaignsHandled) return;
          void handleUploads(request, response, UPLOAD_DIR).then((uploadHandled) => {
            if (uploadHandled) return;
            response.writeHead(404);
            response.end();
          });
        },
      );
    });
  });

  const io = new Server(http, { cors: { origin: ALLOWED_ORIGINS } });
  registerGateway(io, campaigns, sessions, users);

  const stopSnapshots = setInterval(persistCampaigns, CAMPAIGNS_SNAPSHOT_INTERVAL_MS);
  stopSnapshots.unref();

  const shutdown = async (): Promise<void> => {
    clearInterval(stopSnapshots);
    // One last snapshot so a clean stop never loses the table's progress.
    await writeCampaignsSnapshot(CAMPAIGNS_SNAPSHOT_PATH, campaigns.serialize()).catch((error: unknown) =>
      console.error('final campaigns snapshot failed', error),
    );
    await io.close();
    http.close();
  };

  process.on('SIGINT', () => void shutdown().then(() => process.exit(0)));
  process.on('SIGTERM', () => void shutdown().then(() => process.exit(0)));

  // A busy port is an ordinary mistake (an old instance still running), not a crash
  // worth a stack trace — and an unhandled 'error' here would take the web dev
  // server down with it under `pnpm dev`.
  http.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `Port ${PORT} is already in use — another server is probably still running. ` +
          `Stop it, or start this one with PORT=<other> pnpm dev:server.`,
      );
      process.exit(1);
    }
    throw error;
  });

  http.listen(PORT, () => {
    console.log(`Daggerheart VTT server listening on http://localhost:${PORT}`);
  });
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
```

Notable differences from the version this replaces: `RoomStore`/`readSnapshot`/`writeSnapshot`/`startSnapshots` are gone (replaced by `CampaignStore`/`readCampaignsSnapshot`/`writeCampaignsSnapshot`, with the periodic-snapshot interval inlined instead of importing `startSnapshots` from the deleted `snapshot.ts`); `/health`'s `rooms` field is renamed `campaigns`; `handleCampaigns` is threaded into the same fallthrough chain as `handleAuth`/`handleUploads`; `access-control-allow-methods` gains `DELETE` (the remove-player endpoint uses it); `registerGateway` is called with its new four-argument signature.

- [ ] **Step 2: Typecheck**

Run: `pnpm -F @daggerheart/server typecheck`
Expected: `main.ts` is now clean. Only `apps/server/test/*.ts` (Task 6) should still fail.

- [ ] **Step 3: Manual verification**

```bash
rm -f .data/campaigns.json .data/users.json
pnpm -F @daggerheart/server start &
sleep 1
curl -s http://localhost:4000/health
```

Expected: `{"ok":true,"campaigns":0}`. Stop the server (`kill %1`).

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/main.ts
git commit -m "feat(server): wire campaigns into the server entrypoint, remove RoomStore's snapshot"
```

---

### Task 6: Server tests — rewrite for account-based campaigns

**Files:**
- Modify: `apps/server/test/helpers.ts` (full rewrite)
- Modify: `apps/server/test/integration.test.ts` (full rewrite)
- Modify: `apps/server/test/map.test.ts` (full rewrite)
- Modify: `apps/server/test/rolls.test.ts` (full rewrite)

**Interfaces:**
- Consumes: `CampaignStore` (Task 2), `registerGateway` (Task 4), `CHANNEL`/`JoinCampaignSchema`/`ClaimCharacterSchema` (Task 1).
- Produces: `startTestServer()`, `createCampaignAs()`, `joinCampaignAs()`, `buildCharacter()`, `buildSheet()` — the test-only helpers every other server test file depends on. This task's `helpers.ts` is the last piece before the whole `apps/server` suite is green again.

- [ ] **Step 1: Rewrite the test helpers**

Replace the entire contents of `apps/server/test/helpers.ts` with:

```ts
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  applyChoice,
  availableOptions,
  createInitialState,
  finalize,
  spellcastTrait,
  type Character,
} from '@daggerheart/character';
import { CHANNEL, createSheet, type RoomPatch, type RoomState, type SheetState } from '@daggerheart/protocol';
import { classes, type ClassId } from '@daggerheart/srd-data';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';

import { CampaignStore } from '../src/campaigns.js';
import { registerGateway } from '../src/gateway.js';
import { SessionStore } from '../src/sessions.js';
import { UserStore } from '../src/users.js';

/** Builds a finished character through the real creation reducer. */
export function buildCharacter(classId: ClassId = 'guardian'): Character {
  const characterClass = classes.find((c) => c.id === classId);
  if (!characterClass) throw new Error(`no such class: ${classId}`);

  let state = createInitialState();
  state = applyChoice(state, { type: 'chooseClass', classId });
  const subclassId = characterClass.subclasses[0];
  if (subclassId === undefined) throw new Error('no subclass');
  state = applyChoice(state, { type: 'chooseSubclass', subclassId });
  state = applyChoice(state, { type: 'chooseAncestry', ancestryId: 'human' });
  state = applyChoice(state, { type: 'chooseCommunity', communityId: 'wanderborne' });
  state = applyChoice(state, {
    type: 'assignTraits',
    traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
  });

  const equipment = availableOptions(state, 5);
  const primary = equipment.primaryWeapons[0];
  const armorPiece = equipment.armor[0];
  const classItem = equipment.classItems[0];
  if (!primary || !armorPiece || !classItem) throw new Error('no equipment');

  state = applyChoice(state, {
    type: 'chooseEquipment',
    equipment: {
      primaryWeaponId: primary.id,
      secondaryWeaponId: null,
      armorId: armorPiece.id,
      potion: 'health',
      classItem,
      spellCarrier: spellcastTrait(state) === null ? null : 'A worn spellbook',
    },
  });

  state = applyChoice(state, { type: 'setName', name: `${characterClass.name} PC` });
  state = applyChoice(state, { type: 'setBackground', background: 'A long road.' });
  state = applyChoice(state, {
    type: 'setExperiences',
    experiences: [
      { name: 'Blacksmith', modifier: 2 },
      { name: 'Survivor', modifier: 2 },
    ],
  });
  const cards = availableOptions(state, 8).cards.slice(0, 2);
  state = applyChoice(state, { type: 'chooseDomainCards', cardIds: cards.map((c) => c.id) });
  state = applyChoice(state, { type: 'setConnections', connections: [] });

  return finalize(state);
}

export const buildSheet = (classId: ClassId = 'guardian'): SheetState =>
  createSheet(buildCharacter(classId));

/** A running server plus everything a test needs to authenticate against it. */
export interface TestServer {
  url: string;
  campaigns: CampaignStore;
  users: UserStore;
  sessions: SessionStore;
  close: () => Promise<void>;
}

export async function startTestServer(seed = 1234): Promise<TestServer> {
  const http: HttpServer = createServer();
  const io = new Server(http, { cors: { origin: '*' } });

  const campaigns = new CampaignStore();
  const originalCreate = campaigns.createCampaign.bind(campaigns);
  campaigns.createCampaign = (ownerId: string, ownerUsername: string, name: string) =>
    originalCreate(ownerId, ownerUsername, name, seed);

  const users = new UserStore();
  const sessions = new SessionStore();

  registerGateway(io, campaigns, sessions, users);

  await new Promise<void>((resolve) => http.listen(0, resolve));
  const address = http.address() as AddressInfo;

  return {
    url: `http://localhost:${address.port}`,
    campaigns,
    users,
    sessions,
    close: async () => {
      await io.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

/** A connected, authenticated socket client with promise-based helpers. */
export class TestClient {
  private constructor(readonly socket: Socket) {}

  static async connect(url: string, token: string): Promise<TestClient> {
    const socket = connect(url, { transports: ['websocket'], forceNew: true, auth: { token } });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    return new TestClient(socket);
  }

  next<T>(channel: string, timeoutMs = 2000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.socket.off(channel, handler);
        reject(new Error(`timed out waiting for ${channel}`));
      }, timeoutMs);
      const handler = (payload: T) => {
        clearTimeout(timer);
        this.socket.off(channel, handler);
        resolve(payload);
      };
      this.socket.on(channel, handler);
    });
  }

  until<T>(channel: string, predicate: (payload: T) => boolean, timeoutMs = 3000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.socket.off(channel, handler);
        reject(new Error(`timed out waiting for a matching ${channel}`));
      }, timeoutMs);
      const handler = (payload: T) => {
        if (!predicate(payload)) return;
        clearTimeout(timer);
        this.socket.off(channel, handler);
        resolve(payload);
      };
      this.socket.on(channel, handler);
    });
  }

  emit(channel: string, payload: unknown): void {
    this.socket.emit(channel, payload);
  }

  close(): void {
    this.socket.disconnect();
  }
}

export interface AccountFixture {
  id: string;
  username: string;
  token: string;
}

/** Creates a fresh account on the running test server and logs it in (no HTTP round trip needed). */
export async function accountFor(
  server: TestServer,
  username: string,
  role: 'gm' | 'player' = 'player',
): Promise<AccountFixture> {
  const user = await server.users.createUser(username, 'password', role);
  const token = server.sessions.create(user.id);
  return { id: user.id, username, token };
}

/** Creates a campaign owned by `gm`, connects its socket, and seats it. */
export async function createCampaignAs(
  server: TestServer,
  gm: AccountFixture,
  name = 'Test Campaign',
): Promise<{ client: TestClient; campaignId: string; state: RoomState }> {
  const record = server.campaigns.createCampaign(gm.id, gm.username, name);
  const client = await TestClient.connect(server.url, gm.token);
  const state = client.next<RoomState>(CHANNEL.roomState);
  client.emit(CHANNEL.joinCampaign, { campaignId: record.id });
  return { client, campaignId: record.id, state: await state };
}

/** Adds `player` as a member of `campaignId` and connects/seats their socket. */
export async function joinCampaignAs(
  server: TestServer,
  gm: AccountFixture,
  campaignId: string,
  player: AccountFixture,
): Promise<{ client: TestClient; state: RoomState }> {
  server.campaigns.addMember(campaignId, gm.id, player.id);
  const client = await TestClient.connect(server.url, player.token);
  const state = client.next<RoomState>(CHANNEL.roomState);
  client.emit(CHANNEL.joinCampaign, { campaignId });
  return { client, state: await state };
}

export type { RoomPatch };
```

- [ ] **Step 2: Rewrite `integration.test.ts`**

Replace the entire contents of `apps/server/test/integration.test.ts` with:

```ts
import { CHANNEL, type RoomPatch, type RoomState } from '@daggerheart/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  accountFor,
  buildSheet,
  createCampaignAs,
  joinCampaignAs,
  startTestServer,
  TestClient,
  type TestServer,
} from './helpers.js';

describe('campaign lifecycle over a socket', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it('creates a campaign and seats its owner as GM', async () => {
    const gm = await accountFor(server, 'gm', 'gm');
    const { client, state } = await createCampaignAs(server, gm, 'The Campaign');

    expect(state.gm.id).toBe(gm.id);
    expect(state.gm.name).toBe('gm');
    expect(state.fear).toBe(0);
    expect(state.players).toEqual([]);

    client.close();
  });

  it('rejects joining a campaign the account is not a member of', async () => {
    const gm = await accountFor(server, 'gm2', 'gm');
    const stranger = await accountFor(server, 'stranger');
    const campaign = server.campaigns.createCampaign(gm.id, gm.username, 'Private');

    const client = await TestClient.connect(server.url, stranger.token);
    const rejected = client.next<{ error: string }>(CHANNEL.rejected);
    client.emit(CHANNEL.joinCampaign, { campaignId: campaign.id });

    expect((await rejected).error).toBe('forbidden');
    client.close();
  });

  it('rejects malformed messages instead of crashing', async () => {
    const gm = await accountFor(server, 'gm3', 'gm');
    const client = await TestClient.connect(server.url, gm.token);
    const rejected = client.next<{ error: string }>(CHANNEL.rejected);
    client.emit(CHANNEL.joinCampaign, { campaignId: 123 });

    expect((await rejected).error).toBe('badRequest');
    client.close();
  });

  it('disconnects a socket with no valid login token', async () => {
    await expect(TestClient.connect(server.url, 'not-a-real-token')).rejects.toBeDefined();
  });

  it('broadcasts one client’s damage to the other within a single broadcast', async () => {
    const gm = await accountFor(server, 'gm4', 'gm');
    const alicePlayer = await accountFor(server, 'alice4');
    const bobPlayer = await accountFor(server, 'bob4');
    const { client: gmClient, campaignId } = await createCampaignAs(server, gm, 'Damage Test');
    const alice = await joinCampaignAs(server, gm, campaignId, alicePlayer);
    const bob = await joinCampaignAs(server, gm, campaignId, bobPlayer);

    const sheet = buildSheet('guardian');
    const claimed = bob.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => p.characters?.[alicePlayer.id] !== undefined,
    );
    alice.client.emit(CHANNEL.claimCharacter, { sheet });
    await claimed;

    const thresholds = sheet.character.thresholds;

    const bobSees = bob.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.characters?.[alicePlayer.id]?.hpMarked ?? 0) > 0,
    );
    alice.client.emit(CHANNEL.intent, {
      type: 'takeDamage',
      characterId: alicePlayer.id,
      incoming: thresholds.severe,
      damageType: 'physical',
      direct: false,
      armorSlotsToMark: 0,
    });

    const patch = await bobSees;
    expect(patch.characters?.[alicePlayer.id]?.hpMarked).toBe(3);
    expect(server.campaigns.get(campaignId)?.state.characters[alicePlayer.id]?.hpMarked).toBe(3);

    gmClient.close();
    alice.client.close();
    bob.client.close();
  });

  it('computes damage server-side rather than trusting a client-sent result', async () => {
    const gm = await accountFor(server, 'gm5', 'gm');
    const alicePlayer = await accountFor(server, 'alice5');
    const { client: gmClient, campaignId } = await createCampaignAs(server, gm, 'Server Damage');
    const alice = await joinCampaignAs(server, gm, campaignId, alicePlayer);

    const sheet = buildSheet('guardian');
    const claimed = gmClient.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => p.characters?.[alicePlayer.id] !== undefined,
    );
    alice.client.emit(CHANNEL.claimCharacter, { sheet });
    await claimed;

    const seen = gmClient.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.characters?.[alicePlayer.id]?.hpMarked ?? 0) > 0,
    );
    alice.client.emit(CHANNEL.intent, {
      type: 'takeDamage',
      characterId: alicePlayer.id,
      incoming: Math.max(1, sheet.character.thresholds.major - 1),
      damageType: 'physical',
      direct: false,
      armorSlotsToMark: 0,
      hpMarked: 0,
    });

    expect((await seen).characters?.[alicePlayer.id]?.hpMarked).toBe(1);

    gmClient.close();
    alice.client.close();
  });

  it('rejects a player mutating a character they do not own, changing nothing', async () => {
    const gm = await accountFor(server, 'gm6', 'gm');
    const alicePlayer = await accountFor(server, 'alice6');
    const bobPlayer = await accountFor(server, 'bob6');
    const { client: gmClient, campaignId } = await createCampaignAs(server, gm, 'Ownership Test');
    const alice = await joinCampaignAs(server, gm, campaignId, alicePlayer);
    const bob = await joinCampaignAs(server, gm, campaignId, bobPlayer);

    const claimed = bob.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => p.characters?.[alicePlayer.id] !== undefined,
    );
    alice.client.emit(CHANNEL.claimCharacter, { sheet: buildSheet() });
    await claimed;

    const before = server.campaigns.get(campaignId)?.state.characters[alicePlayer.id]?.hpMarked;

    const rejected = bob.client.next<{ error: string }>(CHANNEL.rejected);
    bob.client.emit(CHANNEL.intent, { type: 'markHP', characterId: alicePlayer.id, amount: 3 });

    expect((await rejected).error).toBe('notYourCharacter');
    expect(server.campaigns.get(campaignId)?.state.characters[alicePlayer.id]?.hpMarked).toBe(before);

    gmClient.close();
    alice.client.close();
    bob.client.close();
  });

  it('rejects spendFear from a non-GM client', async () => {
    const gm = await accountFor(server, 'gm7', 'gm');
    const alicePlayer = await accountFor(server, 'alice7');
    const { client: gmClient, campaignId } = await createCampaignAs(server, gm, 'Fear Test');
    const alice = await joinCampaignAs(server, gm, campaignId, alicePlayer);

    const gained = alice.client.until<RoomPatch>(CHANNEL.roomPatch, (p) => p.fear !== undefined);
    gmClient.emit(CHANNEL.intent, { type: 'gainFear', amount: 3 });
    expect((await gained).fear).toBe(3);

    const rejected = alice.client.next<{ error: string }>(CHANNEL.rejected);
    alice.client.emit(CHANNEL.intent, { type: 'spendFear', amount: 1 });

    expect((await rejected).error).toBe('notGameMaster');
    expect(server.campaigns.get(campaignId)?.state.fear).toBe(3);

    gmClient.close();
    alice.client.close();
  });

  it('lets only the GM change spotlight, countdowns, adversaries, and environment', async () => {
    const gm = await accountFor(server, 'gm8', 'gm');
    const alicePlayer = await accountFor(server, 'alice8');
    const { client: gmClient, campaignId } = await createCampaignAs(server, gm, 'GM Only Test');
    const alice = await joinCampaignAs(server, gm, campaignId, alicePlayer);

    const gmOnlyIntents: unknown[] = [
      { type: 'setSpotlight', spotlight: 'someone' },
      { type: 'setEnvironment', environmentId: 'raging-river' },
      { type: 'addCountdown', id: 'c1', name: 'Alarm', kind: 'standard', startingValue: 3, loop: 'none' },
      { type: 'addAdversary', instanceId: 'a1', adversaryId: 'courtier', name: 'Courtier' },
    ];

    for (const intent of gmOnlyIntents) {
      const rejected = alice.client.next<{ error: string }>(CHANNEL.rejected);
      alice.client.emit(CHANNEL.intent, intent);
      expect((await rejected).error, JSON.stringify(intent)).toBe('notGameMaster');
    }

    gmClient.close();
    alice.client.close();
  });

  it('reflects presence when a client disconnects, and lets it rejoin later', async () => {
    const gm = await accountFor(server, 'gm9', 'gm');
    const alicePlayer = await accountFor(server, 'alice9');
    const { client: gmClient, campaignId } = await createCampaignAs(server, gm, 'Reconnect Test');
    const alice = await joinCampaignAs(server, gm, campaignId, alicePlayer);

    const claimed = gmClient.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => p.characters?.[alicePlayer.id] !== undefined,
    );
    alice.client.emit(CHANNEL.claimCharacter, { sheet: buildSheet() });
    await claimed;

    const stressed = gmClient.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.characters?.[alicePlayer.id]?.stressMarked ?? 0) === 2,
    );
    alice.client.emit(CHANNEL.intent, { type: 'markStress', characterId: alicePlayer.id, amount: 2 });
    await stressed;

    const disconnected = gmClient.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => p.players?.some((player) => !player.connected) === true,
    );
    alice.client.close();
    const presence = await disconnected;
    expect(presence.players?.find((p) => p.id === alicePlayer.id)?.connected).toBe(false);

    // Logging back in with the same account and rejoining the same campaign
    // restores the same seat and the campaign's whole current state.
    const returning = await TestClient.connect(server.url, alicePlayer.token);
    const full = returning.next<RoomState>(CHANNEL.roomState);
    returning.emit(CHANNEL.joinCampaign, { campaignId });

    const state = await full;
    expect(state.characters[alicePlayer.id]?.stressMarked).toBe(2);
    expect(state.players.find((p) => p.id === alicePlayer.id)?.connected).toBe(true);
    expect(state.id).toBe(campaignId);

    gmClient.close();
    returning.close();
  });

  it('broadcasts rolls to the whole table with the roller’s name', async () => {
    const gm = await accountFor(server, 'gm10', 'gm');
    const alicePlayer = await accountFor(server, 'alice10');
    const { client: gmClient, campaignId } = await createCampaignAs(server, gm, 'Rolls Test');
    const alice = await joinCampaignAs(server, gm, campaignId, alicePlayer);

    const claimed = gmClient.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => p.characters?.[alicePlayer.id] !== undefined,
    );
    alice.client.emit(CHANNEL.claimCharacter, { sheet: buildSheet() });
    await claimed;

    const rolled = gmClient.next<{ entries: { by: string; kind: string }[] }>(CHANNEL.rolled);
    alice.client.emit(CHANNEL.intent, {
      type: 'rollDuality',
      characterId: alicePlayer.id,
      request: {
        label: 'Agility Roll',
        modifiers: 2,
        difficulty: 12,
        advantage: 0,
        disadvantage: 0,
        experiences: [],
      },
    });

    const entries = (await rolled).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.by).toBe('alice10');
    expect(entries[0]?.kind).toBe('duality');

    gmClient.close();
    alice.client.close();
  });
});
```

- [ ] **Step 3: Rewrite `map.test.ts`**

Replace the entire contents of `apps/server/test/map.test.ts` with:

```ts
import { CHANNEL, type RoomPatch, type RoomState, type Token } from '@daggerheart/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { accountFor, createCampaignAs, joinCampaignAs, startTestServer, type TestServer } from './helpers.js';

const token = (over: Partial<Token> = {}): Token => ({
  id: 'tok-1',
  kind: 'pc',
  refId: 'pc1',
  name: 'Alice',
  x: 100,
  y: 100,
  width: 50,
  height: 50,
  rotation: 0,
  ownerId: null,
  hidden: false,
  showRings: false,
  color: '#e2b857',
  ...over,
});

/** Sets up a campaign with one scene and one player, returning both clients. */
async function tableWithScene(server: TestServer, suffix: string) {
  const gm = await accountFor(server, `gm-map-${suffix}`, 'gm');
  const alicePlayer = await accountFor(server, `alice-map-${suffix}`);
  const { client: gmClient, campaignId } = await createCampaignAs(server, gm, 'Map Test');
  const player = await joinCampaignAs(server, gm, campaignId, alicePlayer);

  const created = player.client.until<RoomPatch>(CHANNEL.roomPatch, (p) => (p.map?.scenes.length ?? 0) > 0);
  gmClient.emit(CHANNEL.intent, { type: 'addScene', id: 'scene-1', name: 'The Bridge' });
  await created;

  return { gm, gmClient, player, campaignId, playerId: alicePlayer.id };
}

describe('map sync', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it('broadcasts a GM token move to a connected player', async () => {
    const { gmClient, player, campaignId } = await tableWithScene(server, 'a');

    const added = player.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.map?.scenes[0]?.tokens.length ?? 0) > 0,
    );
    gmClient.emit(CHANNEL.intent, { type: 'addToken', sceneId: 'scene-1', token: token() });
    await added;

    const moved = player.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => p.map?.scenes[0]?.tokens[0]?.x === 400,
    );
    gmClient.emit(CHANNEL.intent, {
      type: 'moveToken',
      sceneId: 'scene-1',
      tokenId: 'tok-1',
      x: 400,
      y: 250,
      commit: true,
    });

    const patch = await moved;
    expect(patch.map?.scenes[0]?.tokens[0]).toMatchObject({ x: 400, y: 250 });
    const scene = server.campaigns.get(campaignId)?.state.map.scenes[0];
    expect(scene?.tokens[0]).toMatchObject({ x: 400, y: 250 });

    gmClient.close();
    player.client.close();
  });

  it('lets a player move only the token they own', async () => {
    const { gmClient, player, campaignId, playerId } = await tableWithScene(server, 'b');

    const added = player.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.map?.scenes[0]?.tokens.length ?? 0) > 0,
    );
    gmClient.emit(CHANNEL.intent, {
      type: 'addToken',
      sceneId: 'scene-1',
      token: token({ ownerId: playerId }),
    });
    await added;

    const moved = gmClient.until<RoomPatch>(CHANNEL.roomPatch, (p) => p.map?.scenes[0]?.tokens[0]?.x === 220);
    player.client.emit(CHANNEL.intent, {
      type: 'moveToken',
      sceneId: 'scene-1',
      tokenId: 'tok-1',
      x: 220,
      y: 180,
      commit: true,
    });
    await moved;

    expect(server.campaigns.get(campaignId)?.state.map.scenes[0]?.tokens[0]).toMatchObject({
      x: 220,
      y: 180,
    });

    gmClient.close();
    player.client.close();
  });

  it('rejects a player moving a token they do not own, changing nothing', async () => {
    const { gmClient, player, campaignId } = await tableWithScene(server, 'c');

    const added = player.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.map?.scenes[0]?.tokens.length ?? 0) > 0,
    );
    gmClient.emit(CHANNEL.intent, { type: 'addToken', sceneId: 'scene-1', token: token() });
    await added;

    const before = server.campaigns.get(campaignId)?.state.map.scenes[0]?.tokens[0];

    const rejected = player.client.next<{ error: string }>(CHANNEL.rejected);
    player.client.emit(CHANNEL.intent, {
      type: 'moveToken',
      sceneId: 'scene-1',
      tokenId: 'tok-1',
      x: 999,
      y: 999,
      commit: true,
    });

    expect((await rejected).error).toBe('notYourToken');
    expect(server.campaigns.get(campaignId)?.state.map.scenes[0]?.tokens[0]).toEqual(before);

    gmClient.close();
    player.client.close();
  });

  it('rejects every other map mutation from a player', async () => {
    const { gmClient, player } = await tableWithScene(server, 'd');

    const playerIntents: unknown[] = [
      { type: 'addScene', id: 'sneaky', name: 'Sneaky' },
      { type: 'removeScene', id: 'scene-1' },
      { type: 'setActiveScene', id: null },
      { type: 'addToken', sceneId: 'scene-1', token: token({ id: 'tok-x' }) },
      { type: 'removeToken', sceneId: 'scene-1', tokenId: 'tok-1' },
      { type: 'paintFog', sceneId: 'scene-1', x: 0, y: 0, radius: 50, reveal: true },
      { type: 'setFogEnabled', sceneId: 'scene-1', enabled: false },
    ];

    for (const intent of playerIntents) {
      const rejected = player.client.next<{ error: string }>(CHANNEL.rejected);
      player.client.emit(CHANNEL.intent, intent);
      expect((await rejected).error, JSON.stringify(intent)).toBe('notGameMaster');
    }

    gmClient.close();
    player.client.close();
  });

  it('sends players revealed fog only, never the unrevealed regions', async () => {
    const { gmClient, player, campaignId } = await tableWithScene(server, 'e');

    const sized = gmClient.until<RoomPatch>(CHANNEL.roomPatch, (p) => (p.map?.scenes[0]?.fog.cols ?? 0) > 0);
    gmClient.emit(CHANNEL.intent, {
      type: 'setSceneImage',
      sceneId: 'scene-1',
      image: { url: '/uploads/test.png', width: 1000, height: 1000 },
    });
    gmClient.emit(CHANNEL.intent, { type: 'setFogEnabled', sceneId: 'scene-1', enabled: true });
    await sized;

    const revealed = player.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.map?.scenes[0]?.fog.revealed.length ?? 0) > 0,
    );
    gmClient.emit(CHANNEL.intent, { type: 'paintFog', sceneId: 'scene-1', x: 100, y: 100, radius: 60, reveal: true });

    const patch = await revealed;
    const playerFog = patch.map?.scenes[0]?.fog;
    expect(playerFog).toBeDefined();
    if (playerFog === undefined) return;

    expect(playerFog.revealed.length).toBeGreaterThan(0);
    expect(playerFog.revealed.length).toBeLessThan(playerFog.cols * playerFog.rows);

    const serverFog = server.campaigns.get(campaignId)?.state.map.scenes[0]?.fog;
    expect(serverFog?.revealed).toEqual(playerFog.revealed);

    gmClient.close();
    player.client.close();
  });

  it('never sends players an inactive scene or a GM-only token', async () => {
    const gm = await accountFor(server, 'gm-map-f', 'gm');
    const alicePlayer = await accountFor(server, 'alice-map-f');
    const { client: gmClient, campaignId } = await createCampaignAs(server, gm, 'Hidden Scene Test');
    const player = await joinCampaignAs(server, gm, campaignId, alicePlayer);

    const ready = player.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.map?.scenes[0]?.tokens.length ?? 0) > 0,
    );
    gmClient.emit(CHANNEL.intent, { type: 'addScene', id: 'visible', name: 'Visible' });
    gmClient.emit(CHANNEL.intent, { type: 'addScene', id: 'secret', name: 'Secret Lair' });
    gmClient.emit(CHANNEL.intent, { type: 'addToken', sceneId: 'visible', token: token({ id: 'seen', name: 'Seen' }) });
    gmClient.emit(CHANNEL.intent, {
      type: 'addToken',
      sceneId: 'visible',
      token: token({ id: 'ambush', name: 'Ambusher', hidden: true }),
    });
    const patch = await ready;

    const serialized = JSON.stringify(patch);
    expect(serialized).not.toContain('Secret Lair');
    expect(serialized).not.toContain('Ambusher');
    expect(patch.map?.scenes).toHaveLength(1);
    expect(patch.map?.scenes[0]?.tokens.map((t) => t.id)).toEqual(['seen']);

    const gmState = server.campaigns.get(campaignId)?.state;
    expect(gmState?.map.scenes).toHaveLength(2);

    gmClient.close();
    player.client.close();
  });

  it('broadcasts only the newly active scene when the GM switches', async () => {
    const gm = await accountFor(server, 'gm-map-g', 'gm');
    const alicePlayer = await accountFor(server, 'alice-map-g');
    const { client: gmClient, campaignId } = await createCampaignAs(server, gm, 'Switch Scene Test');
    const player = await joinCampaignAs(server, gm, campaignId, alicePlayer);

    gmClient.emit(CHANNEL.intent, { type: 'addScene', id: 'one', name: 'Scene One' });
    const second = player.client.until<RoomPatch>(CHANNEL.roomPatch, (p) => p.map?.scenes[0]?.id === 'one');
    gmClient.emit(CHANNEL.intent, { type: 'addScene', id: 'two', name: 'Scene Two' });
    await second;

    const switched = player.client.until<RoomPatch>(CHANNEL.roomPatch, (p) => p.map?.activeSceneId === 'two');
    gmClient.emit(CHANNEL.intent, { type: 'setActiveScene', id: 'two' });

    const patch = await switched;
    expect(patch.map?.scenes).toHaveLength(1);
    expect(patch.map?.scenes[0]?.name).toBe('Scene Two');
    expect(JSON.stringify(patch)).not.toContain('Scene One');

    gmClient.close();
    player.client.close();
    void campaignId;
  });

  it('rejects a move on a scene that is not active', async () => {
    const { gmClient, player, playerId } = await tableWithScene(server, 'h');

    gmClient.emit(CHANNEL.intent, { type: 'addToken', sceneId: 'scene-1', token: token({ ownerId: playerId }) });
    const switched = gmClient.until<RoomPatch>(CHANNEL.roomPatch, (p) => p.map?.activeSceneId === 'other');
    gmClient.emit(CHANNEL.intent, { type: 'addScene', id: 'other', name: 'Elsewhere' });
    gmClient.emit(CHANNEL.intent, { type: 'setActiveScene', id: 'other' });
    await switched;

    const rejected = player.client.next<{ error: string }>(CHANNEL.rejected);
    player.client.emit(CHANNEL.intent, { type: 'moveToken', sceneId: 'scene-1', tokenId: 'tok-1', x: 10, y: 10, commit: true });
    expect((await rejected).error).toBe('unknownScene');

    gmClient.close();
    player.client.close();
  });

  it('includes the map in the full state a reconnecting client receives', async () => {
    const { gm, gmClient, player, campaignId } = await tableWithScene(server, 'i');
    gmClient.emit(CHANNEL.intent, { type: 'addToken', sceneId: 'scene-1', token: token() });

    const seen = player.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.map?.scenes[0]?.tokens.length ?? 0) > 0,
    );
    await seen;

    const late = await accountFor(server, 'late-i');
    const returning = await joinCampaignAs(server, gm, campaignId, late);
    const state: RoomState = returning.state;
    expect(state.map.scenes).toHaveLength(1);
    expect(state.map.scenes[0]?.tokens).toHaveLength(1);

    gmClient.close();
    player.client.close();
    returning.client.close();
  });
});
```

- [ ] **Step 4: Rewrite `rolls.test.ts`**

Replace the entire contents of `apps/server/test/rolls.test.ts` with:

```ts
import { createSheet, makeDualityRoll } from '@daggerheart/protocol';
import { resolveActionRoll, rollDuality, seededRng } from '@daggerheart/rules';
import { describe, expect, it } from 'vitest';

import { CampaignStore, rngForRoll } from '../src/campaigns.js';
import { buildCharacter, buildSheet } from './helpers.js';

describe('server-side dice', () => {
  it('produces the identical result to the same call in the rules package', () => {
    const seed = 987;
    const request = {
      label: 'Agility Roll',
      modifiers: 3,
      difficulty: 12,
      advantage: 1,
      disadvantage: 0,
      experiences: [],
    };

    const expected = rollDuality({
      modifiers: request.modifiers,
      advantage: request.advantage,
      disadvantage: request.disadvantage,
      rng: seededRng(seed),
    });
    const expectedOutcome = resolveActionRoll(expected, request.difficulty);

    const sheet = createSheet(buildCharacter('ranger'));
    const actual = makeDualityRoll(sheet, request, rngForRoll(seed, 0));

    expect(actual.outcome).not.toBeNull();
    expect(actual.outcome?.roll).toEqual(expected);
    expect(actual.outcome?.result.outcome).toBe(expectedOutcome.outcome);
  });

  it('is reproducible: the same (seed, index) always rolls the same dice', () => {
    const first = rollDuality({ rng: rngForRoll(42, 7) });
    const second = rollDuality({ rng: rngForRoll(42, 7) });
    expect(first).toEqual(second);
  });

  it('advances the dice between rolls so a campaign does not repeat itself', () => {
    const store = new CampaignStore();
    const campaign = store.createCampaign('u-gm', 'gm', 'Dice Test', 555);
    store.addMember(campaign.id, 'u-gm', 'u-player');
    store.seatFor(campaign.id, 'u-player', 'player');
    store.claimCharacter(campaign.id, 'u-player', buildSheet('ranger'));

    const roll = () => {
      const outcome = store.apply(campaign.id, { id: 'u-player', role: 'player' }, {
        type: 'rollDuality',
        characterId: 'u-player',
        request: { label: 'Roll', modifiers: 0, difficulty: 10, advantage: 0, disadvantage: 0, experiences: [] },
      });
      const entry = outcome.entries[0];
      if (entry === undefined || entry.kind !== 'duality') throw new Error('no roll');
      return entry.roll;
    };

    const rolls = [roll(), roll(), roll()];
    expect(store.get(campaign.id)?.rollCount).toBe(3);
    expect(new Set(rolls.map((r) => `${r.hope}-${r.fear}`)).size).toBeGreaterThan(1);
  });

  it('replays a logged roll from its seed and index for auditing', () => {
    const store = new CampaignStore();
    const campaign = store.createCampaign('u-gm', 'gm', 'Audit Test', 2024);
    store.addMember(campaign.id, 'u-gm', 'u-player');
    store.seatFor(campaign.id, 'u-player', 'player');
    store.claimCharacter(campaign.id, 'u-player', buildSheet());

    const outcome = store.apply(campaign.id, { id: 'u-player', role: 'player' }, {
      type: 'rollDuality',
      characterId: 'u-player',
      request: { label: 'Audit', modifiers: 0, difficulty: 10, advantage: 0, disadvantage: 0, experiences: [] },
    });

    const entry = outcome.entries[0];
    if (entry === undefined || entry.kind !== 'duality') throw new Error('no roll');
    expect(rollDuality({ rng: rngForRoll(2024, 0) })).toEqual(entry.roll);
  });
});

describe('campaign ids', () => {
  it('never issues the same id to two live campaigns', () => {
    const store = new CampaignStore();
    const ids = new Set<string>();
    for (let i = 0; i < 30; i++) ids.add(store.createCampaign(`u-gm-${i}`, `gm-${i}`, `Campaign ${i}`).id);
    expect(ids.size).toBe(30);
  });
});
```

- [ ] **Step 5: Run the whole server suite**

Run: `pnpm -F @daggerheart/server test`
Expected: every test file passes — `campaigns.test.ts`, `campaigns-http.test.ts`, `uploads.test.ts`, `users.test.ts`, `auth-http.test.ts` (all untouched by this task, should already be green), plus the four rewritten in this task.

Run: `pnpm -F @daggerheart/server typecheck`
Expected: clean — this is the point where `apps/server` as a whole compiles again.

- [ ] **Step 6: Commit**

```bash
git add apps/server/test/helpers.ts apps/server/test/integration.test.ts apps/server/test/map.test.ts apps/server/test/rolls.test.ts
git commit -m "test(server): rewrite room/map/rolls tests for account-based campaign membership"
```

---

### Task 7: Web — trim `storage.ts` to the campaign-scoped creation draft only

**Files:**
- Modify: `apps/web/src/state/storage.ts` (full rewrite)
- Modify: `apps/web/src/state/useCreation.ts`
- Modify: `apps/web/test/storage.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `saveCreation(storage, campaignId, state)`, `loadCreation(storage, campaignId)`, `clearCreation(storage, campaignId)` — signatures now take a `campaignId`, consumed by Task 10 (`WizardRoute.tsx`) and `useCreation.ts` in this task.

- [ ] **Step 1: Replace `storage.ts`**

Replace the entire contents of `apps/web/src/state/storage.ts` with:

```ts
import { deserialize, serialize, type CreationState } from '@daggerheart/character';

/**
 * localStorage persistence for an in-progress character creation only. The
 * finished character itself is never stored locally — it is claimed straight into
 * the campaign it was created for (see `useCampaign`'s `claimCharacter`).
 *
 * Draft state is scoped per campaign, so switching between campaigns (or starting a
 * second character in a different one) never clobbers another campaign's progress.
 */

const KEY_PREFIX = 'daggerheart-vtt';

const inProgressKey = (campaignId: string): string => `${KEY_PREFIX}:creation:${campaignId}`;

/** The browser storage this module reads and writes. Injected so tests can fake it. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Persists an in-progress creation so a reload resumes at the same step. */
export function saveCreation(storage: StorageLike, campaignId: string, state: CreationState): void {
  storage.setItem(inProgressKey(campaignId), serialize(state));
}

/** Restores an in-progress creation, or null if there is none or it is unreadable. */
export function loadCreation(storage: StorageLike, campaignId: string): CreationState | null {
  const raw = storage.getItem(inProgressKey(campaignId));
  if (raw === null) return null;
  try {
    return deserialize(raw);
  } catch {
    return null;
  }
}

export function clearCreation(storage: StorageLike, campaignId: string): void {
  storage.removeItem(inProgressKey(campaignId));
}
```

- [ ] **Step 2: Update `useCreation.ts` to take a `campaignId`**

Replace the entire contents of `apps/web/src/state/useCreation.ts` with:

```ts
import {
  applyChoice,
  createInitialState,
  validateStep,
  type CreationAction,
  type CreationState,
  type Step,
  type ValidationError,
} from '@daggerheart/character';
import { useCallback, useEffect, useState } from 'react';

import { clearCreation, loadCreation, saveCreation, type StorageLike } from './storage.js';

/**
 * Holds the wizard's state for one campaign's character. Every change goes through
 * `applyChoice`, so the reducer remains the single source of truth.
 */
export function useCreation(storage: StorageLike, campaignId: string) {
  const [state, setState] = useState<CreationState>(
    () => loadCreation(storage, campaignId) ?? createInitialState(),
  );

  // Auto-save after every change so a reload resumes exactly where it left off.
  useEffect(() => {
    saveCreation(storage, campaignId, state);
  }, [storage, campaignId, state]);

  const dispatch = useCallback((action: CreationAction) => {
    setState((current) => applyChoice(current, action));
  }, []);

  const reset = useCallback(() => {
    clearCreation(storage, campaignId);
    setState(createInitialState());
  }, [storage, campaignId]);

  const discard = useCallback(() => {
    clearCreation(storage, campaignId);
  }, [storage, campaignId]);

  return { state, dispatch, reset, discard };
}

/** Validation errors for a step, keyed by the field they belong to. */
export function errorsByField(errors: readonly ValidationError[]): Map<string, ValidationError[]> {
  const map = new Map<string, ValidationError[]>();
  for (const error of errors) {
    const key = error.field ?? '';
    const existing = map.get(key);
    if (existing) existing.push(error);
    else map.set(key, [error]);
  }
  return map;
}

/** Errors attached to one field, for rendering inline beneath it. */
export function fieldErrors(errors: readonly ValidationError[], field: string): readonly ValidationError[] {
  return errors.filter((e) => e.field === field);
}
```

- [ ] **Step 3: Trim `storage.test.ts`**

Replace the entire contents of `apps/web/test/storage.test.ts` with:

```ts
import { applyChoice, validateStep } from '@daggerheart/character';
import { describe, expect, it } from 'vitest';

import { clearCreation, loadCreation, saveCreation } from '../src/state/storage.js';
import { buildCreationState, fakeStorage } from './helpers.js';

describe('creation persistence', () => {
  it('resumes an in-progress creation at the same step with choices intact', () => {
    const storage = fakeStorage();

    let state = buildCreationState('bard');
    state = applyChoice(state, {
      type: 'assignTraits',
      traits: { agility: 0, strength: 0, finesse: 0, instinct: 0, presence: 0, knowledge: 0 },
    });
    state = applyChoice(state, { type: 'goToStep', step: 3 });
    saveCreation(storage, 'campaign-1', state);

    const resumed = loadCreation(storage, 'campaign-1');
    expect(resumed).not.toBeNull();
    if (resumed === null) return;

    expect(resumed.currentStep).toBe(3);
    expect(resumed.classId).toBe('bard');
    expect(resumed.subclassId).toBe(state.subclassId);
    expect(resumed.heritage).toEqual(state.heritage);
    expect(resumed.domainCardIds).toEqual(state.domainCardIds);
    expect(validateStep(resumed, 3).ok).toBe(false);
  });

  it('scopes drafts per campaign: one campaign\'s draft never leaks into another', () => {
    const storage = fakeStorage();
    saveCreation(storage, 'campaign-1', buildCreationState('bard'));

    expect(loadCreation(storage, 'campaign-2')).toBeNull();
    expect(loadCreation(storage, 'campaign-1')).not.toBeNull();
  });

  it('returns null when there is nothing saved', () => {
    expect(loadCreation(fakeStorage(), 'campaign-1')).toBeNull();
  });

  it('returns null rather than throwing on a corrupt payload', () => {
    const storage = fakeStorage({ 'daggerheart-vtt:creation:campaign-1': '{not json' });
    expect(loadCreation(storage, 'campaign-1')).toBeNull();
  });

  it('clears a finished creation', () => {
    const storage = fakeStorage();
    saveCreation(storage, 'campaign-1', buildCreationState());
    expect(loadCreation(storage, 'campaign-1')).not.toBeNull();
    clearCreation(storage, 'campaign-1');
    expect(loadCreation(storage, 'campaign-1')).toBeNull();
  });
});
```

- [ ] **Step 4: Run the tests**

Run: `pnpm -F @daggerheart/web test storage`
Expected: all pass.

Run: `pnpm -F @daggerheart/web typecheck`
Expected: `storage.ts`/`useCreation.ts` themselves are clean. `useCharacters.ts`, `CharactersRoute.tsx`, `WizardRoute.tsx`, `App.tsx`, `render.test.tsx` still fail (they still import the now-removed character-library exports, and `WizardRoute`/`useCreation` call sites haven't been updated for the new `campaignId` parameter yet) — that is Tasks 9–12. Confirm no error originates in `storage.ts`/`useCreation.ts`/`storage.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/state/storage.ts apps/web/src/state/useCreation.ts apps/web/test/storage.test.ts
git commit -m "refactor(web): scope the creation draft to a campaign, remove the local character library"
```

---

### Task 8: Web — `useCampaign` hook

**Files:**
- Create: `apps/web/src/state/useCampaign.ts`
- Delete: `apps/web/src/state/useRoom.ts`
- Delete: `apps/web/src/state/useCharacters.ts`

**Interfaces:**
- Consumes: `CHANNEL`, `RejectedSchema`, `RolledSchema`, `RoomPatchSchema`, `RoomStateSchema`, `applyRoomPatch`, `type RoomEvent`, `type RoomState`, `type SheetState`, `CampaignSummarySchema`, `type CampaignSummary` from `@daggerheart/protocol` (Task 1); `SERVER_URL`-equivalent constant (redefined here, since `useRoom.ts` — where it previously lived — is deleted); the logged-in account's token (passed in from `useAuth`, Phase A).
- Produces: `useCampaign(storage, token): CampaignConnection` with `{ status, campaigns, room, role, error, refreshCampaigns, createCampaign(name), addPlayer(campaignId, username), removePlayer(campaignId, userId), join(campaignId), claimCharacter(sheet), send(event), leave() }`, consumed by Task 9 (`CampaignsRoute`), Task 10 (`WizardRoute`'s finish step), Task 11 (`App.tsx`, `GMPanel`, `MapRoute`, `SheetRoute`).

- [ ] **Step 1: Delete the files this task replaces**

```bash
git rm apps/web/src/state/useRoom.ts apps/web/src/state/useCharacters.ts
```

- [ ] **Step 2: Write `useCampaign.ts`**

Create `apps/web/src/state/useCampaign.ts`:

```ts
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
```

- [ ] **Step 3: Typecheck**

Run: `pnpm -F @daggerheart/web typecheck`
Expected: `useCampaign.ts` itself compiles cleanly. `App.tsx`, `WizardRoute.tsx`, `CampaignRoute.tsx`/its render test, and `apps/web/src/components/gm/GMPanel.tsx` still fail — Tasks 9–12. Confirm no error originates in `useCampaign.ts`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/state/useCampaign.ts
git commit -m "feat(web): add useCampaign, replacing useRoom and the local character library"
```

---

### Task 9: Web — `CampaignsRoute` replaces `CampaignRoute`

**Files:**
- Create: `apps/web/src/routes/CampaignsRoute.tsx`
- Delete: `apps/web/src/routes/CampaignRoute.tsx`
- Delete: `apps/web/src/routes/CharactersRoute.tsx`

**Interfaces:**
- Consumes: `type CampaignSummary` from `@daggerheart/protocol`; the relevant slice of `CampaignConnection` from Task 8 (`campaigns`, `role`'s absence here is fine — this route only needs `createCampaign`/`addPlayer`/`removePlayer`/`join`, plus knowing which account is viewing to label "owned by you" — that comes from the caller).
- Produces: `CampaignsRoute` component, consumed by Task 11 (`App.tsx`).

- [ ] **Step 1: Delete the files this task replaces**

```bash
git rm apps/web/src/routes/CampaignRoute.tsx apps/web/src/routes/CharactersRoute.tsx
```

- [ ] **Step 2: Write `CampaignsRoute.tsx`**

Create `apps/web/src/routes/CampaignsRoute.tsx`:

```tsx
import type { CampaignSummary } from '@daggerheart/protocol';
import { useState } from 'react';

interface CampaignsRouteProps {
  accountId: string;
  campaigns: readonly CampaignSummary[];
  error: string | null;
  onCreate: (name: string) => void;
  onJoin: (campaignId: string) => void;
  onAddPlayer: (campaignId: string, username: string) => void;
}

/** Lists the campaigns this account owns or belongs to, and offers to create one. */
export function CampaignsRoute({
  accountId,
  campaigns,
  error,
  onCreate,
  onJoin,
  onAddPlayer,
}: CampaignsRouteProps) {
  const [name, setName] = useState('');
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [username, setUsername] = useState('');

  return (
    <section>
      <div className="hero">
        <h1>Campañas</h1>
        <p className="muted">Elige una campaña para entrar, o crea una nueva.</p>
      </div>

      {error !== null ? <div className="errors">{error}</div> : null}

      <div className="panel">
        <h2>Crear una campaña</h2>
        <label htmlFor="campaign-name">Nombre</label>
        <input
          id="campaign-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Grupo del martes"
        />
        <div className="mt-3">
          <button
            type="button"
            disabled={name.trim() === ''}
            onClick={() => {
              onCreate(name.trim());
              setName('');
            }}
          >
            Crear campaña
          </button>
        </div>
      </div>

      {campaigns.length === 0 ? (
        <div className="panel">
          <p className="muted">Todavía no perteneces a ninguna campaña.</p>
        </div>
      ) : (
        <div className="grid cols-2">
          {campaigns.map((campaign) => (
            <div className="panel" key={campaign.id}>
              <div className="card-head">
                <h2>{campaign.name}</h2>
                {campaign.ownerId === accountId ? <span className="badge">DJ</span> : null}
              </div>
              <p className="muted">
                {campaign.ownerId === accountId
                  ? `${campaign.memberIds.length} jugador(es)`
                  : `DJ: ${campaign.ownerUsername}`}
              </p>
              <div className="row">
                <button type="button" onClick={() => onJoin(campaign.id)}>
                  Entrar
                </button>
                {campaign.ownerId === accountId ? (
                  <button
                    type="button"
                    onClick={() => setAddingTo(addingTo === campaign.id ? null : campaign.id)}
                  >
                    Agregar jugador
                  </button>
                ) : null}
              </div>
              {addingTo === campaign.id ? (
                <div className="row mt-3">
                  <input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="usuario"
                  />
                  <button
                    type="button"
                    disabled={username.trim() === ''}
                    onClick={() => {
                      onAddPlayer(campaign.id, username.trim());
                      setUsername('');
                      setAddingTo(null);
                    }}
                  >
                    Agregar
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm -F @daggerheart/web typecheck`
Expected: `CampaignsRoute.tsx` itself compiles cleanly. `App.tsx` and `render.test.tsx` still fail (they still reference the deleted `CampaignRoute`/`CharactersRoute`) — Task 11 and Task 12.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/CampaignsRoute.tsx
git commit -m "feat(web): add CampaignsRoute, replacing the join-code CampaignRoute and the local character library route"
```

---

### Task 10: Web — `WizardRoute` claims the finished character into its campaign

**Files:**
- Modify: `apps/web/src/routes/WizardRoute.tsx`

**Interfaces:**
- Consumes: `useCreation(storage, campaignId)` (Task 7, new signature); `claimCharacter(sheet)` from `CampaignConnection` (Task 8).
- Produces: `WizardRoute` with a changed prop contract — `addCharacter`/its local-id return value are gone, replaced by `campaignId` and `onClaim`.

- [ ] **Step 1: Rewrite the props and the finish handler**

In `apps/web/src/routes/WizardRoute.tsx`, find:

```ts
import { finalize, STEPS, validateStep, type Step } from '@daggerheart/character';
import { useNavigate, useParams } from 'react-router-dom';

import {
  StepBackground,
  StepClass,
  StepConnections,
  StepDerived,
  StepDomainCards,
  StepEquipment,
  StepExperiences,
  StepHeritage,
  StepTraits,
  type StepProps,
} from '../components/wizard/Steps.js';
import { ErrorSummary, TextField } from '../components/wizard/StepFields.js';
import { useCreation } from '../state/useCreation.js';
```

Replace with:

```ts
import { finalize, STEPS, validateStep, type Step } from '@daggerheart/character';
import { useNavigate, useParams } from 'react-router-dom';

import {
  StepBackground,
  StepClass,
  StepConnections,
  StepDerived,
  StepDomainCards,
  StepEquipment,
  StepExperiences,
  StepHeritage,
  StepTraits,
  type StepProps,
} from '../components/wizard/Steps.js';
import { ErrorSummary, TextField } from '../components/wizard/StepFields.js';
import { createSheet } from '../state/sheet.js';
import { useCreation } from '../state/useCreation.js';
```

Find:

```ts
interface WizardRouteProps {
  storage: Storage;
  onFinish: (characterId: string) => void;
  addCharacter: (character: ReturnType<typeof finalize>) => string;
}

/** The nine-step creation wizard: one route per step. */
export function WizardRoute({ storage, onFinish, addCharacter }: WizardRouteProps) {
  const { step: stepParam } = useParams();
  const navigate = useNavigate();
  const { state, dispatch, discard, reset } = useCreation(storage);
```

Replace with:

```ts
interface WizardRouteProps {
  storage: Storage;
  campaignId: string;
  onFinish: () => void;
  onClaim: (sheet: ReturnType<typeof createSheet>) => void;
}

/** The nine-step creation wizard: one route per step, always for one specific campaign. */
export function WizardRoute({ storage, campaignId, onFinish, onClaim }: WizardRouteProps) {
  const { step: stepParam } = useParams();
  const navigate = useNavigate();
  const { state, dispatch, discard, reset } = useCreation(storage, campaignId);
```

Find:

```ts
  const finish = () => {
    const character = finalize(state);
    const id = addCharacter(character);
    discard();
    onFinish(id);
  };
```

Replace with:

```ts
  const finish = () => {
    const character = finalize(state);
    onClaim(createSheet(character));
    discard();
    onFinish();
  };
```

- [ ] **Step 2: Typecheck**

Run: `pnpm -F @daggerheart/web typecheck`
Expected: `WizardRoute.tsx` itself compiles cleanly. `App.tsx` (still passing the old `addCharacter`/`onFinish(id)` props) and `render.test.tsx` (still rendering `WizardRoute` with `addCharacter`) still fail — Task 11 and Task 12.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/WizardRoute.tsx
git commit -m "feat(web): WizardRoute claims the finished character into its campaign instead of a local library"
```

---

### Task 11: Web — rewrite `App.tsx`, update `GMPanel`

**Files:**
- Modify: `apps/web/src/App.tsx` (full rewrite)
- Modify: `apps/web/src/components/gm/GMPanel.tsx`

**Interfaces:**
- Consumes: `useAuth` (Phase A, unchanged), `useCampaign` (Task 8), `CampaignsRoute` (Task 9), the updated `WizardRoute` (Task 10).
- Produces: the finished app shell — last task before the render-test cleanup in Task 12.

- [ ] **Step 1: Replace `App.tsx`**

Replace the entire contents of `apps/web/src/App.tsx` with:

```tsx
import { useCallback, useMemo } from 'react';
import { HashRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import { GMPanel } from './components/gm/GMPanel.js';
import { CampaignsRoute } from './routes/CampaignsRoute.js';
import { ChangePasswordRoute } from './routes/ChangePasswordRoute.js';
import { LoginRoute } from './routes/LoginRoute.js';
import { MapRoute } from './routes/MapRoute.js';
import { PlayersRoute } from './routes/PlayersRoute.js';
import { SheetRoute } from './routes/SheetRoute.js';
import { WizardRoute } from './routes/WizardRoute.js';
import { useAuth } from './state/auth.js';
import { useCampaign } from './state/useCampaign.js';

/**
 * Dice come from here for the sheet's optimistic local echo — a campaign's real
 * rolls always come from the server, seeded and auditable; this only drives the
 * client-side preview before the server's result replaces it.
 */
const rng = () => Math.random();

function Shell() {
  const storage = window.localStorage;
  const navigate = useNavigate();
  // The map is a Foundry-style fullscreen stage: it owns the whole viewport
  // and draws its own thin scene bar instead of sharing the page chrome.
  const isMapRoute = useLocation().pathname === '/map';
  const auth = useAuth(storage);
  const campaign = useCampaign(storage, auth.token);

  const inCampaign = campaign.activeCampaignId !== null && campaign.room !== null;
  const isGameMaster = campaign.role === 'gm';

  const activeCampaignName = useMemo(
    () => campaign.campaigns.find((c) => c.id === campaign.activeCampaignId)?.name ?? '',
    [campaign.campaigns, campaign.activeCampaignId],
  );

  /** The current account's own character sheet in the joined campaign, if claimed. */
  const mySheet = useMemo(() => {
    if (campaign.room === null || auth.user === null) return null;
    return campaign.room.characters[auth.user.id] ?? null;
  }, [campaign.room, auth.user]);

  const hasClaimedCharacter = mySheet !== null;

  if (auth.status === 'loading') {
    return (
      <div className="app">
        <p className="muted">Cargando…</p>
      </div>
    );
  }

  if (auth.status === 'signedOut') {
    return <LoginRoute error={auth.error} onLogin={auth.login} />;
  }

  if (auth.user?.mustChangePassword === true) {
    return <ChangePasswordRoute error={auth.error} onChange={auth.changePassword} />;
  }

  const account = auth.user;

  return (
    <div className={isMapRoute ? 'app app--map' : 'app'}>
      <header className={isMapRoute ? 'topbar topbar--overlay' : 'topbar'}>
        <Link to="/" className="brand">
          DAGGERHEART VTT
        </Link>
        <nav>
          <Link to="/">
            <button type="button">Inicio</button>
          </Link>
          {account.role === 'gm' ? (
            <Link to="/players">
              <button type="button">Jugadores</button>
            </Link>
          ) : null}
          {inCampaign ? (
            <>
              <Link to="/map">
                <button type="button">Mapa</button>
              </Link>
              {isGameMaster ? (
                <Link to="/gm">
                  <button type="button">Panel del DJ</button>
                </Link>
              ) : hasClaimedCharacter ? (
                <Link to="/sheet">
                  <button type="button">Hoja</button>
                </Link>
              ) : null}
            </>
          ) : null}
          <button type="button" onClick={auth.logout}>
            Cerrar sesión
          </button>
        </nav>
      </header>

      {!isMapRoute && inCampaign && !isGameMaster && !hasClaimedCharacter ? (
        <div className="panel">
          <div className="row spread">
            <span>
              Estás en la campaña <strong>{activeCampaignName}</strong> pero todavía no creaste tu
              personaje.
            </span>
            <Link to="/create/1">
              <button type="button">Crear personaje</button>
            </Link>
          </div>
        </div>
      ) : null}

      <Routes>
        <Route
          path="/"
          element={
            inCampaign ? (
              <section>
                <div className="hero">
                  <h1>{activeCampaignName}</h1>
                  <p className="muted">{isGameMaster ? 'Eres el DJ.' : 'Eres jugador.'}</p>
                </div>
                <div className="grid cols-2">
                  <Link to="/map" className="option home-option">
                    <span className="option-name">Abrir el mapa</span>
                    <span className="option-meta">Escenas tácticas, fichas, niebla de guerra.</span>
                  </Link>
                  {isGameMaster ? (
                    <Link to="/gm" className="option home-option">
                      <span className="option-name">Panel del DJ</span>
                      <span className="option-meta">Adversarios, miedo, registro de tiradas.</span>
                    </Link>
                  ) : hasClaimedCharacter ? (
                    <Link to="/sheet" className="option home-option">
                      <span className="option-name">Hoja de personaje</span>
                      <span className="option-meta">Tus rasgos, movimientos y recursos.</span>
                    </Link>
                  ) : (
                    <Link to="/create/1" className="option home-option">
                      <span className="option-name">Crear personaje</span>
                      <span className="option-meta">Todavía no tienes uno en esta campaña.</span>
                    </Link>
                  )}
                </div>
                <div className="row mt-4">
                  <button type="button" onClick={campaign.leave}>
                    Salir de la campaña
                  </button>
                </div>
                {campaign.error !== null ? <div className="errors">{campaign.error}</div> : null}
              </section>
            ) : (
              <CampaignsRoute
                accountId={account.id}
                campaigns={campaign.campaigns}
                error={campaign.error}
                onCreate={(name) => void campaign.createCampaign(name)}
                onJoin={(campaignId) => {
                  campaign.join(campaignId);
                  navigate('/');
                }}
                onAddPlayer={(campaignId, username) => void campaign.addPlayer(campaignId, username)}
              />
            )
          }
        />
        <Route
          path="/create/:step"
          element={
            campaign.activeCampaignId === null ? (
              <Navigate to="/" replace />
            ) : (
              <WizardRoute
                storage={storage}
                campaignId={campaign.activeCampaignId}
                onClaim={campaign.claimCharacter}
                onFinish={() => navigate('/sheet')}
              />
            )
          }
        />
        <Route
          path="/players"
          element={
            account.role !== 'gm' || auth.token === null ? (
              <Navigate to="/" replace />
            ) : (
              <PlayersRoute token={auth.token} />
            )
          }
        />
        <Route path="/create" element={<Navigate to="/create/1" replace />} />
        <Route
          path="/gm"
          element={
            campaign.room === null || !isGameMaster ? (
              <Navigate to="/" replace />
            ) : (
              <GMPanel room={campaign.room} campaignName={activeCampaignName} send={campaign.send} />
            )
          }
        />
        <Route
          path="/sheet"
          element={
            mySheet === null ? (
              <Navigate to="/" replace />
            ) : (
              <SheetRoute
                sheet={mySheet}
                update={() => null}
                rng={rng}
                characterId={account.id}
                send={campaign.send}
                sharedLog={campaign.room?.rollLog}
              />
            )
          }
        />
        <Route
          path="/map"
          element={
            campaign.room === null ? (
              <Navigate to="/" replace />
            ) : (
              <MapRoute
                room={campaign.room}
                isGameMaster={isGameMaster}
                viewerId={account.id}
                send={campaign.send}
              />
            )
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

export function App() {
  // Hash routing keeps deep links working when this is opened straight from disk.
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}
```

Two things intentionally different from the version this replaces, worth
double-checking against `SheetRoute`'s actual prop contract before moving on:

- `SheetRoute`'s `update` prop used to run the offline pure-reducer path when a
  character wasn't synced from a server. In a campaign, a character is *always*
  synced (the wizard claims it straight to the server; there is no local-only
  sheet anymore) — `update={() => null}` is intentionally a no-op, since
  `SheetRoute` only calls `update` for the offline fallback and this app path is
  never offline. Confirm `SheetRoute`'s `update` prop type accepts a function
  returning `SheetEffect | null` with this signature — it does
  (`apps/web/src/routes/SheetRoute.tsx`'s `SheetRouteProps.update`).
- `characterId`/`send`/`sharedLog` are now always passed together (never the
  three-way `{...(syncedSheet === null ? {} : {...})}` spread the old code used),
  because reaching `/sheet` at all now requires `mySheet !== null`, which only
  happens once a character exists on the server.

- [ ] **Step 2: Update `GMPanel` to take a `campaignName` prop**

In `apps/web/src/components/gm/GMPanel.tsx`, find:

```ts
interface GMPanelProps {
  room: RoomState;
  send: (event: RoomEvent) => void;
}
```

Replace with:

```ts
interface GMPanelProps {
  room: RoomState;
  campaignName: string;
  send: (event: RoomEvent) => void;
}
```

Find:

```ts
export function GMPanel({ room, send }: GMPanelProps) {
```

Replace with:

```ts
export function GMPanel({ room, campaignName, send }: GMPanelProps) {
```

Find:

```tsx
          <p className="muted">
            Código de acceso <span className="join-code">{room.code}</span>
          </p>
```

Replace with:

```tsx
          <p className="muted">{campaignName}</p>
```

- [ ] **Step 3: Typecheck**

Run: `pnpm -F @daggerheart/web typecheck`
Expected: `App.tsx` and `GMPanel.tsx` are now clean. Only `apps/web/test/render.test.tsx` should still fail (Task 12).

- [ ] **Step 4: Manual verification**

Run both services (`pnpm -F @daggerheart/server start`, `pnpm -F @daggerheart/web dev`), then in the browser (two accounts needed — reuse Phase A's GM bootstrap plus one player account created via `/players`):

1. Logging in as the GM lands on `CampaignsRoute` (no campaigns yet).
2. Creating a campaign shows it in the list; clicking "Entrar" navigates to `/` showing the campaign's own home screen (map/GM panel options), not the old join-code UI.
3. From `/players`, note a player account's username; back on the campaign card, "Agregar jugador" + that username succeeds.
4. In a second (private/incognito) browser window, log in as that player. Their `CampaignsRoute` now lists the campaign; "Entrar" seats them; the banner "todavía no creaste tu personaje" appears with a link into the wizard.
5. Finishing the wizard lands on `/sheet` showing the just-created character — no "reclamar personaje" step, it was claimed automatically.
6. On the GM's window, `/gm` shows the player in the party overview with their character.
7. Opening `/map` on both windows shows the same scene once the GM adds one; moving a GM token is visible to the player; the player can only move a token they own.
8. "Salir de la campaña" returns to `CampaignsRoute`; rejoining restores the same character and room state.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/components/gm/GMPanel.tsx
git commit -m "feat(web): rewrite App.tsx around campaigns, update GMPanel to show the campaign name"
```

---

### Task 12: Web tests — trim `render.test.tsx`

**Files:**
- Modify: `apps/web/test/render.test.tsx`

**Interfaces:**
- Consumes: `WizardRoute`'s new prop contract (Task 10), `GMPanel`'s new `campaignName` prop (Task 11), `RoomState.id` (Task 1).
- Produces: nothing further downstream — last task of this plan.

- [ ] **Step 1: Remove the deleted-route describe blocks and update the rest**

Replace the entire contents of `apps/web/test/render.test.tsx` with:

```tsx
import { createMapState, type RoomState } from '@daggerheart/protocol';
import { scriptedRng } from '@daggerheart/rules';
import { classes } from '@daggerheart/srd-data';
import { renderToStaticMarkup } from 'react-dom/server';
import { Route, Routes } from 'react-router-dom';
import { StaticRouter } from 'react-router-dom/server';
import { describe, expect, it } from 'vitest';

import { GMPanel } from '../src/components/gm/GMPanel.js';
import { WizardRoute } from '../src/routes/WizardRoute.js';
import { SheetRoute } from '../src/routes/SheetRoute.js';
import {
  createSheet,
  makeDualityRoll,
  takeDamage,
  type SheetEffect,
  type SheetState,
} from '../src/state/sheet.js';
import { saveCreation } from '../src/state/storage.js';
import { buildCharacter, buildCreationState } from './helpers.js';

/**
 * Renders the real component tree to markup. This catches crashes that typechecking
 * can't — a bad hook order, an undefined field read during render — without needing
 * a DOM or any test-library dependency.
 */
const render = (element: JSX.Element, path = '/') =>
  renderToStaticMarkup(<StaticRouter location={path}>{element}</StaticRouter>);

const noopUpdate = (
  transition: (sheet: SheetState) => { sheet: SheetState; effect: SheetEffect },
): SheetEffect | null => transition(createSheet(buildCharacter())).effect;

describe('sheet renders', () => {
  it('shows a populated sheet for a finished character', () => {
    const sheet = createSheet(buildCharacter('bard'));
    const html = render(<SheetRoute sheet={sheet} update={noopUpdate} rng={() => 0.5} />);

    expect(html).toContain('Test Character');
    expect(html).toContain('Bard');
    for (const heading of [
      'Rasgos',
      'Defensas',
      'Puntos de Vida',
      'Estrés',
      'Esperanza',
      'Ranuras de Armadura',
      'Oro',
      'Armas y armadura activas',
      'Experiencias',
      'Rasgos de clase',
      'Inventario',
      'Cartas activas',
      'Bóveda',
      'Registro de tiradas',
    ]) {
      expect(html, heading).toContain(heading);
    }

    expect(html).toContain(`>${sheet.character.evasion}<`);
    expect(html).toContain(`>${sheet.character.major}<`);
    expect(html).toContain(`>${sheet.character.severe}<`);
    expect(html).toContain('Blacksmith');
  });

  it('renders every class without crashing', () => {
    for (const classId of [
      'bard',
      'druid',
      'guardian',
      'ranger',
      'rogue',
      'seraph',
      'sorcerer',
      'warrior',
      'wizard',
    ] as const) {
      const sheet = createSheet(buildCharacter(classId));
      expect(() =>
        render(<SheetRoute sheet={sheet} update={noopUpdate} rng={() => 0.5} />),
      ).not.toThrow();
    }
  });

  it('offers a Spellcast roll only to a subclass that has the trait', () => {
    const caster = createSheet(buildCharacter('wizard'));
    const nonCaster = createSheet(buildCharacter('guardian'));

    expect(render(<SheetRoute sheet={caster} update={noopUpdate} rng={() => 0.5} />)).toContain(
      'Tirada de Conjuro',
    );
    expect(
      render(<SheetRoute sheet={nonCaster} update={noopUpdate} rng={() => 0.5} />),
    ).not.toContain('Tirada de Conjuro');
  });

  it('marks a Vulnerable character on the sheet', () => {
    const sheet = createSheet(buildCharacter());
    const stressed: SheetState = { ...sheet, stressMarked: sheet.character.stressSlots };
    expect(render(<SheetRoute sheet={stressed} update={noopUpdate} rng={() => 0.5} />)).toContain(
      'Vulnerable',
    );
  });
});

describe('wizard renders', () => {
  const storage = () => {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
      clear: () => data.clear(),
      key: () => null,
      length: 0,
    } as unknown as Storage;
  };

  const wizardAt = (path: string, store = storage()) =>
    renderToStaticMarkup(
      <StaticRouter location={path}>
        <Routes>
          <Route
            path="/create/:step"
            element={
              <WizardRoute
                storage={store}
                campaignId="campaign-1"
                onClaim={() => {}}
                onFinish={() => {}}
              />
            }
          />
        </Routes>
      </StaticRouter>,
    );

  it('lists class options sourced from the SRD data, not hardcoded', () => {
    const html = wizardAt('/create/1');
    for (const characterClass of classes) {
      expect(html, characterClass.name).toContain(characterClass.name);
    }
    expect(html).toContain('Paso 1');
    expect(html).toContain('Clase y Subclase');
  });

  it('disables Next until the step validates', () => {
    const html = wizardAt('/create/1');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Siguiente/);
  });

  it('resumes a saved creation at its step with choices intact', () => {
    const store = storage();
    saveCreation(store, 'campaign-1', buildCreationState('sorcerer'));
    const html = wizardAt('/create/8', store);

    expect(html).toContain('Paso 8');
    // A Sorcerer's domains are Arcana and Midnight, so only those cards are offered.
    expect(html).toContain('Arcana');
    expect(html).toContain('Midnight');
    expect(html).not.toContain('Codex');
  });
});

describe('offline sheet reducers', () => {
  it('mutates a sheet with no server and no campaign props', () => {
    // No characterId/send: the sheet must fall back to local pure reducers.
    const sheet = createSheet(buildCharacter('bard'));
    const html = render(<SheetRoute sheet={sheet} update={noopUpdate} rng={() => 0.5} />);
    expect(html).toContain('Test Character');

    const damaged = takeDamage(sheet, {
      incoming: sheet.character.thresholds.severe,
      damageType: 'physical',
      direct: false,
      armorSlotsToMark: 0,
    });
    expect(damaged.sheet.hpMarked).toBe(3);

    const rolled = makeDualityRoll(
      sheet,
      {
        label: 'Offline roll',
        modifiers: 0,
        difficulty: 10,
        advantage: 0,
        disadvantage: 0,
        experiences: [],
      },
      scriptedRng([6, 6]),
    );
    expect(rolled.outcome?.result.outcome).toBe('criticalSuccess');
  });
});

describe('GM panel renders', () => {
  it('shows Fear, party, countdowns, adversaries, environment, presence and log', () => {
    const sheet = createSheet(buildCharacter('seraph'));
    const room: RoomState = {
      id: 'c-abc234',
      gm: { id: 'gm-1', name: 'The GM', connected: true },
      players: [{ id: 'p1', name: 'Alice', connected: false, characterId: 'pc1' }],
      characters: { pc1: sheet },
      fear: 4,
      spotlight: 'p1',
      countdowns: [
        {
          id: 'c1',
          name: 'The Siege',
          kind: 'consequence',
          value: 3,
          startingValue: 5,
          loop: 'none',
          triggered: false,
        },
      ],
      adversaryInstances: [
        { instanceId: 'a1', adversaryId: 'courtier', name: 'Courtier', hpMarked: 1, stressMarked: 0 },
      ],
      activeEnvironment: null,
      map: createMapState(),
      rollLog: [
        {
          kind: 'duality',
          id: 'r1',
          at: 0,
          by: 'Alice',
          label: 'Agility Roll',
          roll: {
            hope: 7,
            fear: 3,
            total: 10,
            critical: false,
            withHope: true,
            advantageRoll: null,
            disadvantageRoll: null,
          },
          difficulty: 10,
          outcome: 'successHope',
          experiences: [],
        },
      ],
    };

    const html = render(<GMPanel room={room} campaignName="Grupo Martes" send={() => {}} />);

    expect(html).toContain('Panel del DJ');
    expect(html).toContain('Grupo Martes');
    expect(html).toContain('Miedo');
    expect(html).toContain('The Siege');
    expect(html).toContain('Courtier');
    expect(html).toContain('Entorno');
    expect(html).toContain('En la mesa');
    expect(html).toContain('desconectado');
    expect(html).toContain('Alice');
    expect(html).toContain('Success with Hope');
  });
});
```

- [ ] **Step 2: Run the whole web suite**

Run: `pnpm -F @daggerheart/web test`
Expected: every test file passes.

Run: `pnpm -F @daggerheart/web typecheck`
Expected: clean — this is the point where `apps/web` as a whole compiles again.

- [ ] **Step 3: Run the whole workspace, end to end**

Run: `pnpm -r typecheck && pnpm -r test`
Expected: every package and app is green — `packages/{srd-data,rules,character,protocol}`, `apps/{server,web}`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/test/render.test.tsx
git commit -m "test(web): update render tests for campaign-scoped wizard and GMPanel's campaignName prop"
```
