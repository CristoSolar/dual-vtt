import { useEffect, useRef, useState, type ReactNode } from 'react';

import { t } from '../i18n/index.js';

interface ToastProps {
  message: string;
  onDismiss: () => void;
  /**
   * A rejection is announced assertively, because it explains why something the
   * person just did did not happen. Everything else stays polite.
   */
  tone?: 'status' | 'alert';
}

/** The fixed slot toasts stack in, newest at the bottom. */
export function ToastStack({ children }: { children: ReactNode }) {
  return <div className="toast-stack">{children}</div>;
}

/**
 * Transient status line. It dismisses itself after a few seconds, but the timer
 * pauses while the pointer is over it or the keyboard is in it, so a message does
 * not vanish from under someone who is reading it or reaching for its button.
 */
export function Toast({ message, onDismiss, tone = 'status' }: ToastProps) {
  const [paused, setPaused] = useState(false);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => dismiss.current(), 6000);
    return () => window.clearTimeout(timer);
  }, [message, paused]);

  return (
    <div
      className={`toast${tone === 'alert' ? ' toast-alert' : ''}`}
      role={tone === 'alert' ? 'alert' : 'status'}
      aria-live={tone === 'alert' ? 'assertive' : 'polite'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="row spread">
        <span>{message}</span>
        <button type="button" onClick={onDismiss}>
          {t('common.dismiss')}
        </button>
      </div>
    </div>
  );
}
