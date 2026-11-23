import { equipArmor } from '@daggerheart/rules';
import type { Armor, Weapon } from '@daggerheart/srd-data';
import { useState } from 'react';

import { t } from '../../i18n/index.js';
import { artUrl } from '../../state/art.js';
import { armorGlyph, weaponGlyph, type GearGlyph as Glyph } from '../../state/equipment.js';
import { GearGlyph } from './GearGlyph.js';

/** A square of the card art, or its glyph while the art is missing. */
function GearThumb({ src, glyph }: { src: string | null; glyph: Glyph | null }) {
  const [broken, setBroken] = useState<string | null>(null);
  return (
    <span className="gear-thumb" aria-hidden="true">
      {glyph !== null ? <GearGlyph glyph={glyph} className="gear-thumb-glyph" /> : null}
      {src !== null && broken !== src ? (
        <img src={src} alt="" decoding="async" onError={() => setBroken(src)} />
      ) : null}
    </span>
  );
}

interface SlotProps {
  title: string;
  name: string | null;
  /** Shown instead of a name when nothing is chosen. */
  empty?: string;
  src: string | null;
  glyph: Glyph | null;
}

function Slot({ title, name, empty = t('wizard.step5.notChosen'), src, glyph }: SlotProps) {
  return (
    <li className={name === null ? 'gear-slot is-empty' : 'gear-slot'}>
      <GearThumb src={src} glyph={glyph} />
      <span className="gear-slot-text">
        <span className="gear-slot-title">{title}</span>
        <span className="gear-slot-name">{name ?? empty}</span>
      </span>
    </li>
  );
}

interface EquipmentSummaryProps {
  primary: Weapon | null;
  secondary: Weapon | null;
  /** True when a two-handed primary leaves no hand for a secondary. */
  handsFull: boolean;
  armor: Armor | null;
  evasion: number | null;
  level: number;
}

/**
 * What the character will carry, and the defence numbers the sheet will start
 * with: Evasion from the class, Armor Score and thresholds (base + level) from
 * the armor — the same figures `finalize` records.
 */
export function EquipmentSummary({ primary, secondary, handsFull, armor, evasion, level }: EquipmentSummaryProps) {
  const defence = armor === null ? null : equipArmor(armor, level);
  const stats: [string, number | null][] = [
    [t('wizard.step4.evasion'), evasion],
    [t('wizard.step5.armorScoreStat'), defence?.armorScore ?? null],
    [t('wizard.step5.majorStat'), defence?.thresholds.major ?? null],
    [t('wizard.step5.severeStat'), defence?.thresholds.severe ?? null],
  ];
  return (
    <section className="gear-summary" aria-label={t('wizard.step5.summaryLabel')}>
      <ul className="gear-slots">
        <Slot
          title={t('wizard.step5.primaryShort')}
          name={primary?.name ?? null}
          src={primary ? artUrl('weapons', primary.id) : null}
          glyph={primary ? weaponGlyph(primary) : null}
        />
        <Slot
          title={t('wizard.step5.secondaryShort')}
          name={secondary?.name ?? null}
          empty={handsFull ? t('wizard.step5.handsFull') : t('wizard.step5.noSecondary')}
          src={secondary ? artUrl('weapons', secondary.id) : null}
          glyph={secondary ? weaponGlyph(secondary) : null}
        />
        <Slot
          title={t('wizard.step5.armorLegend')}
          name={armor?.name ?? null}
          src={armor ? artUrl('armor', armor.id) : null}
          glyph={armor ? armorGlyph(armor) : null}
        />
      </ul>
      <dl className="gear-stats">
        {stats.map(([name, value]) => (
          <div className="gear-stat" key={name}>
            <dt>{name}</dt>
            <dd>{value ?? '—'}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
