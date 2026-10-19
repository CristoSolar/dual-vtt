import {
  MAX_ROOM_LOG,
  type PrivateEntry,
  type RollEntry,
  type RoomState,
} from '@daggerheart/protocol';

/** One line of the log as this account sees it. */
export interface FeedItem {
  entry: RollEntry;
  /** A whisper or a private roll: only some of the table can see it. */
  private: boolean;
}

/**
 * The shared log and this account's private entries as one list, newest first.
 * They arrive on different channels, so the client is the only place they meet.
 */
export function mergeFeed(
  rollLog: readonly RollEntry[],
  privateLog: readonly PrivateEntry[],
): FeedItem[] {
  const seen = new Set<string>();
  const items: FeedItem[] = [];
  const add = (entry: RollEntry, isPrivate: boolean) => {
    if (seen.has(entry.id)) return;
    seen.add(entry.id);
    items.push({ entry, private: isPrivate });
  };
  for (const entry of rollLog) add(entry, false);
  for (const { entry } of privateLog) add(entry, true);
  // Array sort is stable, so entries stamped in the same millisecond keep the
  // order their own log gave them.
  return items.sort((a, b) => b.entry.at - a.entry.at);
}

/**
 * Folds `privateRolled` into the local room. A patch never carries the private
 * log, so this is the only way a whisper reaches state after the join; an id
 * already held (say, from a full state that crossed it in flight) is skipped.
 */
export function appendPrivate(state: RoomState, entries: readonly PrivateEntry[]): RoomState {
  const held = new Set(state.privateLog.map((p) => p.entry.id));
  const fresh = entries.filter((p) => !held.has(p.entry.id));
  if (fresh.length === 0) return state;
  return { ...state, privateLog: [...fresh, ...state.privateLog].slice(0, MAX_ROOM_LOG) };
}

/**
 * Whether this character's duality roll may be private. A Tag Team roll, or a
 * reaction to someone else's group action, is written where the whole table sees
 * it, so the server refuses those as private and the dialog should not offer it.
 */
export function canRollPrivately(room: RoomState, characterId: string): boolean {
  const tag = room.tagTeam;
  if (tag !== null && (tag.initiatorId === characterId || tag.partnerId === characterId)) return false;
  const group = room.groupAction;
  return group === null || group.leadCharacterId === characterId;
}

/**
 * Who `selfId` can whisper to: the GM (unless that is who is writing) and every
 * other player. The GM reads every whisper anyway, so is never a second recipient.
 */
export function chatRecipients(
  room: RoomState,
  selfId: string,
): { gmId: string | null; players: { id: string; name: string }[] } {
  return {
    gmId: room.gm.id === selfId ? null : room.gm.id,
    players: room.players
      .filter((player) => player.id !== selfId)
      .map((player) => ({ id: player.id, name: player.name })),
  };
}
