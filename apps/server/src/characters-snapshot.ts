import { readFile } from 'node:fs/promises';

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

export async function writeCharactersSnapshot(
  path: string,
  characters: readonly CharacterRecord[],
): Promise<void> {
  await writeFileAtomic(path, JSON.stringify({ version: CHARACTERS_SNAPSHOT_VERSION, characters }));
}

/** Same rules as the campaigns snapshot: each record parsed alone, nothing throws. */
export async function readCharactersSnapshot(path: string): Promise<CharacterRecord[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return [];
  }

  try {
    const envelope = SnapshotEnvelopeSchema.safeParse(JSON.parse(raw) as unknown);
    if (!envelope.success) return [];

    const characters: CharacterRecord[] = [];
    for (const candidate of envelope.data.characters) {
      const parsed = CharacterRecordSchema.safeParse(candidate);
      if (parsed.success) {
        characters.push(parsed.data);
      } else {
        const id = typeof candidate === 'object' && candidate !== null && 'id' in candidate ? candidate.id : '?';
        console.error(`characters snapshot: dropping unreadable character ${JSON.stringify(id)}: ${parsed.error.message}`);
      }
    }
    return characters;
  } catch {
    return [];
  }
}
