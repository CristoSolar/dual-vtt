import type { IncomingDamageType } from '@daggerheart/rules';
import { useState } from 'react';

import { t } from '../../i18n/index.js';
import type { TakeDamageOptions } from '../../state/sheet.js';
import { Dialog } from '../Dialog.js';

interface DamageDialogProps {
  /** Armor Slots still unmarked, so the field can't offer more than exist. */
  armorSlotsAvailable: number;
  thresholds: { major: number; severe: number };
  onApply: (options: TakeDamageOptions) => void;
  onClose: () => void;
}

/** Enters incoming damage and how it's being soaked; the rules decide the result. */
export function DamageDialog({
  armorSlotsAvailable,
  thresholds,
  onApply,
  onClose,
}: DamageDialogProps) {
  const [incoming, setIncoming] = useState(0);
  const [damageType, setDamageType] = useState<IncomingDamageType>('physical');
  const [direct, setDirect] = useState(false);
  const [armorSlotsToMark, setArmorSlots] = useState(0);

  const maxSlots = direct ? 0 : armorSlotsAvailable;

  return (
    <Dialog title={t('sheet.damage.title')} onClose={onClose}>
      <p className="muted">
        {t('sheet.damage.thresholdsLine', {
          major: thresholds.major,
          severe: thresholds.severe,
        })}
      </p>

      <div className="grid cols-2">
        <div>
          <label htmlFor="incoming">{t('sheet.damage.incomingLabel')}</label>
          <input
            id="incoming"
            type="number"
            min={0}
            value={incoming}
            onChange={(event) => setIncoming(Math.max(0, Number(event.target.value)))}
          />
        </div>
        <div>
          <label htmlFor="damage-type">{t('sheet.damage.typeLabel')}</label>
          <select
            id="damage-type"
            value={damageType}
            onChange={(event) => setDamageType(event.target.value as IncomingDamageType)}
          >
            <option value="physical">{t('damageType.physical')}</option>
            <option value="magic">{t('damageType.magic')}</option>
            <option value="both">{t('sheet.damage.bothTypes')}</option>
          </select>
        </div>
      </div>

      <fieldset>
        <legend>{t('sheet.damage.reductionLegend')}</legend>
        <div className="row">
          <button
            type="button"
            aria-pressed={direct}
            onClick={() => {
              const next = !direct;
              setDirect(next);
              if (next) setArmorSlots(0);
            }}
          >
            {direct ? t('sheet.damage.directOn') : t('sheet.damage.directOff')}
          </button>
        </div>

        <div className="mt-3">
          <label htmlFor="armor-slots">
            {t('sheet.damage.armorSlotsLabel', { available: armorSlotsAvailable })}
          </label>
          <input
            id="armor-slots"
            type="number"
            min={0}
            max={maxSlots}
            disabled={direct || armorSlotsAvailable === 0}
            value={armorSlotsToMark}
            onChange={(event) =>
              setArmorSlots(Math.max(0, Math.min(maxSlots, Number(event.target.value))))
            }
          />
          {direct ? (
            <p className="field-error">{t('sheet.damage.directError')}</p>
          ) : null}
        </div>
      </fieldset>

      <button
        type="button"
        onClick={() => onApply({ incoming, damageType, direct, armorSlotsToMark })}
      >
        {t('sheet.damage.apply')}
      </button>
    </Dialog>
  );
}
