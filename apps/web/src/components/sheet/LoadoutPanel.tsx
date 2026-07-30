import type { DomainCard } from '@daggerheart/srd-data';
import { MAX_LOADOUT } from '@daggerheart/rules';
import { useState, type CSSProperties } from 'react';

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
        Loadout {loadout.length}/{MAX_LOADOUT}
      </SectionHead>
      <div className="card-head">
        <button type="button" aria-pressed={duringRest} onClick={onToggleRest}>
          {duringRest ? 'Resting — swaps are free' : 'Not resting'}
        </button>
      </div>

      {loadout.map((card) => (
        <div className="card domain-card" key={card.id} style={domainStyle(card.domain)}>
          <span className="domain-corner level" title="Card level">
            {card.level}
          </span>
          <span className="domain-corner recall" title="Recall Cost">
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
              Vault
            </button>
          </div>
          <p className="card-text">{card.text}</p>
        </div>
      ))}

      <SectionHead>Vault</SectionHead>
      {vault.length === 0 ? <p className="muted">Nothing vaulted.</p> : null}

      {full && vault.length > 0 ? (
        <div className="mb-3">
          <label htmlFor="vaulting">Loadout is full — card to move out</label>
          <select
            id="vaulting"
            value={vaulting}
            onChange={(event) => setVaulting(event.target.value)}
          >
            <option value="">Choose a card…</option>
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
          <span className="domain-corner level" title="Card level">
            {card.level}
          </span>
          <span className="domain-corner recall" title="Recall Cost">
            ⚡{card.recallCost}
          </span>
          <div className="card-head">
            <span className="domain-title">{card.name}</span>
            <button
              type="button"
              disabled={full && vaulting === ''}
              onClick={() => onRecall(card.id, vaulting === '' ? undefined : vaulting)}
            >
              Recall{duringRest ? '' : ` (${card.recallCost} Stress)`}
            </button>
          </div>
          <span className="domain-type">{prettify(card.domain)}</span>
        </div>
      ))}
    </div>
  );
}
