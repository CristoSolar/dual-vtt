import { useState } from 'react';

import { t } from '../../i18n/index.js';
import { SectionHead } from '../SectionHead.js';

interface InventoryPanelProps {
  inventory: readonly string[];
  onChange: (inventory: string[]) => void;
}

/**
 * What a character is carrying.
 *
 * The wizard writes this once at creation, and until now nothing else could: loot
 * picked up at the table had nowhere to go. Items are free text, since the SRD's
 * own loot tables are prose and a party carries things that are not on them.
 */
export function InventoryPanel({ inventory, onChange }: InventoryPanelProps) {
  const [item, setItem] = useState('');

  const add = () => {
    const name = item.trim();
    if (name === '') return;
    onChange([...inventory, name]);
    setItem('');
  };

  return (
    <div className="panel">
      <SectionHead>{t('sheet.route.inventoryTitle')}</SectionHead>

      {inventory.length === 0 ? <p className="muted">{t('sheet.inventory.empty')}</p> : null}
      <ul>
        {inventory.map((line, index) => (
          <li className="row spread" key={`${line}-${index}`}>
            <span>{line}</span>
            <button
              type="button"
              aria-label={t('sheet.inventory.drop', { item: line })}
              onClick={() => onChange(inventory.filter((_, at) => at !== index))}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      <div className="row mt-3">
        <input
          value={item}
          placeholder={t('sheet.inventory.placeholder')}
          aria-label={t('sheet.inventory.placeholder')}
          onChange={(event) => setItem(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') add();
          }}
        />
        <button type="button" disabled={item.trim() === ''} onClick={add}>
          {t('sheet.inventory.add')}
        </button>
      </div>
    </div>
  );
}
