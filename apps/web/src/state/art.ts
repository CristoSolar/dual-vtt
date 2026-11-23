/**
 * Art under `public/images` keeps its file name when it is redrawn, so browsers that
 * cached the old picture would keep showing it. Bump this whenever art is replaced:
 * the new query string is a new URL, fetched fresh.
 */
const ART_VERSION = '3';

export type ArtKind =
  | 'classes'
  | 'ancestries'
  | 'communities'
  | 'weapons'
  | 'armor'
  | 'transformations';

/**
 * Weapon, armor and transformation art may not exist yet for every id; a card using it must draw
 * its own fallback face and drop the picture on `error` (see `CardCarousel`).
 */
export function artUrl(kind: ArtKind, id: string): string {
  return `/images/${kind}/${id}.png?v=${ART_VERSION}`;
}

/** A domain's monochrome icon (`currentColor`), drawn through a CSS mask. */
export function domainIconUrl(id: string): string {
  return `/images/domains/${id}.svg?v=${ART_VERSION}`;
}
