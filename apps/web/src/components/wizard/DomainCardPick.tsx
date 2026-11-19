import type { DomainCard } from '@daggerheart/srd-data';
import { useEffect, useId, useRef, useState } from 'react';

import { t } from '../../i18n/index.js';
import { cardTypeLabel } from '../../state/domains.js';
import { domainStyle } from '../Domain.js';

interface DomainCardPickProps {
  card: DomainCard;
  selected: boolean;
  onToggle: () => void;
}

/**
 * One selectable domain card. The whole face is the toggle (`aria-pressed`); long
 * text is clamped, and "show more" is a separate button beside it rather than inside
 * it, so expanding never toggles the pick.
 */
export function DomainCardPick({ card, selected, onToggle }: DomainCardPickProps) {
  const textId = useId();
  const textRef = useRef<HTMLSpanElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  // Only offer "show more" when the clamp actually hides something at this width.
  useEffect(() => {
    const el = textRef.current;
    if (el === null || expanded) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [expanded, card.text]);

  return (
    <li className={selected ? 'domain-pick is-selected' : 'domain-pick'} style={domainStyle(card.domain)}>
      <button
        type="button"
        className="domain-pick-select"
        aria-pressed={selected}
        onClick={onToggle}
      >
        <span className="domain-pick-head">
          <span className="domain-pick-level" title={t('wizard.step8.level', { level: card.level })}>
            {card.level}
          </span>
          <span className="domain-pick-name">{card.name}</span>
          <span className="domain-pick-check" aria-hidden="true">
            {selected ? '✓' : ''}
          </span>
        </span>
        <span className="domain-pick-meta">
          <span className="domain-pick-type">{cardTypeLabel(card.type)}</span>
          <span>{t('wizard.step8.recall', { recall: card.recallCost })}</span>
        </span>
        <span
          ref={textRef}
          id={textId}
          className={expanded ? 'domain-pick-text' : 'domain-pick-text is-clamped'}
        >
          {card.text}
        </span>
      </button>
      {overflows || expanded ? (
        <button
          type="button"
          className="domain-pick-more"
          aria-expanded={expanded}
          aria-controls={textId}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? t('wizard.step8.showLess') : t('wizard.step8.showMore')}
        </button>
      ) : null}
    </li>
  );
}
