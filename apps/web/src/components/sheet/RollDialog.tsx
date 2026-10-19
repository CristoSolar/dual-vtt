import type { Token, Visibility } from '@daggerheart/protocol';
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
  /** Experiences ticked when the dialog opens, as a hotbar slot asks for. */
  presetExperiences?: readonly string[];
  hope: number;
  outcome: DualityRollOutcome | null;
  /**
   * Offers a private roll — the roller's and the GM's only. Off offline, where
   * nobody else could see it anyway, and for a roll the table shares.
   */
  canRollPrivately?: boolean;
  /** The roller's first target, which the caller sends the roll against. */
  target?: Token | null;
  onRoll: (request: Omit<DualityRollRequest, 'label'>, visibility: Visibility) => void;
  onClose: () => void;
}

/** Collects Difficulty, advantage, and Experience spend, then shows the result. */
export function RollDialog({
  spec,
  experiences,
  presetExperiences = [],
  hope,
  outcome,
  canRollPrivately = false,
  target = null,
  onRoll,
  onClose,
}: RollDialogProps) {
  const [difficulty, setDifficulty] = useState(10);
  const [advantage, setAdvantage] = useState(0);
  const [disadvantage, setDisadvantage] = useState(0);
  /** Allies spending a Hope to help. Each rolls a die; the best one counts. */
  const [helpDice, setHelpDice] = useState(0);
  /** A reaction earns no Hope or Fear, which changes what the roll is worth. */
  const [reaction, setReaction] = useState(false);
  const [chosen, setChosen] = useState<readonly string[]>(presetExperiences);
  const [isPrivate, setIsPrivate] = useState(false);

  const selected = experiences.filter((e) => chosen.includes(e.name));
  const hopeCost = selected.length;
  // The request carries names only; the modifiers are read from the character,
  // on the server in a campaign and from the same sheet offline.
  const selectedNames = selected.map((e) => e.name);
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
          {target === null ? null : (
            <p>
              <strong>{t('sheet.roll.target', { name: target.name })}</strong>
              {/* The server reads an adversary's Difficulty off its stat block. */}
              {target.kind === 'adversary' ? (
                <span className="muted"> {t('sheet.roll.targetDifficulty')}</span>
              ) : null}
            </p>
          )}

          <div className="grid cols-3">
            <div>
              <label htmlFor="difficulty">{t('sheet.roll.difficulty')}</label>
              <input
                id="difficulty"
                type="number"
                value={difficulty}
                min={1}
                // Clearing a number input reads as an empty string, which would
                // otherwise roll against a Difficulty of 0.
                onChange={(event) => setDifficulty(Math.max(1, Number(event.target.value) || 1))}
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

          <div>
            <label htmlFor="help-dice">{t('sheet.roll.helpDice')}</label>
            <input
              id="help-dice"
              type="number"
              min={0}
              max={6}
              value={helpDice}
              onChange={(event) =>
                setHelpDice(Math.min(6, Math.max(0, Number(event.target.value) || 0)))
              }
            />
            <p className="muted">{t('sheet.roll.helpDiceHint')}</p>
          </div>

          <div className="mt-3">
            <button type="button" aria-pressed={reaction} onClick={() => setReaction((v) => !v)}>
              {reaction ? t('sheet.roll.isReaction') : t('sheet.roll.isAction')}
            </button>
            <p className="muted">{t('sheet.roll.reactionHint')}</p>
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

          {canRollPrivately ? (
            <label htmlFor="roll-private">
              <input
                id="roll-private"
                type="checkbox"
                checked={isPrivate}
                onChange={(event) => setIsPrivate(event.target.checked)}
              />{' '}
              {t('roll.privateToggle')}
            </label>
          ) : null}

          <button
            type="button"
            disabled={!canAfford}
            onClick={() =>
              onRoll(
                {
                  modifiers: spec.modifiers,
                  difficulty,
                  advantage,
                  disadvantage,
                  helpDice,
                  reaction,
                  experiences: selectedNames,
                },
                canRollPrivately && isPrivate ? 'private' : 'public',
              )
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
