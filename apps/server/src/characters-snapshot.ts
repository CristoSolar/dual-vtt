import { copyFile, readFile } from 'node:fs/promises';

import { SheetStateSchema } from '@daggerheart/protocol';
import { z } from 'zod';

import { writeFileAtomic } from './atomic-write.js';

import type { CharacterRecord } from './characters.js';

const CharacterRecordSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  sheet: SheetStateSchema,
  campaignId: z.string().min(1).nullable().default(null),
  updatedAt: z.number().default(0),
});

const SnapshotEnvelopeSchema = z.object({
  version: z.literal(1),
  characters: z.array(z.unknown()),
});

export const CHARACTERS_SNAPSHOT_VERSION = 1;

/**
 * `unreadable` is whatever `readCharactersSnapshot` could not parse, written back
 * exactly as it was read: a record the current schema rejects is somebody's
 * character, and a later version (or a person) may still be able to recover it.
 */
export async function writeCharactersSnapshot(
  path: string,
  characters: readonly CharacterRecord[],
  unreadable: readonly unknown[] = [],
): Promise<void> {
  await writeFileAtomic(
    path,
    JSON.stringify({ version: CHARACTERS_SNAPSHOT_VERSION, characters: [...characters, ...unreadable] }),
  );
}

export interface CharactersSnapshot {
  characters: CharacterRecord[];
  /** Records that failed the schema, kept raw so they are written back unchanged. */
  unreadable: unknown[];
}

/**
 * A file that cannot be read at all — not JSON, or not an envelope this version
 * knows — is copied to `<path>.bad-<timestamp>` before the server carries on with an
 * empty library, because the next snapshot would otherwise overwrite it with only
 * the characters re-adopted from the rooms. A single bad record is kept aside
 * (see `unreadable`), never dropped.
 */
export async function readCharactersSnapshot(
  path: string,
  now: () => number = () => Date.now(),
): Promise<CharactersSnapshot> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return { characters: [], unreadable: [] };
  }

  let envelope: z.infer<typeof SnapshotEnvelopeSchema>;
  try {
    const parsed = SnapshotEnvelopeSchema.safeParse(JSON.parse(raw) as unknown);
    if (!parsed.success) throw new Error(parsed.error.message);
    envelope = parsed.data;
  } catch (error) {
    const backup = `${path}.bad-${now()}`;
    await copyFile(path, backup).catch((copyError: unknown) =>
      console.error(`characters snapshot: could not copy ${path} to ${backup}`, copyError),
    );
    console.error(
      `characters snapshot: ${path} is unreadable (${String(error)}). ` +
        `It was copied to ${backup}; starting with an empty library. ` +
        'Characters in campaign rooms are re-filed; restore the rest from the copy.',
    );
    return { characters: [], unreadable: [] };
  }

  const snapshot: CharactersSnapshot = { characters: [], unreadable: [] };
  for (const candidate of envelope.characters) {
    const parsed = CharacterRecordSchema.safeParse(candidate);
    if (parsed.success) {
      snapshot.characters.push(parsed.data);
    } else {
      snapshot.unreadable.push(candidate);
      const id = typeof candidate === 'object' && candidate !== null && 'id' in candidate ? candidate.id : '?';
      console.error(
        `characters snapshot: keeping unreadable character ${JSON.stringify(id)} as is: ${parsed.error.message}`,
      );
    }
  }
  return snapshot;
}
