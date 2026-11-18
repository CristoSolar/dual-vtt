import { randomBytes } from 'node:crypto';

import type { SheetState } from '@daggerheart/protocol';

/**
 * A character in its owner's library. While `campaignId` is set the room holds the
 * live sheet and `sheet` here is only the copy from the moment it was linked —
 * `library.ts` reads through to the room and writes back on unlink.
 */
export interface CharacterRecord {
  id: string;
  ownerId: string;
  sheet: SheetState;
  campaignId: string | null;
  updatedAt: number;
  /** Where an imported character came from in its browser; see `CreateCharacterRequest`. */
  importId?: string | undefined;
}

/** In-memory character libraries for every account, snapshotted like the others. */
export class CharacterStore {
  private readonly characters = new Map<string, CharacterRecord>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  get size(): number {
    return this.characters.size;
  }

  get(id: string): CharacterRecord | null {
    return this.characters.get(id) ?? null;
  }

  listFor(ownerId: string): CharacterRecord[] {
    return [...this.characters.values()].filter((c) => c.ownerId === ownerId);
  }

  /** The character this owner already imported under `importId`, if any. */
  imported(ownerId: string, importId: string): CharacterRecord | null {
    for (const c of this.characters.values()) {
      if (c.ownerId === ownerId && c.importId === importId) return c;
    }
    return null;
  }

  /** This owner's character linked to this campaign, if any. */
  linkedIn(campaignId: string, ownerId: string): CharacterRecord | null {
    for (const c of this.characters.values()) {
      if (c.ownerId === ownerId && c.campaignId === campaignId) return c;
    }
    return null;
  }

  all(): CharacterRecord[] {
    return [...this.characters.values()];
  }

  create(
    ownerId: string,
    sheet: SheetState,
    campaignId: string | null = null,
    importId?: string,
  ): CharacterRecord {
    const record: CharacterRecord = {
      id: `ch-${randomBytes(8).toString('hex')}`,
      ownerId,
      sheet,
      campaignId,
      updatedAt: this.now(),
      ...(importId === undefined ? {} : { importId }),
    };
    this.characters.set(record.id, record);
    return record;
  }

  update(id: string, changes: Partial<Pick<CharacterRecord, 'sheet' | 'campaignId'>>): CharacterRecord | null {
    const record = this.characters.get(id);
    if (record === undefined) return null;
    if (changes.sheet !== undefined) record.sheet = changes.sheet;
    if (changes.campaignId !== undefined) record.campaignId = changes.campaignId;
    record.updatedAt = this.now();
    return record;
  }

  delete(id: string): boolean {
    return this.characters.delete(id);
  }

  restore(records: readonly CharacterRecord[]): void {
    for (const record of records) this.characters.set(record.id, { ...record });
  }

  serialize(): CharacterRecord[] {
    return this.all().map((c) => ({ ...c }));
  }
}
