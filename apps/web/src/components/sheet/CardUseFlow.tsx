import type { PrivateEntry, RoomEvent, Token } from '@daggerheart/protocol';
import type { DomainCard } from '@daggerheart/srd-data';
import { useState } from 'react';

import { t, type MessageKey } from '../../i18n/index.js';
import {
  abilityTitle,
  cardAbilities,
  cardDamage,
  cardRoll,
  costShortfall,
  damageLabel,
  describeCost,
  knownEntryIds,
  landedRoll,
} from '../../state/cardUse.js';
import type { RollEntry } from '../../state/rollLog.js';
import { formatSigned } from '../../state/selectors.js';
import type { SheetState } from '../../state/sheet.js';
import { Dialog } from '../Dialog.js';
import { RollDialog } from './RollDialog.js';

interface CardUseFlowProps {
  card: DomainCard;
  sheet: SheetState;
  /** Sends a character intent; the caller stamps the character id. */
  send: (event: Record<string, unknown> & { type: RoomEvent['type'] }) => void;
  sharedLog: readonly RollEntry[];
  privateLog?: readonly PrivateEntry[] | undefined;
  experiences: readonly { name: string; modifier: number }[];
  canRollPrivately: boolean;
  target: Token | null;
  onClose: () => void;
}

type Step =
  | { kind: 'choose' }
  | { kind: 'roll' }
  /** After the roll (or straight after use, for damage with no roll). */
  | { kind: 'after'; known: ReadonlySet<string> | null; visibility: 'public' | 'private' };

/**
 * Plays a domain card: pick the ability (a grimoire's spell), see what it costs and
 * rolls, use it — the server pays the cost — then roll it and its damage. Shared
 * by the sheet and the map's sheet panel, so "Usar" does the same in both.
 */
export function CardUseFlow({
  card,
  sheet,
  send,
  sharedLog,
  privateLog,
  experiences,
  canRollPrivately,
  target,
  onClose,
}: CardUseFlowProps) {
  const abilities = cardAbilities(card.id);
  const [index, setIndex] = useState(0);
  const [step, setStep] = useState<Step>({ kind: 'choose' });
  const [damageSent, setDamageSent] = useState(false);
  const [successPaid, setSuccessPaid] = useState(false);

  const ability = abilities[index] ?? abilities[0];
  if (ability === undefined) return null;
  const title = abilityTitle(card, ability);
  const roll = cardRoll(card, ability, sheet);
  const damage = cardDamage(ability, sheet);
  const shortfall = costShortfall(sheet, ability.cost);

  const confirm = () => {
    send({ type: 'useDomainCard', cardId: card.id, ability: index });
    if (roll !== null) setStep({ kind: 'roll' });
    else if (damage !== null) setStep({ kind: 'after', known: null, visibility: 'public' });
    else onClose();
  };

  if (step.kind === 'roll' && roll !== null) {
    return (
      <RollDialog
        spec={roll}
        experiences={experiences}
        hope={sheet.hope}
        outcome={null}
        canRollPrivately={canRollPrivately}
        // A printed Difficulty is the card's; a target would replace it with its own.
        target={roll.difficulty === null ? target : null}
        onRoll={(request, visibility) => {
          const known = knownEntryIds(sharedLog, privateLog);
          send({
            type: 'rollDuality',
            request: { ...request, label: roll.title },
            visibility,
            ...(roll.difficulty === null && target !== null ? { targetTokenId: target.id } : {}),
          });
          if (damage === null && ability.successCost === undefined) onClose();
          else setStep({ kind: 'after', known, visibility });
        }}
        onClose={onClose}
      />
    );
  }

  if (step.kind === 'after') {
    const landed = step.known === null ? null : landedRoll(title, step.known, sharedLog, privateLog);
    const failed =
      landed !== null && (landed.outcome === 'failureHope' || landed.outcome === 'failureFear');
    const critical = landed?.outcome === 'criticalSuccess';
    const successCost = describeCost(ability.successCost);
    const successShort = costShortfall(sheet, ability.successCost);
    return (
      <Dialog title={title} onClose={onClose} className="card-use-dialog">
        {step.known === null ? null : landed === null ? (
          <p className="muted" role="status">
            {t('cardUse.waitingRoll')}
          </p>
        ) : (
          <p className="outcome" role="status">
            {t(`roll.outcome.${landed.outcome}` as MessageKey)} · {t('sheet.roll.totalLabel')} {landed.roll.total}
          </p>
        )}
        {failed ? <p className="muted">{t('cardUse.failedNoEffect')}</p> : null}
        <div className="row">
          {damage === null ? null : (
            <button
              type="button"
              className="btn-primary"
              data-autofocus
              disabled={damageSent || failed}
              onClick={() => {
                setDamageSent(true);
                send({
                  type: 'rollDamage',
                  label: damageLabel(card, ability),
                  dice: damage.dice,
                  modifier: damage.modifier,
                  scale: damage.scale,
                  critical,
                  visibility: step.visibility,
                });
              }}
            >
              {critical
                ? t('cardUse.rollDamageCritical', { dice: damage.text })
                : t('cardUse.rollDamage', { dice: damage.text })}
            </button>
          )}
          {successCost.length === 0 ? null : (
            <button
              type="button"
              disabled={successPaid || failed || successShort !== null}
              onClick={() => {
                setSuccessPaid(true);
                send({ type: 'useDomainCard', cardId: card.id, ability: index, onSuccess: true });
              }}
            >
              {t('cardUse.paySuccess', { cost: successCost.join(', ') })}
            </button>
          )}
          <button type="button" onClick={onClose}>
            {t('sheet.roll.done')}
          </button>
        </div>
        {successShort !== null && successCost.length > 0 && !successPaid ? (
          <p className="field-error">{successShort}</p>
        ) : null}
      </Dialog>
    );
  }

  const cost = describeCost(ability.cost);
  const successCost = describeCost(ability.successCost);
  return (
    <Dialog title={card.name} onClose={onClose} className="card-use-dialog">
      {abilities.length > 1 ? (
        <fieldset className="card-use-choices">
          <legend>{t(card.type === 'grimoire' ? 'cardUse.chooseSpell' : 'cardUse.chooseAbility')}</legend>
          {abilities.map((option, i) => (
            <button
              key={`${option.name ?? ''}-${i}`}
              type="button"
              className="card-use-choice"
              aria-pressed={i === index}
              onClick={() => setIndex(i)}
            >
              {option.name ?? card.name}
            </button>
          ))}
        </fieldset>
      ) : null}

      <dl className="card-use-summary">
        <dt>{t('cardUse.costLabel')}</dt>
        <dd>{cost.length === 0 ? t('cardUse.noCost') : cost.join(' · ')}</dd>
        {successCost.length === 0 ? null : (
          <>
            <dt>{t('cardUse.successCostLabel')}</dt>
            <dd>{successCost.join(' · ')}</dd>
          </>
        )}
        <dt>{t('cardUse.rollLabel')}</dt>
        <dd>
          {roll === null
            ? t('cardUse.noRoll')
            : `${roll.modifierLabel} ${formatSigned(roll.modifiers)}${
                roll.difficulty === null ? '' : ` · ${t('cardUse.difficulty', { difficulty: roll.difficulty })}`
              }`}
        </dd>
        {damage === null ? null : (
          <>
            <dt>{t('cardUse.damageLabel')}</dt>
            <dd>{damage.text}</dd>
          </>
        )}
      </dl>

      {shortfall === null ? null : (
        <p className="field-error" role="alert">
          {shortfall}
        </p>
      )}
      <div className="row">
        <button
          type="button"
          className="btn-primary"
          data-autofocus
          disabled={shortfall !== null}
          onClick={confirm}
        >
          {roll === null ? t('cardUse.use') : t('cardUse.useAndRoll')}
        </button>
        <button type="button" onClick={onClose}>
          {t('cardUse.cancel')}
        </button>
      </div>
    </Dialog>
  );
}
