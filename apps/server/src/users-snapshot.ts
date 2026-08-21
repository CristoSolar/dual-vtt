import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { UserRoleSchema } from '@daggerheart/protocol';
import { z } from 'zod';

import type { StoredUser } from './users.js';

const StoredUserSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  role: UserRoleSchema,
  mustChangePassword: z.boolean(),
  passwordHash: z.string().min(1),
});

const SnapshotEnvelopeSchema = z.object({
  version: z.literal(1),
  users: z.array(z.unknown()),
});

export const USERS_SNAPSHOT_VERSION = 1;

/** Same atomic-write approach as `writeSnapshot`: never leave a truncated file on a crash. */
export async function writeUsersSnapshot(path: string, users: readonly StoredUser[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const payload = JSON.stringify({ version: USERS_SNAPSHOT_VERSION, users });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, payload, 'utf8');
  await rename(temporary, path);
}

/**
 * Each user is parsed on its own, so one bad record never drops every other
 * account in the file — a whole-array parse failing here once cost a real
 * campaign's data in the sibling campaigns snapshot; same fix applied here
 * before it does the same to accounts.
 */
export async function readUsersSnapshot(path: string): Promise<StoredUser[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return [];
  }

  try {
    const envelope = SnapshotEnvelopeSchema.safeParse(JSON.parse(raw) as unknown);
    if (!envelope.success) return [];

    const users: StoredUser[] = [];
    for (const candidate of envelope.data.users) {
      const parsed = StoredUserSchema.safeParse(candidate);
      if (parsed.success) {
        users.push(parsed.data);
      } else {
        const id = typeof candidate === 'object' && candidate !== null && 'id' in candidate ? candidate.id : '?';
        console.error(`users snapshot: dropping unreadable user ${JSON.stringify(id)}: ${parsed.error.message}`);
      }
    }
    return users;
  } catch {
    return [];
  }
}
