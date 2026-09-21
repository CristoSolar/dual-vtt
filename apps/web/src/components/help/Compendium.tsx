import { srd, type SrdData } from '@daggerheart/srd-data';
import { useState } from 'react';

import { t, type MessageKey } from '../../i18n/index.js';
import { COLLECTIONS, isCollection, type CollectionKey } from './collections.js';
import { EntryDetail } from './details.js';

export type { CollectionKey };
export { COLLECTIONS };

const MAX_RESULTS = 100;

/** Text an entry is searchable by: name plus whatever prose fields the shape has. */
function haystack(entry: SrdData[CollectionKey][number]): string {
  const parts: string[] = [entry.name];
  if ('text' in entry) parts.push(entry.text);
  if ('description' in entry) parts.push(entry.description);
  if ('features' in entry) for (const f of entry.features) parts.push(f.name, f.text);
  if ('feature' in entry && entry.feature !== null) parts.push(entry.feature.name, entry.feature.text);
  if ('hopeFeature' in entry) parts.push(entry.hopeFeature.name, entry.hopeFeature.text);
  return parts.join(' ').toLowerCase();
}

/** One line under a result's name: the field that best distinguishes entries in that collection. */
function metaLine(collection: CollectionKey, entry: SrdData[CollectionKey][number]): string {
  if (collection === 'subclasses' && 'classId' in entry) {
    return srd().classes.find((c) => c.id === entry.classId)?.name ?? '';
  }
  if (collection === 'classes' || collection === 'ancestries' || collection === 'communities' || collection === 'domains') {
    return '';
  }
  if ('level' in entry && 'domain' in entry) return `${t('compendium.field.level')} ${entry.level} · ${entry.domain}`;
  if ('tier' in entry) return `${t('compendium.field.tier')} ${entry.tier}`;
  if ('roll' in entry) return `${t('compendium.field.roll')} ${entry.roll}`;
  return '';
}

export function Compendium({
  path,
  onNavigate,
}: {
  path: string[];
  onNavigate: (c: CollectionKey, id: string | null) => void;
}) {
  const collection: CollectionKey = isCollection(path[0]) ? path[0] : 'classes';
  const selectedId = (path[1] ?? '') || null;
  const [filter, setFilter] = useState('');
  // Searching everything at once: the thing being looked up is often known by
  // name and not by which of eleven lists it lives in.
  const [everywhere, setEverywhere] = useState(false);
  const needle = filter.trim().toLowerCase();

  const entries = srd()[collection] as readonly SrdData[CollectionKey][number][];
  const own = needle === '' ? entries : entries.filter((e) => haystack(e).includes(needle));

  /** Every collection's matches, each tagged with where it came from. */
  const across =
    everywhere && needle !== ''
      ? COLLECTIONS.flatMap((key) =>
          (srd()[key] as readonly SrdData[CollectionKey][number][])
            .filter((entry) => haystack(entry).includes(needle))
            .map((entry) => ({ key, entry })),
        )
      : own.map((entry) => ({ key: collection, entry }));

  const shown = across.slice(0, MAX_RESULTS);

  return (
    <div className="compendium">
      <div className="compendium-controls">
        <select
          value={collection}
          onChange={(event) => onNavigate(event.target.value as CollectionKey, null)}
          aria-label={t('compendium.collectionLabel')}
        >
          {COLLECTIONS.map((key) => (
            <option key={key} value={key}>
              {t(`compendium.collection.${key}` as MessageKey)}
            </option>
          ))}
        </select>
        <input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t('compendium.filterPlaceholder')}
          aria-label={t('compendium.filterPlaceholder')}
        />
        <label htmlFor="compendium-everywhere">
          <input
            id="compendium-everywhere"
            type="checkbox"
            checked={everywhere}
            onChange={(event) => setEverywhere(event.target.checked)}
          />{' '}
          {t('compendium.searchEverywhere')}
        </label>
      </div>
      <div className="compendium-body">
        <ul className="compendium-list">
          {shown.map(({ key, entry }) => (
            <li key={`${key}/${entry.id}`}>
              <button
                type="button"
                aria-pressed={entry.id === selectedId && key === collection}
                onClick={() => onNavigate(key, entry.id)}
              >
                <strong>{entry.name}</strong>
                <span className="muted">
                  {everywhere && needle !== ''
                    ? t(`compendium.collection.${key}` as MessageKey)
                    : metaLine(key, entry)}
                </span>
              </button>
            </li>
          ))}
          {across.length === 0 ? <li className="muted">{t('compendium.empty')}</li> : null}
          {across.length > MAX_RESULTS ? (
            <li className="muted">{t('compendium.tooMany', { n: across.length })}</li>
          ) : null}
        </ul>
        <div className="compendium-detail">
          {selectedId === null ? (
            <p className="muted">{t('compendium.pick')}</p>
          ) : (
            <EntryDetail collection={collection} id={selectedId} onNavigate={onNavigate} />
          )}
        </div>
      </div>
      <p className="muted">{t('brand.compatibleShort')}</p>
    </div>
  );
}
