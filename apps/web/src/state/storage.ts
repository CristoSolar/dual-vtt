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

/**
 * Restores an in-progress creation, or null if there is none or it is unreadable.
 *
 * An unreadable draft is moved aside rather than left in place: the wizard starts
 * fresh and immediately auto-saves over this key, so without the move a draft that
 * failed to parse — a schema change, a half-written value — would be destroyed
 * with nothing to recover it from.
 */
export function loadCreation(storage: StorageLike, campaignId: string): CreationState | null {
  const raw = storage.getItem(inProgressKey(campaignId));
  if (raw === null) return null;
  try {
    return deserialize(raw);
  } catch {
    try {
      storage.setItem(`${inProgressKey(campaignId)}:unreadable`, raw);
    } catch {
      // Out of quota: nothing more to do, and losing the copy is not worth
      // blocking the wizard over.
    }
    return null;
  }
}

export function clearCreation(storage: StorageLike, campaignId: string): void {
  storage.removeItem(inProgressKey(campaignId));
}

const guideSeenKey = (accountId: string): string => `${KEY_PREFIX}:guide-seen:${accountId}`;

/** True once this account has closed the first-run guide on this device. */
export function hasSeenGuide(storage: StorageLike, accountId: string): boolean {
  try {
    return storage.getItem(guideSeenKey(accountId)) === '1';
  } catch {
    return false;
  }
}

export function markGuideSeen(storage: StorageLike, accountId: string): void {
  try {
    storage.setItem(guideSeenKey(accountId), '1');
  } catch {
    // Private mode or quota: the guide will simply show again next time.
  }
}
