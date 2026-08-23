import type { ReactNode } from 'react';

interface SectionHeadProps {
  children: ReactNode;
  /** Renders an h3 instead of an h2, for headings nested inside a panel. */
  level?: 2 | 3;
}

/**
 * A section header in the app's ornament grammar: a small rotated-square
 * diamond, the label, and a gradient rule running out to the edge. Replaces
 * the old `> Título <` chevron-bracket pattern, which read as decoration
 * competing with the title rather than framing it.
 */
export function SectionHead({ children, level = 2 }: SectionHeadProps) {
  return (
    <div className="section-head">
      <span className="ornament-diamond" aria-hidden="true" />
      {level === 2 ? <h2>{children}</h2> : <h3>{children}</h3>}
    </div>
  );
}
