import { useState } from 'react';

import { t, type MessageKey } from '../../i18n/index.js';
import { outcomeTone } from '../../state/rollLog.js';
import type { DualityRollOutcome, DualityRollRequest } from '../../state/sheet.js';
import { formatSigned } from '../../state/selectors.js';
import { Dialog } from '../Dialog.js';

export interface RollDialogSpec {
  title: string;
  /** Flat modifier already resolved by the caller (trait, Proficiency, and so on). */
  modifiers: number;
  modifierLabel: string;
}

interface RollDialogProps {
  spec: RollDialogSpec;
  /** Experiences the character has, offered as an optional Hope spend. */
  experiences: readonly { name: string; modifier: number }[];
  hope: number;
  outcome: DualityRollOutcome | null;
  onRoll: (request: Omit<DualityRollRequest, 'label'>) => void;
  onClose: () => void;
}

/** Collects Difficulty, advantage, and Experience spend, then shows the result. */
export function RollDialog({
  spec,
  experiences,
  hope,
  outcome,
  onRoll,
  onClose,
}: RollDialogProps) {
  const [difficulty, setDifficulty] = useState(10);
  const [advantage, setAdvantage] = useState(0);
  const [disadvantage, setDisadvantage] = useState(0);
  const [chosen, setChosen] = useState<readonly string[]>([]);

  const selected = experiences.filter((e) => chosen.includes(e.name));
  const hopeCost = selected.length;
  const canAfford = hopeCost <= hope;

  const toggleExperience = (name: string) => {
    setChosen((current) =>
      current.includes(name) ? current.filter((n) => n !== name) : [...current, name],
    );
  };

  return (
    <Dialog title={spec.title} onClose={onClose}>
      {outcome === null ? (
        <>
          <p className="muted">
            {spec.modifierLabel}: {formatSigned(spec.modifiers)}
          </p>

          <div className="grid cols-3">
            <div>
              <label htmlFor="difficulty">{t('sheet.roll.difficulty')}</label>
              <input
                id="difficulty"
                type="number"
                value={difficulty}
                min={1}
                onChange={(event) => setDifficulty(Number(event.target.value))}
              />
            </div>
            <div>
              <label htmlFor="advantage">{t('sheet.roll.advantageDice')}</label>
              <input
                id="advantage"
                type="number"
                min={0}
                value={advantage}
                onChange={(event) => setAdvantage(Math.max(0, Number(event.target.value)))}
              />
            </div>
            <div>
              <label htmlFor="disadvantage">{t('sheet.roll.disadvantageDice')}</label>
              <input
                id="disadvantage"
                type="number"
                min={0}
                value={disadvantage}
                onChange={(event) => setDisadvantage(Math.max(0, Number(event.target.value)))}
              />
            </div>
          </div>

          {experiences.length > 0 ? (
            <fieldset>
              <legend>{t('sheet.roll.useExperience')}</legend>
              <div className="row">
                {experiences.map((experience) => (
                  <button
                    key={experience.name}
                    type="button"
                    className="option w-auto"
                    aria-pressed={chosen.includes(experience.name)}
                    onClick={() => toggleExperience(experience.name)}
                  >
                    {experience.name} {formatSigned(experience.modifier)}
                  </button>
                ))}
              </div>
              <p className="muted">
                {t('sheet.roll.spendingHope', { cost: hopeCost, hope })}
                {canAfford ? '' : ` ${t('sheet.roll.notEnoughHopeInline')}`}
              </p>
            </fieldset>
          ) : null}

          <button
            type="button"
            disabled={!canAfford}
            onClick={() =>
              onRoll({
                modifiers: spec.modifiers,
                difficulty,
                advantage,
                disadvantage,
                experiences: selected,
              })
            }
          >
            {t('sheet.roll.rollButton')}
          </button>
        </>
      ) : (
        <RollOutcome outcome={outcome} difficulty={difficulty} onClose={onClose} />
      )}
    </Dialog>
  );
}

function RollOutcome({
  outcome,
  difficulty,
  onClose,
}: {
  outcome: DualityRollOutcome;
  difficulty: number;
  onClose: () => void;
}) {
  const { roll, result } = outcome;
  return (
    <>
      <div className="roll-result">
        <div className="die hope">
          <span className="die-value">{roll.hope}</span>
          <span className="die-label">{t('sheet.roll.hopeLabel')}</span>
        </div>
        <div className="die fear">
          <span className="die-value">{roll.fear}</span>
          <span className="die-label">{t('sheet.roll.fearLabel')}</span>
        </div>
        {roll.advantageRoll !== null ? (
          <div className="die">
            <span className="die-value">+{roll.advantageRoll}</span>
            <span className="die-label">{t('sheet.roll.advantageLabel')}</span>
          </div>
        ) : null}
        {roll.disadvantageRoll !== null ? (
          <div className="die">
            <span className="die-value">−{roll.disadvantageRoll}</span>
            <span className="die-label">{t('sheet.roll.disadvantageLabel')}</span>
          </div>
        ) : null}
        {roll.modifiers !== 0 ? (
          <div className="die">
            <span className="die-value">{formatSigned(roll.modifiers)}</span>
            <span className="die-label">{t('sheet.roll.modifierLabel')}</span>
          </div>
        ) : null}
        <div className="die">
          <span className="die-value">{roll.total}</span>
          <span className="die-label">{t('sheet.roll.totalLabel')}</span>
        </div>
      </div>

      <p className="outcome" data-tone={outcomeTone(result.outcome)}>
        {t(`roll.outcome.${result.outcome}` as MessageKey)}
      </p>
      <p className="muted">
        {t('sheet.roll.vsDifficulty', { difficulty })}
        {result.criticalDamage ? t('sheet.roll.criticalDamage') : ''}
        {result.hopeGained > 0 ? t('sheet.roll.hopeGained', { amount: result.hopeGained }) : ''}
        {result.fearGained > 0 ? t('sheet.roll.fearGained', { amount: result.fearGained }) : ''}
        {result.stressCleared > 0
          ? t('sheet.roll.stressCleared', { amount: result.stressCleared })
          : ''}
      </p>

      <button type="button" onClick={onClose}>
        {t('sheet.roll.done')}
      </button>
    </>
  );
}
