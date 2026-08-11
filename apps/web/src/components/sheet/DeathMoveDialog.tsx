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
    <Dialog title="Movimiento de Muerte requerido" onClose={onClose}>
      <p>Marcaste tu último Punto de Vida. Elige un Movimiento de Muerte:</p>
      <ul>
        <li>Última Gloria</li>
        <li>Evitar la Muerte</li>
        <li>Arriesgarlo Todo</li>
      </ul>
      <p className="muted">Resuélvelo en la mesa.</p>
      <button type="button" onClick={onClose}>
        Cerrar
      </button>
    </Dialog>
  );
}
