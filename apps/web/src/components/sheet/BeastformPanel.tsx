import { formatDice, srd } from '@daggerheart/srd-data';

import { t } from '../../i18n/index.js';
import { label as prettify } from '../../state/selectors.js';
import { SectionHead } from '../SectionHead.js';

interface BeastformPanelProps {
  /** The form the character is in, by id, or null. */
  beastform: string | null;
  /** Forms above this tier are not offered. */
  tier: number;
  onChange: (beastformId: string | null) => void;
}

/**
 * The Druid's Beastform (SRD 2.0 p.20).
 *
 * Entering costs a Stress and is limited to the character's tier or lower, so the
 * list only offers what the server would accept. Dropping out is free, and marking
 * the last Hit Point drops the character out on its own.
 */
export function BeastformPanel({ beastform, tier, onChange }: BeastformPanelProps) {
  const forms = srd().beastforms.filter((form) => form.tier <= tier);
  const current = srd().beastforms.find((form) => form.id === beastform) ?? null;

  return (
    <div className="panel">
      <SectionHead>{t('sheet.beastform.title')}</SectionHead>
      <p className="muted">{t('sheet.beastform.cost')}</p>

      <label htmlFor="beastform">{t('sheet.beastform.pick')}</label>
      <select
        id="beastform"
        value={beastform ?? ''}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      >
        <option value="">{t('sheet.beastform.none')}</option>
        {forms.map((form) => (
          <option key={form.id} value={form.id}>
            {form.name} · {t('sheet.beastform.tier', { tier: form.tier })}
          </option>
        ))}
      </select>

      {current === null ? (
        <p className="muted">{t('sheet.beastform.hint')}</p>
      ) : (
        <>
          <p className="muted">{current.examples}</p>
          {current.evasionBonus !== null ? (
            <p>{t('sheet.beastform.evasion', { bonus: current.evasionBonus })}</p>
          ) : null}
          {current.trait !== null && current.traitBonus !== null ? (
            <p>
              {t('sheet.beastform.trait', {
                trait: prettify(current.trait),
                bonus: current.traitBonus,
              })}
            </p>
          ) : null}
          {current.attack !== null ? (
            <p>
              {t('sheet.beastform.attack', {
                trait: prettify(current.attack.trait),
                range: prettify(current.attack.range),
                damage: formatDice(current.attack.damage),
              })}
            </p>
          ) : null}
          {current.advantages.length > 0 ? (
            <p>{t('sheet.beastform.advantages', { list: current.advantages.join(', ') })}</p>
          ) : null}
          {current.features.map((feature) => (
            <p className="card-text" key={feature.name}>
              <strong>{feature.name}:</strong> {feature.text}
            </p>
          ))}
        </>
      )}
    </div>
  );
}
