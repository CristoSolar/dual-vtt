import { srd } from '@daggerheart/srd-data';

import { t } from '../../i18n/index.js';
import { SectionHead } from '../SectionHead.js';

interface TransformationPanelProps {
  /** The transformation this character carries, by id, or null. */
  transformation: string | null;
  onChange: (transformation: string | null) => void;
}

/**
 * The one transformation a character can carry (SRD 2.0 p.42).
 *
 * It is not a domain card: it does not count against the loadout maximum, and a
 * character can only have one, so this is a choice rather than a list.
 */
export function TransformationPanel({ transformation, onChange }: TransformationPanelProps) {
  const all = srd().transformations;
  const current = all.find((entry) => entry.id === transformation) ?? null;

  return (
    <div className="panel">
      <SectionHead>{t('sheet.transformation.title')}</SectionHead>

      <label htmlFor="transformation">{t('sheet.transformation.pick')}</label>
      <select
        id="transformation"
        value={transformation ?? ''}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      >
        <option value="">{t('sheet.transformation.none')}</option>
        {all.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name}
          </option>
        ))}
      </select>

      {current === null ? (
        <p className="muted">{t('sheet.transformation.hint')}</p>
      ) : (
        <>
          {current.features.map((feature) => (
            <p className="card-text" key={feature.name}>
              <strong>{feature.name}:</strong> {feature.text}
            </p>
          ))}
          <details>
            <summary>{t('sheet.transformation.questions')}</summary>
            <ul>
              {current.questions.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
