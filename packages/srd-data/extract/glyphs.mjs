/**
 * The SRD's italic stat font is a subset with no ToUnicode map, so its digits come
 * out as Private Use Area codepoints. Each mapping below was confirmed against a
 * rendered page image (e.g. U+E541 U+E53F reads "10/HP" on Swarm of Rats, p.42;
 * U+E546 reads "Loop 6" on Choking Ash, p.55).
 */
export const PUA_DIGITS = {
  '\ue53f': '0',
  '\ue541': '1',
  '\ue542': '2',
  '\ue543': '3',
  '\ue544': '4',
  '\ue545': '5',
  '\ue546': '6',
  // Not a digit: the dingbat arrow used in "Level 1 → Tier 1" lists.
  '\uf0e0': '→',
};

/** Replaces PUA digit glyphs with real digits. */
export function fixGlyphs(text) {
  return text.replace(/[\ue000-\uf8ff]/g, (c) => PUA_DIGITS[c] ?? c);
}

/** Throws if any unmapped PUA glyph remains, so a new one can never pass silently. */
export function assertNoPua(text, where = 'text') {
  const leftover = [...new Set(text.match(/[\ue000-\uf8ff]/g) ?? [])];
  if (leftover.length > 0) {
    throw new Error(
      `${where}: unmapped PUA glyphs ${leftover
        .map((c) => 'U+' + c.charCodeAt(0).toString(16).toUpperCase())
        .join(', ')}`,
    );
  }
}
