import { adversaries } from '@daggerheart/srd-data';
import type { RoomEvent, RoomState, Token } from '@daggerheart/protocol';

interface TokenPopoverProps {
  token: Token;
  room: RoomState;
  /** Screen position (relative to the map stage's own container), in pixels. */
  x: number;
  y: number;
  onUpdate: (patch: Partial<Token>) => void;
  onRemove: () => void;
  onClose: () => void;
  send: (event: RoomEvent) => void;
  onUploadImage: (file: File) => void;
  uploadingImage: boolean;
  imageError: string | null;
}

/**
 * A small floating editor anchored to a token on the map: size, rotation,
 * visibility, portrait, and — for an adversary — its HP/Stress, all without
 * opening the (already crowded) Fichas panel. Positioned by the caller, which
 * tracks the canvas's own pan/zoom so this stays glued to the token.
 */
export function TokenPopover({
  token,
  room,
  x,
  y,
  onUpdate,
  onRemove,
  onClose,
  send,
  onUploadImage,
  uploadingImage,
  imageError,
}: TokenPopoverProps) {
  const adversaryInstance =
    token.kind === 'adversary' && token.refId !== null
      ? room.adversaryInstances.find((a) => a.instanceId === token.refId) ?? null
      : null;
  const adversaryStat =
    adversaryInstance === null ? null : adversaries.find((a) => a.id === adversaryInstance.adversaryId) ?? null;

  const characterSheet =
    token.kind === 'pc' && token.refId !== null ? room.characters[token.refId] ?? null : null;

  return (
    <div className="token-popover" style={{ left: x, top: y }}>
      <div className="card-head">
        <strong>{token.name}</strong>
        <button type="button" onClick={onClose} aria-label="Cerrar">
          ×
        </button>
      </div>

      {characterSheet !== null ? (
        <p className="muted">
          PV {characterSheet.hpMarked}/{characterSheet.character.hpSlots} · Estrés{' '}
          {characterSheet.stressMarked}/{characterSheet.character.stressSlots} · Evasión{' '}
          {characterSheet.character.evasion}
        </p>
      ) : null}

      {adversaryInstance !== null && adversaryStat !== null ? (
        <div className="row mt-2">
          <span className="muted">
            PV {adversaryInstance.hpMarked}/{adversaryStat.hp}
          </span>
          <button
            type="button"
            onClick={() =>
              send({
                type: 'updateAdversary',
                instanceId: adversaryInstance.instanceId,
                hpMarked: Math.min(adversaryStat.hp, adversaryInstance.hpMarked + 1),
                stressMarked: adversaryInstance.stressMarked,
              })
            }
          >
            +PV
          </button>
          <button
            type="button"
            onClick={() =>
              send({
                type: 'updateAdversary',
                instanceId: adversaryInstance.instanceId,
                hpMarked: Math.max(0, adversaryInstance.hpMarked - 1),
                stressMarked: adversaryInstance.stressMarked,
              })
            }
          >
            −PV
          </button>
          <span className="muted">
            Estrés {adversaryInstance.stressMarked}/{adversaryStat.stress}
          </span>
          <button
            type="button"
            onClick={() =>
              send({
                type: 'updateAdversary',
                instanceId: adversaryInstance.instanceId,
                hpMarked: adversaryInstance.hpMarked,
                stressMarked: Math.min(adversaryStat.stress, adversaryInstance.stressMarked + 1),
              })
            }
          >
            +Estrés
          </button>
          <button
            type="button"
            onClick={() =>
              send({
                type: 'updateAdversary',
                instanceId: adversaryInstance.instanceId,
                hpMarked: adversaryInstance.hpMarked,
                stressMarked: Math.max(0, adversaryInstance.stressMarked - 1),
              })
            }
          >
            −Estrés
          </button>
        </div>
      ) : null}

      <div className="grid cols-2 mt-3">
        <div>
          <label htmlFor="popover-token-size">Tamaño</label>
          <input
            id="popover-token-size"
            type="number"
            min={10}
            max={500}
            value={token.width}
            onChange={(event) => {
              const size = Math.max(10, Number(event.target.value));
              onUpdate({ width: size, height: size });
            }}
          />
        </div>
        <div>
          <label htmlFor="popover-token-rotation">Rotación</label>
          <input
            id="popover-token-rotation"
            type="number"
            min={-360}
            max={360}
            value={token.rotation}
            onChange={(event) => onUpdate({ rotation: Number(event.target.value) })}
          />
        </div>
      </div>

      <div className="row mt-2">
        <button type="button" aria-pressed={token.hidden} onClick={() => onUpdate({ hidden: !token.hidden })}>
          {token.hidden ? 'Solo DJ' : 'Visible para jugadores'}
        </button>
        <button type="button" onClick={onRemove}>
          Eliminar ficha
        </button>
      </div>

      <div className="mt-2">
        <label htmlFor="popover-token-image">Imagen</label>
        <input
          id="popover-token-image"
          type="file"
          disabled={uploadingImage}
          accept="image/png,image/jpeg,image/gif,image/webp"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) onUploadImage(file);
          }}
        />
        {uploadingImage ? <p className="muted">Subiendo…</p> : null}
        {imageError !== null ? <p className="field-error">{imageError}</p> : null}
        {token.image !== null ? (
          <button type="button" onClick={() => onUpdate({ image: null })}>
            Quitar imagen
          </button>
        ) : null}
      </div>
    </div>
  );
}
