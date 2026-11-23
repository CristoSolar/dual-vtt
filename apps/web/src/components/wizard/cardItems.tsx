import type { Trait } from '@daggerheart/character';
import type { Ancestry, AncestrySlot, Armor, CharacterClass, Community, Weapon } from '@daggerheart/srd-data';
import type { CSSProperties } from 'react';

import { t } from '../../i18n/index.js';
import { artUrl } from '../../state/art.js';
import { flavorText } from '../../state/carousel.js';
import { armorGlyph, weaponGlyph, type RankedWeapon } from '../../state/equipment.js';
import { formatSigned, label } from '../../state/selectors.js';
import { GearGlyph } from './GearGlyph.js';
import type { CarouselItem } from '../CardCarousel.js';
import { DomainBadge, DomainHeader } from '../Domain.js';

interface Feature {
  name: string;
  text: string;
}

function FeatureBlock({ heading, feature }: { heading?: string; feature: Feature }) {
  return (
    <div className="carousel-feature">
      <h4 className="carousel-feature-name">
        {feature.name}
        {heading ? <span className="carousel-feature-kind">{heading}</span> : null}
      </h4>
      <p className="carousel-feature-text">{feature.text}</p>
    </div>
  );
}

/** A class tints its card with its first domain, leaning a little towards the second. */
function classAccent([first, second]: readonly string[]): CSSProperties {
  const a = `var(--c-domain-${first}, var(--c-brass-dim))`;
  const b = `var(--c-domain-${second ?? first}, var(--c-brass-dim))`;
  return { '--card-accent': `color-mix(in oklab, ${a} 72%, ${b})` } as CSSProperties;
}

/** Ancestries and communities share one warm, neutral bronze frame. */
const HERITAGE_ACCENT = { '--card-accent': 'var(--c-brass-dim)' } as CSSProperties;

export function classItem(c: CharacterClass): CarouselItem {
  return {
    id: c.id,
    name: c.name,
    image: artUrl('classes', c.id),
    // The SRD prints no lore blurb for a class; its class items are the closest
    // thing to flavor it has, and are quoted, not paraphrased.
    flavor: flavorText(c.classItems),
    accent: classAccent(c.domains),
    chips: (
      <>
        <span className="carousel-chip">{t('wizard.card.evasion', { value: c.startingEvasion })}</span>
        <span className="carousel-chip">{t('wizard.card.hp', { value: c.startingHP })}</span>
        <span className="carousel-chip-break" aria-hidden="true" />
        {c.domains.map((domain) => (
          <DomainBadge key={domain} domain={domain} />
        ))}
      </>
    ),
    detail: (
      <div className="carousel-detail-grid">
        <section>
          <FeatureBlock heading={t('wizard.card.hopeFeature')} feature={c.hopeFeature} />
          {c.features.map((feature) => (
            <FeatureBlock key={feature.name} heading={t('wizard.card.classFeatures')} feature={feature} />
          ))}
        </section>
        <section className="carousel-detail-domains" aria-label={t('wizard.card.domains')}>
          {c.domains.map((domain) => (
            <DomainHeader key={domain} domain={domain} />
          ))}
        </section>
      </div>
    ),
  };
}

/**
 * An ancestry card. `slot` narrows it to the one feature a mixed heritage takes
 * from it; omitted, both features show.
 */
export function ancestryItem(a: Ancestry, slot?: AncestrySlot): CarouselItem {
  const features = slot === undefined ? a.features : a.features.filter((f) => f.slot === slot);
  return {
    id: a.id,
    name: a.name,
    image: artUrl('ancestries', a.id),
    flavor: flavorText(features[0]?.text ?? ''),
    accent: HERITAGE_ACCENT,
    chips: features.map((f) => (
      <span key={f.name} className="carousel-chip">
        {f.name}
      </span>
    )),
    detail: (
      <div className="carousel-detail-grid">
        {features.map((f) => (
          <FeatureBlock key={f.name} heading={t('wizard.card.feature')} feature={f} />
        ))}
      </div>
    ),
  };
}

export function communityItem(c: Community): CarouselItem {
  return {
    id: c.id,
    name: c.name,
    image: artUrl('communities', c.id),
    flavor: flavorText(c.feature.text),
    accent: HERITAGE_ACCENT,
    chips: <span className="carousel-chip">{c.feature.name}</span>,
    detail: (
      <div className="carousel-detail-grid">
        <FeatureBlock heading={t('wizard.card.feature')} feature={c.feature} />
      </div>
    ),
  };
}

/** Steel for mundane gear, the arcane violet for anything that needs a Spellcast trait. */
const STEEL_ACCENT = { '--card-accent': '#6f7d8f' } as CSSProperties;
const ARCANE_ACCENT = { '--card-accent': 'var(--c-violet)' } as CSSProperties;

/** "d8+1" — the printed die; Proficiency multiplies the count in play, not here. */
export function printedDamage(weapon: Pick<Weapon, 'damage'>): string {
  const { count, die, modifier } = weapon.damage;
  const dice = `${count === 1 ? '' : count}d${die}`;
  return modifier === 0 ? dice : `${dice}${formatSigned(modifier)}`;
}

/** A trait name for display; `spellcast` is resolved before this is called. */
const traitName = (trait: Trait | 'spellcast'): string =>
  trait === 'spellcast' ? t('trait.spellcast') : label(trait);

/** "Uses your Agility +2" — highlighted when it's the reason for the badge. */
export function weaponNote({ trait, modifier, reason }: RankedWeapon) {
  if (trait === null || modifier === null) return undefined;
  const params = { trait: label(trait), modifier: formatSigned(modifier) };
  return (
    <span className={reason === null ? 'gear-note' : 'gear-note is-recommended'}>
      {reason === 'spellcast' ? t('wizard.step5.usesSpellcast', params) : t('wizard.step5.usesTrait', params)}
    </span>
  );
}

export function weaponItem(ranked: RankedWeapon): CarouselItem {
  const { weapon, reason } = ranked;
  const magic = weapon.damageType !== 'physical';
  return {
    id: weapon.id,
    name: weapon.name,
    image: artUrl('weapons', weapon.id),
    fallback: <GearGlyph glyph={weaponGlyph(weapon)} className="gear-glyph" />,
    className: magic ? 'gear-card is-magic' : 'gear-card',
    accent: magic ? ARCANE_ACCENT : STEEL_ACCENT,
    badge: reason === null ? undefined : t('wizard.step5.recommended'),
    note: weaponNote(ranked),
    flavor: weapon.feature ? flavorText(weapon.feature.text, 90) : undefined,
    chips: (
      <>
        <span className="carousel-chip">{traitName(ranked.trait ?? weapon.trait)}</span>
        <span className="carousel-chip">{label(weapon.range)}</span>
        <span className="carousel-chip-break" aria-hidden="true" />
        <span className={magic ? 'carousel-chip gear-chip-damage is-magic' : 'carousel-chip gear-chip-damage'}>
          {t('wizard.step5.damage', { dice: printedDamage(weapon), type: label(weapon.damageType).toLowerCase() })}
        </span>
        <span className="carousel-chip">{label(weapon.burden)}</span>
        {weapon.feature ? <span className="carousel-chip">{weapon.feature.name}</span> : null}
      </>
    ),
    detail: weapon.feature ? (
      <div className="carousel-detail-grid">
        <FeatureBlock heading={t('wizard.card.feature')} feature={weapon.feature} />
      </div>
    ) : undefined,
  };
}

export function armorItem(armor: Armor): CarouselItem {
  return {
    id: armor.id,
    name: armor.name,
    image: artUrl('armor', armor.id),
    fallback: <GearGlyph glyph={armorGlyph(armor)} className="gear-glyph" />,
    className: 'gear-card',
    accent: HERITAGE_ACCENT,
    flavor: armor.feature ? flavorText(armor.feature.text, 90) : undefined,
    chips: (
      <>
        <span className="carousel-chip">{t('wizard.step5.armorScore', { score: armor.baseScore })}</span>
        <span className="carousel-chip">
          {t('wizard.step5.baseThresholds', { major: armor.baseThresholds.major, severe: armor.baseThresholds.severe })}
        </span>
        {armor.feature ? (
          <>
            <span className="carousel-chip-break" aria-hidden="true" />
            <span className="carousel-chip">{armor.feature.name}</span>
          </>
        ) : null}
      </>
    ),
    detail: armor.feature ? (
      <div className="carousel-detail-grid">
        <FeatureBlock heading={t('wizard.card.feature')} feature={armor.feature} />
      </div>
    ) : undefined,
  };
}
