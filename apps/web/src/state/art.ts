/**
 * Art under `public/images` keeps its file name when it is redrawn, so browsers that
 * cached the old picture would keep showing it. Bump this whenever art is replaced:
 * the new query string is a new URL, fetched fresh.
 */
const ART_VERSION = '2';

export function artUrl(kind: 'classes' | 'ancestries' | 'communities', id: string): string {
  return `/images/${kind}/${id}.png?v=${ART_VERSION}`;
}

/** A domain's monochrome icon (`currentColor`), drawn through a CSS mask. */
export function domainIconUrl(id: string): string {
  return `/images/domains/${id}.svg?v=${ART_VERSION}`;
}
