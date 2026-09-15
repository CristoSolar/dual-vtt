import { useEffect } from 'react';

import { t } from '../i18n/index.js';

interface ToastProps {
  message: string;
  onDismiss: () => void;
}

/** Transient status line. Announced politely so it doesn't interrupt a screen reader. */
export function Toast({ message, onDismiss }: ToastProps) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, 6000);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss]);

  return (
    <div className="toast" role="status" aria-live="polite">
      <div className="row spread">
        <span>{message}</span>
        <button type="button" onClick={onDismiss}>
          {t('common.dismiss')}
        </button>
      </div>
    </div>
  );
}
