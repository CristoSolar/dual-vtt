import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { RoomStateSchema } from '@daggerheart/protocol';
import { z } from 'zod';

import type { RoomStore, SerializedRoom } from './rooms.js';

const SessionSchema = z.object({
  token: z.string().min(8),
  sessionId: z.string().min(1),
  role: z.enum(['gm', 'player']),
  code: z.string().length(6),
});

const SerializedRoomSchema = z.object({
  state: RoomStateSchema,
  sessions: z.array(SessionSchema),
  seed: z.number(),
  rollCount: z.number().int().nonnegative(),
  updatedAt: z.number(),
});

const SnapshotSchema = z.object({
  version: z.literal(1),
  rooms: z.array(SerializedRoomSchema),
});

export const SNAPSHOT_VERSION = 1;

/**
 * Writes the snapshot atomically: a crash mid-write must not leave a truncated file
 * that would lose every room on the next start.
 */
export async function writeSnapshot(path: string, rooms: readonly SerializedRoom[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const payload = JSON.stringify({ version: SNAPSHOT_VERSION, rooms });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, payload, 'utf8');
  await rename(temporary, path);
}

/**
 * Reads a snapshot back. Anything unreadable or from another version is discarded
 * rather than crashing the server on boot — a lost snapshot is recoverable, a
 * server that won't start is not.
 */
export async function readSnapshot(path: string): Promise<SerializedRoom[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return [];
  }

  try {
    const parsed = SnapshotSchema.safeParse(JSON.parse(raw) as unknown);
    if (!parsed.success) return [];
    return parsed.data.rooms;
  } catch {
    return [];
  }
}

/** Snapshots every `intervalMs`, and returns a stop function. */
export function startSnapshots(
  store: RoomStore,
  path: string,
  intervalMs: number,
  onError: (error: unknown) => void = () => {},
): () => void {
  const timer = setInterval(() => {
    void writeSnapshot(path, store.serialize()).catch(onError);
  }, intervalMs);
  // Never hold the process open just to take a snapshot.
  timer.unref();
  return () => clearInterval(timer);
}
