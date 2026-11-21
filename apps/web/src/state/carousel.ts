/**
 * Pure helpers for the card carousel: index arithmetic, which cards are on stage,
 * and the short flavor line printed on each card. No DOM, no React.
 */

/** `index` wrapped into `0..count-1`, so stepping past either end comes round. */
export function wrapIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return ((index % count) + count) % count;
}

/** `index` held inside `0..count-1`. */
export function clampIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(index, 0), count - 1);
}

/**
 * Where card `index` sits relative to the centred one, going the short way round
 * the ring: 0 is centre, -1 the left neighbour, +1 the right one. A ring of even
 * length breaks the tie at the far side towards the right (positive).
 */
export function ringOffset(index: number, current: number, count: number): number {
  if (count <= 0) return 0;
  const forward = wrapIndex(index - current, count);
  return forward > count / 2 ? forward - count : forward;
}

/**
 * Indices on stage around `current`, left to right: `radius` neighbours each side,
 * fewer when the ring is too small to fill both sides without repeating a card.
 */
export function visibleWindow(current: number, count: number, radius: number): number[] {
  if (count <= 0) return [];
  const indices: number[] = [];
  for (let i = 0; i < count; i += 1) {
    if (Math.abs(ringOffset(i, current, count)) <= radius) indices.push(i);
  }
  return indices.sort((a, b) => ringOffset(a, current, count) - ringOffset(b, current, count));
}

/**
 * A card's flavor line from SRD text: the first sentence, and if that is still
 * longer than `max`, cut at the last word boundary that fits, with an ellipsis.
 * Only ever shortens the source — it never writes text of its own.
 */
export function flavorText(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const end = flat.search(/[.!?](\s|$)/);
  const sentence = end === -1 ? flat : flat.slice(0, end + 1);
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  const head = (space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '');
  return `${head}…`;
}
