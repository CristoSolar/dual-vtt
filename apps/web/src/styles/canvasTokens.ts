/**
 * Canvas colours.
 *
 * Konva paints to a canvas and cannot resolve CSS custom properties, so the map
 * would otherwise be the one place carrying raw colour values. This reads the
 * same tokens off the document instead, keeping tokens.css the single source of
 * truth for the whole app.
 *
 * Values are resolved lazily and cached: the token file is static at runtime.
 */

const cache = new Map<string, string>();

/** Resolves one CSS custom property to its computed value. */
export function token(name: string): string {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;

  // Outside a browser (server-render, tests) there is nothing to paint on.
  if (typeof document === 'undefined') return '';

  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  cache.set(name, value);
  return value;
}

/** Applies an alpha to a resolved token, for washes and hairlines. */
export function tokenAlpha(name: string, alpha: number): string {
  const value = token(name);
  if (value === '') return '';
  return `color-mix(in srgb, ${value} ${Math.round(alpha * 100)}%, transparent)`;
}

/** The canvas palette, named by role rather than by colour. */
export const canvasPalette = {
  stage: () => token('--c-bg'),
  fog: () => token('--c-bg'),
  gridLine: () => tokenAlpha('--c-text', 0.13),
  measureLine: () => token('--c-brass'),
  measureText: () => token('--c-brass'),
  tokenLabel: () => token('--c-text'),
  tokenLabelMuted: () => token('--c-text-muted'),
  tokenOutline: () => token('--c-text'),
  tokenOutlineIdle: () => tokenAlpha('--c-bg', 0.4),
  ringFallback: () => tokenAlpha('--c-text', 0.33),
} as const;

/** Range rings reuse the band colours defined alongside the rest of the palette. */
export const rangeRingColor = (band: string): string => {
  const byBand: Record<string, string> = {
    melee: '--c-crimson-bright',
    veryClose: '--c-brass',
    close: '--c-success',
    far: '--c-domain-codex',
    veryFar: '--c-violet',
  };
  const name = byBand[band];
  return name === undefined ? canvasPalette.ringFallback() : token(name);
};

/** Colours offered when placing a token, drawn from the domain palette. */
export const TOKEN_COLOR_TOKENS: readonly string[] = [
  '--c-brass',
  '--c-domain-codex',
  '--c-success',
  '--c-crimson-bright',
  '--c-violet',
  '--c-text-muted',
];

/** Resolves the nth token colour, wrapping around the palette. */
export function tokenColorAt(index: number): string {
  const name = TOKEN_COLOR_TOKENS[index % TOKEN_COLOR_TOKENS.length] ?? '--c-brass';
  return token(name);
}

export const adversaryTokenColor = (): string => token('--c-crimson');
export const markerTokenColor = (): string => token('--c-text-muted');
