import { randomBytes } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Write a file so that a crash mid-write never leaves a truncated one, and so that
 * two overlapping writes to the same path cannot interleave.
 *
 * Snapshots are written from several places at once — the periodic interval, every
 * characters- and campaigns-HTTP mutation, and shutdown — so a shared temp name would
 * let one writer's bytes land under another writer's rename. Each write gets its own
 * temp file, and writes to the same path queue behind each other.
 */

/** The in-flight write for each path. Later calls chain onto it. */
const queues = new Map<string, Promise<void>>();

export function writeFileAtomic(path: string, payload: string): Promise<void> {
  const previous = queues.get(path) ?? Promise.resolve();

  // A failed write must not poison the queue for the next one, hence the catch.
  const next = previous.catch(() => undefined).then(async () => {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await writeFile(temporary, payload, 'utf8');
      await rename(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  });

  queues.set(path, next);
  void next
    .catch(() => undefined)
    .then(() => {
      // Only the newest writer clears the slot, so a queue that is still building
      // is never dropped halfway.
      if (queues.get(path) === next) queues.delete(path);
    });
  return next;
}
