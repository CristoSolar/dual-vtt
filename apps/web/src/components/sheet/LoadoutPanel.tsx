import type { DomainCard } from '@daggerheart/srd-data';
import { MAX_LOADOUT } from '@daggerheart/rules';
import { useState, type CSSProperties } from 'react';

import { t } from '../../i18n/index.js';
import { label as prettify } from '../../state/selectors.js';
import { SectionHead } from '../SectionHead.js';

/** Domain colours live in the token file; this maps a domain id onto its token. */
const domainStyle = (domain: string): CSSProperties =>
  ({ '--domain-color': `var(--c-domain-${domain})` }) as CSSProperties;

interface LoadoutPanelProps {
  loadout: readonly DomainCard[];
  vault: readonly DomainCard[];
  /** Whether the party is resting, which makes swaps free (SRD p.9). */
  duringRest: boolean;
  onToggleRest: () => void;
  onRecall: (cardId: string, vaulting: string | undefined) => void;
  onVault: (cardId: string) => void;
}

/** Loadout and vault, with the Stress cost of recalling shown before you commit. */
export function LoadoutPanel({
  loadout,
  vault,
  duringRest,
  onToggleRest,
  onRecall,
  onVault,
}: LoadoutPanelProps) {
  const [vaulting, setVaulting] = useState<string>('');
  const full = loadout.length >= MAX_LOADOUT;

  return (
    <div className="panel">
      <SectionHead>
        {t('sheet.loadout.title', { count: loadout.length, max: MAX_LOADOUT })}
      </SectionHead>
      <div className="card-head">
        <button type="button" aria-pressed={duringRest} onClick={onToggleRest}>
          {duringRest ? t('sheet.loadout.resting') : t('sheet.loadout.notResting')}
        </button>
      </div>

      {loadout.map((card) => (
        <div className="card domain-card" key={card.id} style={domainStyle(card.domain)}>
          <span className="domain-corner level domain-hex" title={t('sheet.loadout.cardLevelTitle')}>
            {card.level}
          </span>
          <span className="domain-corner recall" title={t('sheet.loadout.recallCostTitle')}>
            ⚡{card.recallCost}
          </span>
          <div className="card-head">
            <span>
              <span className="domain-type">
                {prettify(card.domain)} · {prettify(card.type)}
              </span>
              <br />
              <span className="domain-title">{card.name}</span>
            </span>
            <button type="button" onClick={() => onVault(card.id)}>
              {t('sheet.loadout.sendToVault')}
            </button>
          </div>
          <p className="card-text">{card.text}</p>
        </div>
      ))}

      <SectionHead>{t('sheet.loadout.vaultTitle')}</SectionHead>
      {vault.length === 0 ? <p className="muted">{t('sheet.loadout.vaultEmpty')}</p> : null}

      {full && vault.length > 0 ? (
        <div className="mb-3">
          <label htmlFor="vaulting">{t('sheet.loadout.chooseToVault')}</label>
          <select
            id="vaulting"
            value={vaulting}
            onChange={(event) => setVaulting(event.target.value)}
          >
            <option value="">{t('sheet.loadout.chooseCardPlaceholder')}</option>
            {loadout.map((card) => (
              <option key={card.id} value={card.id}>
                {card.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {vault.map((card) => (
        <div className="card domain-card" key={card.id} style={domainStyle(card.domain)}>
          <span className="domain-corner level domain-hex" title={t('sheet.loadout.cardLevelTitle')}>
            {card.level}
          </span>
          <span className="domain-corner recall" title={t('sheet.loadout.recallCostTitle')}>
            ⚡{card.recallCost}
          </span>
          <div className="card-head">
            <span className="domain-title">{card.name}</span>
            <button
              type="button"
              disabled={full && vaulting === ''}
              onClick={() => onRecall(card.id, vaulting === '' ? undefined : vaulting)}
            >
              {duringRest
                ? t('sheet.loadout.recall')
                : t('sheet.loadout.recallWithCost', { cost: card.recallCost })}
            </button>
          </div>
          <span className="domain-type">{prettify(card.domain)}</span>
        </div>
      ))}
    </div>
  );
}
