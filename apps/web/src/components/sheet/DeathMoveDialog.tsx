import { t } from '../../i18n/index.js';
import { Dialog } from '../Dialog.js';

interface DeathMoveDialogProps {
  onClose: () => void;
}

/**
 * Shown when the last Hit Point is marked. The three death moves are named so the
 * table knows the options; resolving one stays a conversation, not an automation.
 */
export function DeathMoveDialog({ onClose }: DeathMoveDialogProps) {
  return (
    <Dialog title={t('sheet.deathMove.title')} onClose={onClose}>
      <p>{t('sheet.deathMove.prompt')}</p>
      <ul>
        <li>{t('sheet.deathMove.blazeOfGlory')}</li>
        <li>{t('sheet.deathMove.avoidDeath')}</li>
        <li>{t('sheet.deathMove.riskItAll')}</li>
      </ul>
      <p className="muted">{t('sheet.deathMove.resolveHint')}</p>
      <button type="button" onClick={onClose}>
        {t('common.close')}
      </button>
    </Dialog>
  );
}
