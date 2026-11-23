import type { DomainCard } from '@daggerheart/srd-data';
import { MAX_LOADOUT } from '@daggerheart/rules';
import { useState } from 'react';

import { t } from '../../i18n/index.js';
import { cardTypeLabel } from '../../state/domains.js';
import { DomainBadge, domainStyle } from '../Domain.js';
import { SectionHead } from '../SectionHead.js';
import { hotbarDrag } from './Hotbar.js';

interface LoadoutPanelProps {
  loadout: readonly DomainCard[];
  vault: readonly DomainCard[];
  /** Whether the party is resting, which makes swaps free (SRD p.9). */
  /** Whether the party is resting, which makes recalling free. */
  duringRest: boolean;
  /**
   * Set when the rest is the table's, not this device's: in a campaign the GM
   * opens downtime, so there is nothing here to toggle.
   */
  restIsShared?: boolean;
  onToggleRest: () => void;
  onRecall: (cardId: string, vaulting: string | undefined) => void;
  onVault: (cardId: string) => void;
  /** Opens the use dialog for a loadout card (pay, roll, damage); only in a campaign. */
  onUse?: ((cardId: string) => void) | undefined;
  /** Lets a loadout card be dragged onto the hotbar, where there is one. */
  draggableCards?: boolean;
}

/** Loadout and vault, with the Stress cost of recalling shown before you commit. */
export function LoadoutPanel({
  loadout,
  vault,
  duringRest,
  restIsShared = false,
  onToggleRest,
  onRecall,
  onVault,
  onUse,
  draggableCards = false,
}: LoadoutPanelProps) {
  const [vaulting, setVaulting] = useState<string>('');
  const full = loadout.length >= MAX_LOADOUT;

  return (
    <div className="panel">
      <SectionHead>
        {t('sheet.loadout.title', { count: loadout.length, max: MAX_LOADOUT })}
      </SectionHead>
      <div className="card-head">
        {restIsShared ? (
          <span className="badge">
            {duringRest ? t('sheet.loadout.resting') : t('sheet.loadout.notResting')}
          </span>
        ) : (
          <button type="button" aria-pressed={duringRest} onClick={onToggleRest}>
            {duringRest ? t('sheet.loadout.resting') : t('sheet.loadout.notResting')}
          </button>
        )}
      </div>

      {loadout.map((card) => (
        <div
          className="card domain-card"
          key={card.id}
          style={domainStyle(card.domain)}
          {...(draggableCards ? hotbarDrag({ kind: 'card', cardId: card.id }) : {})}
        >
          <span className="domain-corner level domain-hex" title={t('sheet.loadout.cardLevelTitle')}>
            {card.level}
          </span>
          <span className="domain-corner recall" title={t('sheet.loadout.recallCostTitle')}>
            ⚡{card.recallCost}
          </span>
          <div className="card-head">
            <span>
              <span className="domain-type">
                <DomainBadge domain={card.domain} /> · {cardTypeLabel(card.type)}
              </span>
              <br />
              <span className="domain-title">{card.name}</span>
            </span>
            <span className="row">
              {onUse === undefined ? null : (
                <button type="button" title={t('sheet.loadout.useTitle')} onClick={() => onUse(card.id)}>
                  {t('sheet.loadout.use')}
                </button>
              )}
              {/* Straight to this card's compendium entry, which carries the
                  full text and whatever it cross-references. */}
              <a href={`#/help#compendium/domainCards/${card.id}`}>
                {t('sheet.loadout.lookUp')}
              </a>
              <button type="button" onClick={() => onVault(card.id)}>
                {t('sheet.loadout.sendToVault')}
              </button>
            </span>
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
          <span className="domain-type">
            <DomainBadge domain={card.domain} />
          </span>
        </div>
      ))}
    </div>
  );
}
