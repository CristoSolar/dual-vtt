import { Dialog } from './Dialog.js';
import { t } from '../i18n/index.js';

interface ConfirmDialogProps {
  title: string;
  /** What will happen, in the person's own terms, not the code's. */
  body: string;
  /** The label on the button that goes through with it. */
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A confirmation for something that cannot be taken back: leaving a campaign,
 * starting a character over, resetting a password.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog title={title} onClose={onCancel}>
      <p>{body}</p>
      <div className="row">
        <button type="button" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="button" className="danger" onClick={onConfirm}>
          {confirmLabel ?? t('common.confirm')}
        </button>
      </div>
    </Dialog>
  );
}
