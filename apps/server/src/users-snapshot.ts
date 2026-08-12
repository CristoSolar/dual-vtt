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

const SnapshotSchema = z.object({
  version: z.literal(1),
  users: z.array(StoredUserSchema),
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

export async function readUsersSnapshot(path: string): Promise<StoredUser[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return [];
  }

  try {
    const parsed = SnapshotSchema.safeParse(JSON.parse(raw) as unknown);
    if (!parsed.success) return [];
    return parsed.data.users;
  } catch {
    return [];
  }
}
