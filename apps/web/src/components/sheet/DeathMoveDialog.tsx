import type { DeathMoveChoice } from '@daggerheart/rules';
import { useState } from 'react';

import { t } from '../../i18n/index.js';
import { Dialog } from '../Dialog.js';

interface DeathMoveDialogProps {
  onChoose: (choice: DeathMoveChoice, prefer: 'hp' | 'stress') => void;
  onClose: () => void;
}

/**
 * Shown when the last Hit Point is marked. All three moves are rolled or resolved
 * on the server, so the choice made here is binding: blazing out and losing a Risk
 * It All both end the character.
 */
export function DeathMoveDialog({ onChoose, onClose }: DeathMoveDialogProps) {
  const [prefer, setPrefer] = useState<'hp' | 'stress'>('hp');
  const [confirming, setConfirming] = useState<DeathMoveChoice | null>(null);

  const choose = (choice: DeathMoveChoice) => {
    // Two of these end a character, so the button asks once more before it does.
    if (choice !== 'avoidDeath' && confirming !== choice) {
      setConfirming(choice);
      return;
    }
    onChoose(choice, prefer);
    onClose();
  };

  const label = (choice: DeathMoveChoice, key: string) =>
    confirming === choice ? t('sheet.deathMove.confirm') : t(key as never);

  return (
    <Dialog title={t('sheet.deathMove.title')} onClose={onClose}>
      <p>{t('sheet.deathMove.prompt')}</p>

      <ul className="death-moves">
        <li>
          <button type="button" onClick={() => choose('blazeOfGlory')}>
            {label('blazeOfGlory', 'sheet.deathMove.blazeOfGloryAction')}
          </button>
          <p className="card-text">{t('sheet.deathMove.blazeOfGlory')}</p>
        </li>
        <li>
          <button type="button" onClick={() => choose('avoidDeath')}>
            {t('sheet.deathMove.avoidDeathAction')}
          </button>
          <p className="card-text">{t('sheet.deathMove.avoidDeath')}</p>
        </li>
        <li>
          <button type="button" onClick={() => choose('riskItAll')}>
            {label('riskItAll', 'sheet.deathMove.riskItAllAction')}
          </button>
          <p className="card-text">{t('sheet.deathMove.riskItAll')}</p>
          <label htmlFor="risk-prefer">{t('sheet.deathMove.prefer')}</label>
          <select
            id="risk-prefer"
            value={prefer}
            onChange={(event) => setPrefer(event.target.value === 'stress' ? 'stress' : 'hp')}
          >
            <option value="hp">{t('sheet.deathMove.preferHP')}</option>
            <option value="stress">{t('sheet.deathMove.preferStress')}</option>
          </select>
        </li>
      </ul>

      <button type="button" onClick={onClose}>
        {t('sheet.deathMove.decideLater')}
      </button>
    </Dialog>
  );
}
