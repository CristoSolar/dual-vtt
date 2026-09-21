import { formatDice, srd } from '@daggerheart/srd-data';

import { t } from '../../i18n/index.js';
import { label as prettify } from '../../state/selectors.js';
import { SectionHead } from '../SectionHead.js';

interface EquipmentPanelProps {
  primaryWeaponId: string;
  secondaryWeaponId: string | null;
  armorId: string;
  /** The character's tier's worth of gear is what the lists offer, plus what is worn. */
  tier: number;
  /** Free during a rest; a Stress otherwise, which the label says. */
  duringRest: boolean;
  onEquipWeapon: (slot: 'primary' | 'secondary', weaponId: string | null) => void;
  onEquipArmor: (armorId: string | null) => void;
}

/**
 * Changing gear mid-campaign.
 *
 * Armor rebuilds the Armor Score and the damage thresholds, so it is not a
 * cosmetic choice; a weapon swap costs a Stress outside a rest. Both are sent as
 * intents, and the server does the arithmetic.
 */
export function EquipmentPanel({
  primaryWeaponId,
  secondaryWeaponId,
  armorId,
  tier,
  duringRest,
  onEquipWeapon,
  onEquipArmor,
}: EquipmentPanelProps) {
  // Anything up to this character's tier, plus whatever they are already carrying,
  // so a piece handed out by the GM never disappears from its own list.
  const offered = <T extends { id: string; tier: number }>(all: readonly T[], worn: string | null) =>
    all.filter((entry) => entry.tier <= tier || entry.id === worn);

  const weapons = srd().weapons;
  const primaries = offered(
    weapons.filter((w) => w.category === 'primary'),
    primaryWeaponId,
  );
  const secondaries = offered(
    weapons.filter((w) => w.category === 'secondary'),
    secondaryWeaponId,
  );
  const armors = offered(srd().armor, armorId);

  const weaponLabel = (id: string) => {
    const weapon = weapons.find((w) => w.id === id);
    if (weapon === undefined) return id;
    return `${weapon.name} · ${prettify(weapon.trait)} · ${prettify(weapon.range)} · ${formatDice(
      weapon.damage,
    )}`;
  };

  return (
    <div className="panel">
      <SectionHead>{t('sheet.equipment.title')}</SectionHead>
      <p className="muted">
        {duringRest ? t('sheet.equipment.freeNow') : t('sheet.equipment.costsStress')}
      </p>

      <label htmlFor="equip-primary">{t('sheet.equipment.primary')}</label>
      <select
        id="equip-primary"
        value={primaryWeaponId}
        onChange={(event) => onEquipWeapon('primary', event.target.value)}
      >
        {primaries.map((weapon) => (
          <option key={weapon.id} value={weapon.id}>
            {weaponLabel(weapon.id)}
          </option>
        ))}
      </select>

      <label htmlFor="equip-secondary" className="mt-3">
        {t('sheet.equipment.secondary')}
      </label>
      <select
        id="equip-secondary"
        value={secondaryWeaponId ?? ''}
        onChange={(event) =>
          onEquipWeapon('secondary', event.target.value === '' ? null : event.target.value)
        }
      >
        <option value="">{t('sheet.equipment.noSecondary')}</option>
        {secondaries.map((weapon) => (
          <option key={weapon.id} value={weapon.id}>
            {weaponLabel(weapon.id)}
          </option>
        ))}
      </select>

      <label htmlFor="equip-armor" className="mt-3">
        {t('sheet.equipment.armor')}
      </label>
      <select
        id="equip-armor"
        value={armorId}
        onChange={(event) => onEquipArmor(event.target.value === '' ? null : event.target.value)}
      >
        <option value="">{t('sheet.equipment.noArmor')}</option>
        {armors.map((armor) => (
          <option key={armor.id} value={armor.id}>
            {armor.name} · {armor.baseThresholds.major}/{armor.baseThresholds.severe} ·{' '}
            {t('sheet.equipment.score', { score: armor.baseScore })}
          </option>
        ))}
      </select>
    </div>
  );
}
