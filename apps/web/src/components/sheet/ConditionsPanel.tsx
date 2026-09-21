import { STANDARD_CONDITIONS } from '@daggerheart/rules';
import { useState } from 'react';

import { t, type MessageKey } from '../../i18n/index.js';
import { SectionHead } from '../SectionHead.js';

interface ConditionsPanelProps {
  /** Conditions applied by features and effects. */
  conditions: readonly string[];
  /**
   * Set when the Stress track is full, which makes a character Vulnerable until
   * they clear one. Shown alongside the applied ones but not editable, since it is
   * the track that decides it.
   */
  vulnerableFromStress: boolean;
  onChange: (conditions: string[]) => void;
}

/**
 * The conditions on a character. The three standard ones are toggles; anything a
 * feature invented is typed in and kept as the text it printed.
 */
export function ConditionsPanel({
  conditions,
  vulnerableFromStress,
  onChange,
}: ConditionsPanelProps) {
  const [custom, setCustom] = useState('');

  const has = (condition: string) => conditions.includes(condition);
  const toggle = (condition: string) =>
    onChange(
      has(condition) ? conditions.filter((c) => c !== condition) : [...conditions, condition],
    );

  const others = conditions.filter(
    (condition) => !STANDARD_CONDITIONS.includes(condition as never),
  );

  const add = () => {
    const name = custom.trim();
    if (name === '' || has(name)) return;
    onChange([...conditions, name]);
    setCustom('');
  };

  return (
    <div className="panel">
      <SectionHead>{t('sheet.conditions.title')}</SectionHead>

      <div className="row">
        {STANDARD_CONDITIONS.map((condition) => (
          <button
            key={condition}
            type="button"
            className="option w-auto"
            aria-pressed={has(condition)}
            title={t(`sheet.conditions.${condition}.hint` as MessageKey)}
            onClick={() => toggle(condition)}
          >
            {t(`sheet.conditions.${condition}` as MessageKey)}
          </button>
        ))}
      </div>

      {vulnerableFromStress && !has('vulnerable') ? (
        <p className="muted">{t('sheet.conditions.fromStress')}</p>
      ) : null}

      {others.length > 0 ? (
        <div className="row mt-3">
          {others.map((condition) => (
            <button
              key={condition}
              type="button"
              className="badge"
              title={t('sheet.conditions.remove')}
              onClick={() => onChange(conditions.filter((c) => c !== condition))}
            >
              {condition} ✕
            </button>
          ))}
        </div>
      ) : null}

      <div className="row mt-3">
        <input
          value={custom}
          placeholder={t('sheet.conditions.customPlaceholder')}
          aria-label={t('sheet.conditions.customPlaceholder')}
          onChange={(event) => setCustom(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') add();
          }}
        />
        <button type="button" disabled={custom.trim() === ''} onClick={add}>
          {t('sheet.conditions.add')}
        </button>
      </div>
    </div>
  );
}
