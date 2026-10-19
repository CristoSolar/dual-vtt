import type { Region, RegionEffect } from '@daggerheart/protocol';
import { useState } from 'react';

import { t } from '../../i18n/index.js';
import { Dialog } from '../Dialog.js';

interface RegionFormProps {
  /** The region being named: freshly drawn, or one already on the scene. */
  region: Region;
  onSave: (region: Region) => void;
  onClose: () => void;
}

const EFFECTS: readonly RegionEffect[] = ['difficultTerrain', 'hazard', 'note'];

/** Name, effect, text and visibility for one region; the outline comes from the pen. */
export function RegionForm({ region, onSave, onClose }: RegionFormProps) {
  const [name, setName] = useState(region.name);
  const [effect, setEffect] = useState<RegionEffect>(region.effect);
  const [text, setText] = useState(region.text);
  const [visibleToPlayers, setVisibleToPlayers] = useState(region.visibleToPlayers);

  return (
    <Dialog title={t('map.regions.formTitle')} onClose={onClose}>
      <label htmlFor="region-name">{t('map.regions.name')}</label>
      <input
        id="region-name"
        value={name}
        maxLength={60}
        onChange={(event) => setName(event.target.value)}
      />
      <label htmlFor="region-effect" className="mt-3">{t('map.regions.effect')}</label>
      <select
        id="region-effect"
        value={effect}
        onChange={(event) => setEffect(event.target.value as RegionEffect)}
      >
        {EFFECTS.map((option) => (
          <option key={option} value={option}>
            {t(`map.regions.effect.${option}`)}
          </option>
        ))}
      </select>
      <label htmlFor="region-text" className="mt-3">{t('map.regions.text')}</label>
      <textarea
        id="region-text"
        rows={3}
        value={text}
        maxLength={500}
        onChange={(event) => setText(event.target.value)}
      />
      {effect === 'hazard' ? <p className="muted">{t('map.regions.hazardHint')}</p> : null}
      <label className="mt-3">
        <input
          type="checkbox"
          checked={visibleToPlayers}
          onChange={(event) => setVisibleToPlayers(event.target.checked)}
        />{' '}
        {t('map.regions.visible')}
      </label>
      <div className="row mt-3">
        <button
          type="button"
          disabled={name.trim() === ''}
          onClick={() => {
            onSave({ ...region, name: name.trim(), effect, text, visibleToPlayers });
            onClose();
          }}
        >
          {t('map.regions.save')}
        </button>
        <button type="button" onClick={onClose}>
          {t('common.cancel')}
        </button>
      </div>
    </Dialog>
  );
}
