import { useEffect, useState, type CSSProperties } from 'react';

import { domainIconUrl } from '../state/art.js';
import { domainName, domainSummary } from '../state/domains.js';

/**
 * Domain colours live in the token file; this maps a domain id onto its token, plus
 * a lighter ink of the same hue for text on the dark surfaces.
 */
export const domainStyle = (domain: string): CSSProperties =>
  ({
    '--domain-color': `var(--c-domain-${domain}, var(--c-brass-dim))`,
    '--domain-ink': `color-mix(in oklab, var(--c-domain-${domain}, var(--c-brass-dim)) 52%, var(--c-text))`,
  }) as CSSProperties;

// Whether each icon file loaded, shared by every icon on the page so a missing file
// is probed once. Until it is known to load, the initial is drawn instead: a mask
// over a file that 404s would draw nothing at all.
const iconStatus = new Map<string, 'ok' | 'missing'>();

/** The domain's icon in its own colour, or a coloured disc with its initial. */
export function DomainIcon({ domain, size = 'md' }: { domain: string; size?: 'sm' | 'md' }) {
  const url = domainIconUrl(domain);
  const [status, setStatus] = useState(iconStatus.get(url));

  useEffect(() => {
    if (status !== undefined) return;
    let live = true;
    const probe = new Image();
    const settle = (result: 'ok' | 'missing') => {
      iconStatus.set(url, result);
      if (live) setStatus(result);
    };
    probe.onload = () => settle('ok');
    probe.onerror = () => settle('missing');
    probe.src = url;
    return () => {
      live = false;
    };
  }, [url, status]);

  return (
    <span
      className={`domain-icon domain-icon-${size}`}
      style={{ ...domainStyle(domain), ['--domain-icon' as string]: `url("${url}")` }}
      aria-hidden="true"
    >
      {status === 'ok' ? (
        <span className="domain-icon-glyph" />
      ) : (
        <span className="domain-icon-initial">{domainName(domain).charAt(0)}</span>
      )}
    </span>
  );
}

/** Small inline badge: icon and localized name, tinted with the domain's colour. */
export function DomainBadge({ domain }: { domain: string }) {
  return (
    <span className="domain-badge" style={domainStyle(domain)}>
      <DomainIcon domain={domain} size="sm" />
      {domainName(domain)}
    </span>
  );
}

/** A section header band: icon, name, and the first line of the SRD description. */
export function DomainHeader({ domain, id }: { domain: string; id?: string }) {
  const summary = domainSummary(domain);
  return (
    <header className="domain-header" style={domainStyle(domain)}>
      <DomainIcon domain={domain} />
      <span className="domain-header-text">
        <h3 className="domain-header-name" id={id}>
          {domainName(domain)}
        </h3>
        {summary === '' ? null : <span className="domain-header-summary">{summary}</span>}
      </span>
    </header>
  );
}
