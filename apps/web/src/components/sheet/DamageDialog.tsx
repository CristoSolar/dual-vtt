import type { IncomingDamageType } from '@daggerheart/rules';
import { useState } from 'react';

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
    <Dialog title="Take damage" onClose={onClose}>
      <p className="muted">
        Major {thresholds.major} · Severe {thresholds.severe}
      </p>

      <div className="grid cols-2">
        <div>
          <label htmlFor="incoming">Incoming damage</label>
          <input
            id="incoming"
            type="number"
            min={0}
            value={incoming}
            onChange={(event) => setIncoming(Math.max(0, Number(event.target.value)))}
          />
        </div>
        <div>
          <label htmlFor="damage-type">Damage type</label>
          <select
            id="damage-type"
            value={damageType}
            onChange={(event) => setDamageType(event.target.value as IncomingDamageType)}
          >
            <option value="physical">Physical</option>
            <option value="magic">Magic</option>
            <option value="both">Physical and magic</option>
          </select>
        </div>
      </div>

      <fieldset>
        <legend>Reduction</legend>
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
            {direct ? 'Direct damage (ignores armor)' : 'Normal damage'}
          </button>
        </div>

        <div className="mt-3">
          <label htmlFor="armor-slots">
            Armor Slots to mark ({armorSlotsAvailable} available)
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
            <p className="field-error">Direct damage can’t be reduced by marking Armor Slots.</p>
          ) : null}
        </div>
      </fieldset>

      <button
        type="button"
        onClick={() => onApply({ incoming, damageType, direct, armorSlotsToMark })}
      >
        Apply damage
      </button>
    </Dialog>
  );
}
