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
    <Dialog title="Death move required" onClose={onClose}>
      <p>You marked your last Hit Point. Choose a death move:</p>
      <ul>
        <li>Blaze of Glory</li>
        <li>Avoid Death</li>
        <li>Risk It All</li>
      </ul>
      <p className="muted">Resolve it at the table.</p>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </Dialog>
  );
}
