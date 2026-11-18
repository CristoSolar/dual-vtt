import { readFile } from 'node:fs/promises';

import { RoomStateSchema } from '@daggerheart/protocol';
import { z } from 'zod';

import { writeFileAtomic } from './atomic-write.js';

import type { SerializedCampaign } from './campaigns.js';

const SerializedCampaignSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  ownerId: z.string().min(1),
  memberIds: z.array(z.string().min(1)),
  /** Absent from snapshots written before invitations existed. */
  invitedIds: z.array(z.string().min(1)).default([]),
  /** Absent from older snapshots; `CampaignStore.restore` derives it from the room. */
  partyIds: z.array(z.string().min(1)).optional(),
  state: RoomStateSchema,
  seed: z.number(),
  rollCount: z.number().int().nonnegative(),
  updatedAt: z.number(),
});

const SnapshotEnvelopeSchema = z.object({
  version: z.literal(1),
  campaigns: z.array(z.unknown()),
});

export const CAMPAIGNS_SNAPSHOT_VERSION = 1;

/** Atomic write: a crash mid-write must not leave a truncated file. */
export async function writeCampaignsSnapshot(
  path: string,
  campaigns: readonly SerializedCampaign[],
): Promise<void> {
  await writeFileAtomic(path, JSON.stringify({ version: CAMPAIGNS_SNAPSHOT_VERSION, campaigns }));
}

/**
 * Anything unreadable or from another version is discarded rather than crashing
 * on boot. Each campaign is parsed on its own, so one bad record (e.g. saved
 * before a field the schema now requires was added) never drops every other
 * campaign in the file — it did once, and cost a real campaign's data.
 */
export async function readCampaignsSnapshot(path: string): Promise<SerializedCampaign[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return [];
  }

  try {
    const envelope = SnapshotEnvelopeSchema.safeParse(JSON.parse(raw) as unknown);
    if (!envelope.success) return [];

    const campaigns: SerializedCampaign[] = [];
    for (const candidate of envelope.data.campaigns) {
      const parsed = SerializedCampaignSchema.safeParse(candidate);
      if (parsed.success) {
        campaigns.push(parsed.data);
      } else {
        const id = typeof candidate === 'object' && candidate !== null && 'id' in candidate ? candidate.id : '?';
        console.error(`campaign snapshot: dropping unreadable campaign ${JSON.stringify(id)}: ${parsed.error.message}`);
      }
    }
    return campaigns;
  } catch {
    return [];
  }
}
