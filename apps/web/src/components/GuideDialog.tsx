import { useState } from 'react';
import { Link } from 'react-router-dom';

import { t, type MessageKey } from '../i18n/index.js';
import { Dialog } from './Dialog.js';

const STEPS: Record<'gm' | 'player', readonly { title: MessageKey; body: MessageKey }[]> = {
  gm: [1, 2, 3, 4, 5].map((n) => ({
    title: `guide.gm.${n}.title` as MessageKey,
    body: `guide.gm.${n}.body` as MessageKey,
  })),
  player: [1, 2, 3, 4].map((n) => ({
    title: `guide.player.${n}.title` as MessageKey,
    body: `guide.player.${n}.body` as MessageKey,
  })),
};

/** First-run walkthrough. Steps are static keys; the text follows the active locale. */
export function GuideDialog({ role, onClose }: { role: 'gm' | 'player'; onClose: () => void }) {
  const steps = STEPS[role];
  const [index, setIndex] = useState(0);
  const step = steps[index];
  if (step === undefined) return null;
  const last = index === steps.length - 1;

  return (
    <Dialog title={t('guide.title')} onClose={onClose}>
      <div className="guide-steps">
        <p className="muted">{t('guide.step', { n: index + 1, total: steps.length })}</p>
        <h3>{t(step.title)}</h3>
        <p>{t(step.body)}</p>
        <div className="row">
          <button type="button" onClick={() => setIndex(index - 1)} disabled={index === 0}>
            {t('guide.prev')}
          </button>
          {last ? (
            <>
              <Link to="/help" onClick={onClose}>
                <button type="button">{t('guide.openHelp')}</button>
              </Link>
              <button type="button" onClick={onClose}>{t('guide.done')}</button>
            </>
          ) : (
            <button type="button" onClick={() => setIndex(index + 1)}>{t('guide.next')}</button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
