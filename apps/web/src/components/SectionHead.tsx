import type { ReactNode } from 'react';

interface SectionHeadProps {
  children: ReactNode;
  /** Renders an h3 instead of an h2, for headings nested inside a panel. */
  level?: 2 | 3;
}

/**
 * A section header styled after the chevron-flanked bars on the printed sheet:
 * a centred label with an angled bracket at each end and a rule running out to
 * the edges. The brackets are inline SVG so no icon package is needed.
 */
export function SectionHead({ children, level = 2 }: SectionHeadProps) {
  return (
    <div className="section-head">
      <Chevron direction="right" />
      {level === 2 ? <h2>{children}</h2> : <h3>{children}</h3>}
      <Chevron direction="left" />
    </div>
  );
}

function Chevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg
      className="chevron"
      viewBox="0 0 12 16"
      aria-hidden="true"
      focusable="false"
      style={direction === 'left' ? { transform: 'scaleX(-1)' } : undefined}
    >
      <path
        d="M2 1 L10 8 L2 15"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="square"
      />
    </svg>
  );
}
