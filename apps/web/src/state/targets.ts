import type { AdversaryInstance, RollEntry, RoomState, Token } from '@daggerheart/protocol';

import { colorFor } from './playerColor.js';

/** How many tokens one account may target at once; the room schema holds no more. */
export const MAX_TARGETS = 6;

/** Adds a token to a target list or takes it off; past the cap the oldest drops. */
export function toggleTarget(current: readonly string[], tokenId: string): string[] {
  if (current.includes(tokenId)) return current.filter((id) => id !== tokenId);
  return [...current, tokenId].slice(-MAX_TARGETS);
}

/** A token anywhere on the map this client was sent. */
function tokenById(room: RoomState, tokenId: string): Token | null {
  for (const scene of room.map.scenes) {
    const found = scene.tokens.find((token) => token.id === tokenId);
    if (found !== undefined) return found;
  }
  return null;
}

/** The tokens an account is targeting that are still on the map, in the order picked. */
function targetsOf(room: RoomState, accountId: string): Token[] {
  return (room.targets[accountId] ?? []).flatMap((id) => {
    const token = tokenById(room, id);
    return token === null ? [] : [token];
  });
}

/** The token a roll is aimed at: the account's first target still on the map. */
export function firstTarget(room: RoomState, accountId: string): Token | null {
  return targetsOf(room, accountId)[0] ?? null;
}

/** Per token, the colour of every account targeting it, for the rings on the map. */
export function targetRings(room: RoomState): Record<string, string[]> {
  const rings: Record<string, string[]> = {};
  for (const [accountId, tokenIds] of Object.entries(room.targets)) {
    const color = colorFor(accountId, accountId === room.gm.id ? 'gm' : 'player');
    for (const tokenId of tokenIds) {
      rings[tokenId] = [...(rings[tokenId] ?? []), color];
    }
  }
  return rings;
}

/**
 * The adversary whoever signed a log entry is targeting now, if any. The log
 * signs entries with a display name, so that is what the account is found by.
 */
export function adversaryTargetOf(room: RoomState, by: string): AdversaryInstance | null {
  const accountId =
    room.players.find((player) => player.name === by)?.id ?? (room.gm.name === by ? room.gm.id : null);
  if (accountId === null) return null;
  const token = targetsOf(room, accountId).find((candidate) => candidate.kind === 'adversary');
  if (token === undefined) return null;
  return room.adversaryInstances.find((instance) => instance.instanceId === token.refId) ?? null;
}

/**
 * The damage entries that may still be applied to a target: each author's newest
 * one, from a log ordered newest first. An older line would land on whatever that
 * author is targeting now, which is not what it was rolled against.
 */
export function newestDamageIds(feed: readonly RollEntry[]): Set<string> {
  const authors = new Set<string>();
  const ids = new Set<string>();
  for (const entry of feed) {
    if (entry.kind !== 'damage' || authors.has(entry.by)) continue;
    authors.add(entry.by);
    ids.add(entry.id);
  }
  return ids;
}

/** The character behind an account's first PC target, for aiming an adversary's attack. */
export function pcTargetOf(room: RoomState, accountId: string): string | null {
  return targetsOf(room, accountId).find((token) => token.kind === 'pc')?.refId ?? null;
}
