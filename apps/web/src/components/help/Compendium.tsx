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
  return parts.join(' ').toLowerCase();
}

/** One line under a result's name: the field that best distinguishes entries in that collection. */
function metaLine(collection: CollectionKey, entry: SrdData[CollectionKey][number]): string {
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
  const selectedId = path[1] ?? null;
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLowerCase();

  const entries = srd()[collection] as readonly SrdData[CollectionKey][number][];
  const matches = needle === '' ? entries : entries.filter((e) => haystack(e).includes(needle));
  const shown = matches.slice(0, MAX_RESULTS);

  return (
    <div className="compendium">
      <div className="compendium-controls">
        <select
          value={collection}
          onChange={(event) => onNavigate(event.target.value as CollectionKey, null)}
          aria-label={t('help.tab.compendium')}
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
      </div>
      <div className="compendium-body">
        <ul className="compendium-list">
          {shown.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                aria-pressed={entry.id === selectedId}
                onClick={() => onNavigate(collection, entry.id)}
              >
                <strong>{entry.name}</strong>
                <span className="muted">{metaLine(collection, entry)}</span>
              </button>
            </li>
          ))}
          {matches.length === 0 ? <li className="muted">{t('compendium.empty')}</li> : null}
          {matches.length > MAX_RESULTS ? (
            <li className="muted">{t('compendium.tooMany', { n: matches.length })}</li>
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
      <p className="muted">{t('sheet.print.footer')}</p>
    </div>
  );
}
