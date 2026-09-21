import { useEffect, useRef, type ReactNode } from 'react';

import { t } from '../i18n/index.js';

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** Every dialog currently open, innermost last, so Escape only closes the top one. */
const open: symbol[] = [];

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal dialog: focus moves in on open and back where it was on close, Tab is
 * trapped inside, Escape closes the topmost one, and clicking the backdrop closes.
 *
 * The stack matters because a dialog can open another one — a confirmation over a
 * level-up, say — and a single Escape should not close both.
 */
export function Dialog({ title, onClose, children }: DialogProps) {
  const panel = useRef<HTMLDivElement>(null);
  const headingId = useRef(`dialog-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    const token = Symbol('dialog');
    open.push(token);
    const previous = document.activeElement;

    // Focus the first thing a person can act on, or the panel itself.
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel.current)?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (open[open.length - 1] !== token) return;

      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (focusable.length === 0) return;
      const start = focusable[0];
      const end = focusable[focusable.length - 1];
      if (start === undefined || end === undefined) return;

      if (event.shiftKey && document.activeElement === start) {
        event.preventDefault();
        end.focus();
      } else if (!event.shiftKey && document.activeElement === end) {
        event.preventDefault();
        start.focus();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const at = open.indexOf(token);
      if (at !== -1) open.splice(at, 1);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId.current}
        tabIndex={-1}
        ref={panel}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="card-head">
          <h2 id={headingId.current}>{title}</h2>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
