import type { Avatar, AvatarCrop, SheetState } from '@daggerheart/protocol';
import { srd } from '@daggerheart/srd-data';
import { useState } from 'react';

import { t } from '../../i18n/index.js';
import { artUrl } from '../../state/art.js';
import {
  AVATAR_TYPES,
  galleryCandidates,
  galleryUrl,
  heritageAncestries,
  resolveAvatar,
  uploadAvatar,
} from '../../state/avatar.js';
import { AvatarPortrait } from './AvatarPortrait.js';

type Mode = 'ancestry' | 'gallery' | 'upload';
type Heritage = SheetState['character']['heritage'];

const DEFAULT_CROP: AvatarCrop = { x: 50, y: 50, zoom: 1 };

const ancestryName = (id: string): string => srd().ancestries.find((a) => a.id === id)?.name ?? id;

/**
 * Picks a character's portrait: their ancestry's art (the default), a portrait
 * from the gallery, or a picture of their own, framed in a circle. Used at the end
 * of the wizard and in the library's edit dialog.
 */
export function AvatarPicker({
  heritage,
  value,
  onChange,
  authToken,
}: {
  heritage: Heritage;
  value: Avatar | null;
  onChange: (avatar: Avatar | null) => void;
  authToken: string | null;
}) {
  const [mode, setMode] = useState<Mode>(value?.kind ?? 'ancestry');
  const [showAll, setShowAll] = useState(false);
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ancestries = heritageAncestries(heritage);
  const candidates = galleryCandidates(ancestries, showAll).filter((id) => !missing.has(id));
  const preview = resolveAvatar(value, heritage);
  const crop = value?.kind === 'upload' ? (value.crop ?? DEFAULT_CROP) : null;

  const chooseMode = (next: Mode) => {
    setMode(next);
    setError(null);
    // The ancestry art needs no further choice, so picking the mode picks it.
    if (next === 'ancestry' && value?.kind !== 'ancestry') onChange(null);
  };

  const onFile = async (file: File) => {
    setError(null);
    setUploading(true);
    try {
      const url = await uploadAvatar(file, authToken);
      onChange({ kind: 'upload', url, crop: DEFAULT_CROP });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('avatar.badType'));
    } finally {
      setUploading(false);
    }
  };

  const setCrop = (patch: Partial<AvatarCrop>) => {
    if (value?.kind !== 'upload') return;
    onChange({ ...value, crop: { ...(value.crop ?? DEFAULT_CROP), ...patch } });
  };

  const isPicked = (avatar: Avatar | null): boolean => JSON.stringify(avatar) === JSON.stringify(value);

  return (
    <fieldset className="avatar-picker">
      <legend>{t('avatar.title')}</legend>
      <div className="avatar-picker-head">
        <AvatarPortrait image={preview} className="avatar-portrait avatar-portrait--preview" label={t('avatar.preview')} />
        <div className="avatar-picker-modes" role="radiogroup" aria-label={t('avatar.title')}>
          {(['ancestry', 'gallery', 'upload'] as const).map((m) => (
            <label key={m} className="avatar-picker-mode">
              <input type="radio" name="avatar-mode" checked={mode === m} onChange={() => chooseMode(m)} />
              {t(`avatar.mode.${m}`)}
            </label>
          ))}
        </div>
      </div>

      {mode === 'ancestry' && ancestries.length > 1 ? (
        <div className="avatar-picker-grid">
          {ancestries.map((id, index) => {
            const avatar: Avatar | null = index === 0 ? null : { kind: 'ancestry', ancestryId: id };
            const picked = isPicked(avatar) || (index === 0 && isPicked({ kind: 'ancestry', ancestryId: id }));
            return (
              <button
                type="button"
                key={id}
                className="avatar-choice"
                aria-pressed={picked}
                aria-label={ancestryName(id)}
                title={ancestryName(id)}
                onClick={() => onChange(avatar)}
              >
                <AvatarPortrait image={{ src: artUrl('ancestries', id), crop: null }} />
              </button>
            );
          })}
        </div>
      ) : null}

      {mode === 'gallery' ? (
        <>
          {candidates.length === 0 ? <p className="muted">{t('avatar.galleryEmpty')}</p> : null}
          <div className="avatar-picker-grid">
            {candidates.map((id) => (
              <button
                type="button"
                key={id}
                className="avatar-choice"
                aria-pressed={isPicked({ kind: 'gallery', id })}
                aria-label={t('avatar.galleryItem', { id })}
                onClick={() => onChange({ kind: 'gallery', id })}
              >
                <span className="avatar-frame avatar-portrait">
                  <img
                    src={galleryUrl(id)}
                    alt=""
                    loading="lazy"
                    onError={() => setMissing((m) => new Set([...m, id]))}
                  />
                </span>
              </button>
            ))}
          </div>
          {showAll ? null : (
            <button type="button" className="btn-ghost" onClick={() => setShowAll(true)}>
              {t('avatar.showAll')}
            </button>
          )}
        </>
      ) : null}

      {mode === 'upload' ? (
        <div className="avatar-picker-upload">
          <label className="btn-ghost avatar-picker-file">
            {uploading ? t('avatar.uploading') : t('avatar.choose')}
            <input
              type="file"
              accept={AVATAR_TYPES.join(',')}
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file !== undefined) void onFile(file);
              }}
            />
          </label>
          <p className="muted">{t('avatar.uploadHint')}</p>
          {crop !== null ? (
            <div className="avatar-picker-crop">
              <label>
                {t('avatar.zoom')}
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.05}
                  value={crop.zoom}
                  onChange={(e) => setCrop({ zoom: Number(e.target.value) })}
                />
              </label>
              <label>
                {t('avatar.horizontal')}
                <input type="range" min={0} max={100} value={crop.x} onChange={(e) => setCrop({ x: Number(e.target.value) })} />
              </label>
              <label>
                {t('avatar.vertical')}
                <input type="range" min={0} max={100} value={crop.y} onChange={(e) => setCrop({ y: Number(e.target.value) })} />
              </label>
            </div>
          ) : null}
          {error !== null ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}
