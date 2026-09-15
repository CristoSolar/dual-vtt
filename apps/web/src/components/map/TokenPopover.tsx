import { srd } from '@daggerheart/srd-data';
import type { RoomEvent, RoomState, Token } from '@daggerheart/protocol';
import { useState } from 'react';

import { t } from '../../i18n/index.js';
import { SERVER_URL } from '../../state/useCampaign.js';

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

type TabId = 'stats' | 'settings' | 'image';

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
    adversaryInstance === null ? null : srd().adversaries.find((a) => a.id === adversaryInstance.adversaryId) ?? null;

  const characterSheet =
    token.kind === 'pc' && token.refId !== null ? room.characters[token.refId] ?? null : null;

  const hasStats = characterSheet !== null || (adversaryInstance !== null && adversaryStat !== null);

  const tabs: { id: TabId; label: string }[] = [
    ...(hasStats ? [{ id: 'stats' as const, label: t('map.token.tabState') }] : []),
    { id: 'settings' as const, label: t('map.token.tabSettings') },
    { id: 'image' as const, label: t('map.token.tabImage') },
  ];
  const [tab, setTab] = useState<TabId>(hasStats ? 'stats' : 'settings');
  const active = tabs.some((t) => t.id === tab) ? tab : tabs[0]?.id ?? 'settings';

  return (
    <div className="token-popover" style={{ left: x, top: y }}>
      <div className="token-popover-head">
        <span className="token-popover-swatch" style={{ background: token.color }} aria-hidden="true" />
        <strong className="token-popover-name">{token.name}</strong>
        <button type="button" onClick={onClose} aria-label={t('common.close')}>
          ×
        </button>
      </div>

      <div className="token-popover-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active === t.id}
            className="token-popover-tab"
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="token-popover-body" role="tabpanel">
        {active === 'stats' ? (
          <>
            {characterSheet !== null ? (
              <dl className="token-popover-stats">
                <div>
                  <dt>{t('sheet.print.hpAbbrev')}</dt>
                  <dd>
                    {characterSheet.hpMarked}/{characterSheet.character.hpSlots}
                  </dd>
                </div>
                <div>
                  <dt>{t('sheet.route.stress')}</dt>
                  <dd>
                    {characterSheet.stressMarked}/{characterSheet.character.stressSlots}
                  </dd>
                </div>
                <div>
                  <dt>{t('sheet.route.evasion')}</dt>
                  <dd>{characterSheet.character.evasion}</dd>
                </div>
              </dl>
            ) : null}

            {adversaryInstance !== null && adversaryStat !== null ? (
              <>
                <div className="token-popover-stat-row">
                  <span className="token-popover-stat-label">{t('sheet.print.hpAbbrev')}</span>
                  <span className="token-popover-stat-value">
                    {adversaryInstance.hpMarked}/{adversaryStat.hp}
                  </span>
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
                    −
                  </button>
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
                    +
                  </button>
                </div>
                <div className="token-popover-stat-row">
                  <span className="token-popover-stat-label">{t('sheet.route.stress')}</span>
                  <span className="token-popover-stat-value">
                    {adversaryInstance.stressMarked}/{adversaryStat.stress}
                  </span>
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
                    −
                  </button>
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
                    +
                  </button>
                </div>
                <p className="token-popover-stat-footnote">
                  {t('map.token.difficulty', { difficulty: adversaryStat.difficulty })}
                </p>
              </>
            ) : null}
          </>
        ) : null}

        {active === 'settings' ? (
          <>
            <div className="grid cols-2">
              <div>
                <label htmlFor="popover-token-size">{t('map.token.sizeLabel')}</label>
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
                <label htmlFor="popover-token-rotation">{t('map.token.rotationLabel')}</label>
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

            {token.kind === 'pc' ? (
              <div className="mt-3">
                <label htmlFor="popover-token-vision-radius">{t('map.token.visionRadiusLabel')}</label>
                <input
                  id="popover-token-vision-radius"
                  type="number"
                  min={0}
                  max={4000}
                  value={token.visionRadius}
                  onChange={(event) => onUpdate({ visionRadius: Math.max(0, Number(event.target.value)) })}
                />
              </div>
            ) : null}

            <div className="mt-3">
              <label htmlFor="popover-token-color">{t('map.colorLabel')}</label>
              <input
                id="popover-token-color"
                type="color"
                value={token.color}
                onChange={(event) => onUpdate({ color: event.target.value })}
              />
            </div>
            {token.image !== null ? (
              <div className="row mt-2">
                <button
                  type="button"
                  aria-pressed={token.colorFrame}
                  onClick={() => onUpdate({ colorFrame: !token.colorFrame })}
                >
                  {token.colorFrame ? t('map.token.colorFrameOn') : t('map.token.colorFrameOff')}
                </button>
              </div>
            ) : null}

            <div className="row mt-3">
              <button type="button" aria-pressed={token.hidden} onClick={() => onUpdate({ hidden: !token.hidden })}>
                {token.hidden ? t('map.token.gmOnly') : t('map.token.visibleToPlayers')}
              </button>
            </div>
            <button type="button" className="mt-2 token-popover-danger" onClick={onRemove}>
              {t('map.token.remove')}
            </button>
          </>
        ) : null}

        {active === 'image' ? (
          <>
            {token.image !== null ? (
              <img
                className="token-popover-preview"
                src={token.image.url.startsWith('http') ? token.image.url : `${SERVER_URL}${token.image.url}`}
                alt=""
              />
            ) : (
              <p className="muted">{t('map.token.noImage')}</p>
            )}
            <label htmlFor="popover-token-image">{t('map.token.uploadImage')}</label>
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
            {uploadingImage ? <p className="muted">{t('map.uploading')}</p> : null}
            {imageError !== null ? <p className="field-error">{imageError}</p> : null}
            {token.image !== null ? (
              <button type="button" className="mt-2" onClick={() => onUpdate({ image: null })}>
                {t('map.token.removeImage')}
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
