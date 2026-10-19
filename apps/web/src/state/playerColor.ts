/**
 * One colour per account, for marks a person leaves on the map (targets, pings).
 *
 * Raw values rather than CSS tokens: these are identities, not theme roles, and
 * every one of them must stay readable on the map's near-black stage. None is
 * amber, which the spotlight ring already wears.
 */
export const PLAYER_COLORS: readonly string[] = [
  '#5ec8ff',
  '#7be495',
  '#ff9f5a',
  '#c79bff',
  '#ff8fcf',
  '#4fe3d1',
  '#d4f06b',
  '#f2f2f2',
];

/** The GM's marks always read the same, whichever account is running the table. */
export const GM_COLOR = '#ff4d5e';

/** A stable colour for an account: the same id always hashes to the same entry. */
export function colorFor(accountId: string, role: 'gm' | 'player' = 'player'): string {
  if (role === 'gm') return GM_COLOR;
  // FNV-1a, which spreads short, similar ids well enough for eight buckets.
  let hash = 0x811c9dc5;
  for (let i = 0; i < accountId.length; i++) {
    hash ^= accountId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return PLAYER_COLORS[(hash >>> 0) % PLAYER_COLORS.length] ?? GM_COLOR;
}
