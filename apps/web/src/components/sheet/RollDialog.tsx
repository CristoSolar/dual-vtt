import type { Token, Visibility } from '@daggerheart/protocol';
import { useId, useState, type KeyboardEvent } from 'react';

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
  /**
   * A Difficulty the roll's source prints, like a spell's "Spellcast Roll (13)".
   * Sent with the roll so the server judges it; absent, the GM or the target does.
   */
  difficulty?: number | null;
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

/**
 * One advantage die is the player's own; every die past it is an ally using Help
 * an Ally (SRD 2.0 p.49), the only way a roll carries more than one.
 */
const MAX_ADVANTAGE = 7;
/** Disadvantage sources cancel advantage one for one; a few is plenty to show. */
const MAX_DISADVANTAGE = 5;

/**
 * Maps the two steppers onto the request. The first advantage die is the
 * player's own source; the rest arrive as `helpDice`, which is the exception the
 * rules engine already allows. Disadvantage sources go as they are and cancel.
 */
export function edgeRequest(
  advantage: number,
  disadvantage: number,
): Pick<DualityRollRequest, 'advantage' | 'disadvantage' | 'helpDice'> {
  return {
    advantage: advantage > 0 ? 1 : 0,
    disadvantage,
    helpDice: Math.max(0, advantage - 1),
  };
}

/**
 * Sets up a Duality roll: the dice sit in the middle, disadvantage to their left
 * and advantage to their right, Experiences below. The player never sets a
 * Difficulty — the GM keeps it, or the target supplies its own.
 */
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
  const [advantage, setAdvantage] = useState(0);
  const [disadvantage, setDisadvantage] = useState(0);
  /** A reaction earns no Hope or Fear, which changes what the roll is worth. */
  const [reaction, setReaction] = useState(false);
  const [chosen, setChosen] = useState<readonly string[]>(presetExperiences);
  const [isPrivate, setIsPrivate] = useState(false);

  const selected = experiences.filter((e) => chosen.includes(e.name));
  const hopeCost = selected.length;
  const hopeLeft = hope - hopeCost;
  const canAfford = hopeLeft >= 0;
  const experienceBonus = selected.reduce((sum, e) => sum + e.modifier, 0);

  const toggleExperience = (name: string) => {
    setChosen((current) =>
      current.includes(name) ? current.filter((n) => n !== name) : [...current, name],
    );
  };

  const roll = () => {
    if (!canAfford) return;
    onRoll(
      {
        modifiers: spec.modifiers,
        // The GM keeps the Difficulty, a targeted adversary supplies its own, and
        // a card that prints one sends it.
        difficulty: spec.difficulty ?? null,
        ...edgeRequest(advantage, disadvantage),
        reaction,
        // Names only: the modifiers are read off the character, on the server in
        // a campaign and from the same sheet offline.
        experiences: selected.map((e) => e.name),
      },
      canRollPrivately && isPrivate ? 'private' : 'public',
    );
  };

  // Enter rolls from anywhere that is not itself a control; a focused button
  // keeps its own Enter.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter') return;
    const el = event.target as HTMLElement;
    if (el.closest('button, input, select, textarea, a') !== null) return;
    event.preventDefault();
    roll();
  };

  // What the server will roll, mirrored from the request: the player's own
  // advantage cancels against disadvantage, allies' dice do not, and only the
  // highest advantage die is added.
  const edge = edgeRequest(advantage, disadvantage);
  const net = edge.advantage - edge.disadvantage;
  const addsD6 = net > 0 || (edge.helpDice ?? 0) > 0;
  const subtractsD6 = net < 0;
  const formula = [
    '2d12',
    addsD6 ? '+ d6' : null,
    subtractsD6 ? '− d6' : null,
    spec.modifiers + experienceBonus === 0
      ? null
      : `${spec.modifiers + experienceBonus < 0 ? '−' : '+'} ${Math.abs(spec.modifiers + experienceBonus)}`,
  ]
    .filter((part) => part !== null)
    .join(' ');

  return (
    <Dialog title={spec.title} onClose={onClose} className="roll-dialog">
      {outcome === null ? (
        <div className="roll-stage" onKeyDown={onKeyDown}>
          <p className="roll-modifier">
            <span>{spec.modifierLabel}</span>
            <strong>{formatSigned(spec.modifiers)}</strong>
          </p>
          {spec.difficulty === undefined || spec.difficulty === null ? null : (
            <p className="roll-target">
              <strong>{t('sheet.roll.fixedDifficulty', { difficulty: spec.difficulty })}</strong>
            </p>
          )}
          {target === null ? null : (
            <p className="roll-target">
              <strong>{t('sheet.roll.target', { name: target.name })}</strong>
              {/* The server reads an adversary's Difficulty off its stat block. */}
              {target.kind === 'adversary' ? (
                <span className="muted"> {t('sheet.roll.targetDifficulty')}</span>
              ) : null}
            </p>
          )}

          <div className="roll-arena">
            <EdgeStepper
              kind="disadvantage"
              value={disadvantage}
              max={MAX_DISADVANTAGE}
              onChange={setDisadvantage}
            />

            <div className="roll-centre">
              <button
                type="button"
                className="duality-pair"
                data-autofocus
                disabled={!canAfford}
                aria-label={t('sheet.roll.diceAria')}
                onClick={roll}
              >
                <D12 tone="hope" />
                <D12 tone="fear" />
              </button>
              <p className="roll-formula" aria-live="polite">
                {formula}
              </p>
              <p className="roll-caption">{t('sheet.roll.clickToRoll')}</p>
              <button type="button" className="btn-primary roll-go" disabled={!canAfford} onClick={roll}>
                {t('sheet.roll.rollButton')}
              </button>
            </div>

            <EdgeStepper
              kind="advantage"
              value={advantage}
              max={MAX_ADVANTAGE}
              onChange={setAdvantage}
              hint={advantage > 1 ? t('sheet.roll.helpHint') : null}
            />
          </div>

          {experiences.length > 0 ? (
            <section className="roll-experiences" aria-labelledby="roll-exp-head">
              <h3 id="roll-exp-head">{t('sheet.roll.experiences')}</h3>
              <div className="exp-cards">
                {experiences.map((experience) => {
                  const on = chosen.includes(experience.name);
                  return (
                    <button
                      key={experience.name}
                      type="button"
                      className="exp-card"
                      aria-pressed={on}
                      // Ticking one more needs a Hope to pay for it; untick always works.
                      disabled={!on && hopeLeft <= 0}
                      onClick={() => toggleExperience(experience.name)}
                    >
                      <span className="exp-bonus">{formatSigned(experience.modifier)}</span>
                      <span className="exp-sigil" aria-hidden="true">
                        <span>{experience.name.trim().charAt(0).toUpperCase()}</span>
                      </span>
                      <span className="exp-name">{experience.name}</span>
                      <span className="exp-cost">{t('sheet.roll.costsHope')}</span>
                    </button>
                  );
                })}
              </div>
              <p className="roll-hope" data-short={canAfford ? undefined : 'true'} role="status">
                {canAfford
                  ? hopeCost > 0
                    ? t('sheet.roll.experienceSummary', { bonus: experienceBonus, left: hopeLeft })
                    : t('sheet.roll.experienceNone', { hope })
                  : t('sheet.roll.notEnoughHopeInline')}
              </p>
            </section>
          ) : null}

          <div className="roll-options">
            {canRollPrivately ? (
              <Switch on={isPrivate} onToggle={() => setIsPrivate((v) => !v)}>
                {t('roll.privateToggle')}
              </Switch>
            ) : null}
            <Switch
              on={reaction}
              onToggle={() => setReaction((v) => !v)}
              tip={t('sheet.roll.reactionHint')}
            >
              {t('sheet.roll.reaction')}
            </Switch>
          </div>
        </div>
      ) : (
        <RollOutcome outcome={outcome} onClose={onClose} />
      )}
    </Dialog>
  );
}

/** − count + with the dice it adds drawn underneath. */
function EdgeStepper({
  kind,
  value,
  max,
  onChange,
  hint = null,
}: {
  kind: 'advantage' | 'disadvantage';
  value: number;
  max: number;
  onChange: (next: number) => void;
  hint?: string | null;
}) {
  const id = useId();
  const what = t(`sheet.roll.${kind}` as MessageKey);
  return (
    <div className="edge-stepper" data-kind={kind} role="group" aria-labelledby={id}>
      <span className="edge-label" id={id}>
        {what}
      </span>
      <div className="edge-controls">
        <button
          type="button"
          className="edge-step"
          aria-label={t('sheet.roll.less', { what })}
          disabled={value <= 0}
          onClick={() => onChange(Math.max(0, value - 1))}
        >
          −
        </button>
        <output className="edge-count" aria-live="polite">
          {value}
        </output>
        <button
          type="button"
          className="edge-step"
          aria-label={t('sheet.roll.more', { what })}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
        >
          +
        </button>
      </div>
      <div className="edge-dice" aria-hidden="true">
        {value === 0 ? <D6 ghost /> : Array.from({ length: value }, (_, i) => <D6 key={i} />)}
      </div>
      {hint === null ? null : <p className="edge-hint">{hint}</p>}
    </div>
  );
}

/** A switch: a real button with role="switch", so it reads and acts as one. */
function Switch({
  on,
  onToggle,
  tip,
  children,
}: {
  on: boolean;
  onToggle: () => void;
  tip?: string;
  children: string;
}) {
  const tipId = useId();
  return (
    <span className="roll-switch-wrap">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        className="roll-switch"
        onClick={onToggle}
        {...(tip === undefined ? {} : { 'aria-describedby': tipId })}
      >
        <span className="roll-switch-track" aria-hidden="true">
          <span className="roll-switch-thumb" />
        </span>
        {children}
      </button>
      {tip === undefined ? null : (
        <span className="roll-tip">
          <span className="roll-tip-mark" aria-hidden="true">
            ?
          </span>
          <span className="roll-tip-text" role="tooltip" id={tipId}>
            {tip}
          </span>
        </span>
      )}
    </span>
  );
}

// A d12 seen face on: a pentagon in the middle, ringed by five facets that reach
// out to a decagon silhouette. Computed once; the numbers are SVG user units.
const point = (radius: number, degrees: number) => {
  const r = (degrees * Math.PI) / 180;
  return [50 + radius * Math.cos(r), 50 + radius * Math.sin(r)] as const;
};
const fmt = (p: readonly [number, number]) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
const INNER = Array.from({ length: 5 }, (_, k) => point(21, -90 + k * 72));
const OUTER = Array.from({ length: 10 }, (_, k) => point(47, -90 + k * 36));
const FACE = INNER.map(fmt).join(' ');
const FACETS = INNER.map((p, k) => {
  const next = INNER[(k + 1) % 5] ?? p;
  const ring = [OUTER[2 * k], OUTER[2 * k + 1], OUTER[(2 * k + 2) % 10]];
  return [p, ...ring, next].map((q) => fmt(q ?? p)).join(' ');
});

function D12({ tone }: { tone: 'hope' | 'fear' }) {
  return (
    <span className="d12" data-tone={tone}>
      <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        {FACETS.map((points, i) => (
          <polygon key={points} className={`d12-facet f${i}`} points={points} />
        ))}
        <polygon className="d12-face" points={FACE} />
        <text className="d12-num" x="50" y="51" textAnchor="middle" dominantBaseline="middle">
          12
        </text>
      </svg>
      <span className="d12-name">
        {t(tone === 'hope' ? 'sheet.roll.hopeLabel' : 'sheet.roll.fearLabel')}
      </span>
    </span>
  );
}

function D6({ ghost = false }: { ghost?: boolean }) {
  return (
    <svg className="d6" data-ghost={ghost ? 'true' : undefined} viewBox="0 0 20 20" focusable="false">
      <rect x="1.5" y="1.5" width="17" height="17" rx="3.5" />
      <circle cx="6" cy="6" r="1.6" />
      <circle cx="14" cy="6" r="1.6" />
      <circle cx="10" cy="10" r="1.6" />
      <circle cx="6" cy="14" r="1.6" />
      <circle cx="14" cy="14" r="1.6" />
    </svg>
  );
}

function RollOutcome({ outcome, onClose }: { outcome: DualityRollOutcome; onClose: () => void }) {
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
        {result.success === null ? t('sheet.roll.gmJudges') : ''}
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
