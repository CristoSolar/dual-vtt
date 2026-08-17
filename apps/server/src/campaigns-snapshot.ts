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
