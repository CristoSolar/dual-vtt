import {
  formatDice,
  formatModifier,
  srd,
  type Adversary,
  type Ancestry,
  type Armor,
  type Beastform,
  type CharacterClass,
  type Community,
  type Domain,
  type DomainCard,
  type Environment,
  type Item,
  type Subclass,
  type Weapon,
} from '@daggerheart/srd-data';
import type { ReactNode } from 'react';

import { t, type MessageKey } from '../../i18n/index.js';
import type { CollectionKey } from './collections.js';

type Nav = (c: CollectionKey, id: string | null) => void;

function Field({ label, children }: { label: MessageKey; children: ReactNode }) {
  return (
    <div className="compendium-field">
      <dt>{t(label)}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function FeatureList({
  features,
}: {
  features: readonly { name: string; text: string; type?: 'action' | 'reaction' | 'passive'; costsFear?: boolean }[];
}) {
  return (
    <ul className="compendium-features">
      {features.map((f) => (
        <li key={f.name}>
          <strong>{f.name}</strong>
          {f.type !== undefined ? <span className="badge">{t(`compendium.featureType.${f.type}` as MessageKey)}</span> : null}
          {f.costsFear === true ? <span className="badge warn">{t('compendium.field.fear')}</span> : null}
          <p className="card-text">{f.text}</p>
        </li>
      ))}
    </ul>
  );
}

function LinkButton({ to, id, label, nav }: { to: CollectionKey; id: string; label: string; nav: Nav }) {
  return (
    <button type="button" className="link" onClick={() => nav(to, id)}>
      {label}
    </button>
  );
}

function ClassDetail({ e, nav }: { e: CharacterClass; nav: Nav }) {
  const subs = srd().subclasses.filter((s) => e.subclasses.includes(s.id));
  const domains = srd().domains.filter((d) => e.domains.includes(d.id));
  return (
    <dl>
      <Field label="compendium.field.startingEvasion">{e.startingEvasion}</Field>
      <Field label="compendium.field.startingHP">{e.startingHP}</Field>
      <Field label="compendium.field.classItems">{e.classItems}</Field>
      <Field label="compendium.field.domains">
        {domains.map((d) => (
          <LinkButton key={d.id} to="domains" id={d.id} label={d.name} nav={nav} />
        ))}
      </Field>
      <Field label="compendium.field.subclasses">
        {subs.map((s) => (
          <LinkButton key={s.id} to="subclasses" id={s.id} label={s.name} nav={nav} />
        ))}
      </Field>
      <Field label="compendium.field.hopeFeature">
        <FeatureList features={[e.hopeFeature]} />
      </Field>
      <Field label="compendium.field.features">
        <FeatureList features={e.features} />
      </Field>
    </dl>
  );
}

function SubclassDetail({ e, nav }: { e: Subclass; nav: Nav }) {
  const characterClass = srd().classes.find((c) => c.id === e.classId);
  return (
    <dl>
      <Field label="compendium.field.classes">
        {characterClass !== undefined ? (
          <LinkButton to="classes" id={characterClass.id} label={characterClass.name} nav={nav} />
        ) : (
          '—'
        )}
      </Field>
      <Field label="compendium.field.trait">
        {e.spellcastTrait === null ? '—' : t(`trait.${e.spellcastTrait}` as MessageKey)}
      </Field>
      <Field label="compendium.field.foundation">
        <FeatureList features={e.foundation} />
      </Field>
      <Field label="compendium.field.specialization">
        <FeatureList features={e.specialization} />
      </Field>
      <Field label="compendium.field.mastery">
        <FeatureList features={e.mastery} />
      </Field>
    </dl>
  );
}

function AncestryDetail({ e }: { e: Ancestry }) {
  return (
    <dl>
      <Field label="compendium.field.features">
        <FeatureList features={e.features} />
      </Field>
    </dl>
  );
}

function CommunityDetail({ e }: { e: Community }) {
  return (
    <dl>
      <Field label="compendium.field.features">
        <FeatureList features={[e.feature]} />
      </Field>
    </dl>
  );
}

function DomainDetail({ e, nav }: { e: Domain; nav: Nav }) {
  const classes = srd().classes.filter((c) => e.classes.includes(c.id));
  const cards = srd()
    .domainCards.filter((c) => c.domain === e.id)
    .slice()
    .sort((a, b) => a.level - b.level);
  return (
    <>
      <p className="card-text">{e.text}</p>
      <dl>
        <Field label="compendium.field.classes">
          {classes.map((c) => (
            <LinkButton key={c.id} to="classes" id={c.id} label={c.name} nav={nav} />
          ))}
        </Field>
        <Field label="compendium.field.cards">
          {cards.map((c) => (
            <LinkButton key={c.id} to="domainCards" id={c.id} label={c.name} nav={nav} />
          ))}
        </Field>
      </dl>
    </>
  );
}

function DomainCardDetail({ e, nav }: { e: DomainCard; nav: Nav }) {
  const domain = srd().domains.find((d) => d.id === e.domain);
  return (
    <>
      <dl>
        <Field label="compendium.field.domain">
          {domain !== undefined ? <LinkButton to="domains" id={domain.id} label={domain.name} nav={nav} /> : e.domain}
        </Field>
        <Field label="compendium.field.level">{e.level}</Field>
        <Field label="compendium.field.type">{t(`compendium.cardType.${e.type}` as MessageKey)}</Field>
        <Field label="compendium.field.recallCost">{e.recallCost}</Field>
      </dl>
      <p className="card-text">{e.text}</p>
    </>
  );
}

function WeaponDetail({ e }: { e: Weapon }) {
  return (
    <dl>
      <Field label="compendium.field.tier">{e.tier}</Field>
      <Field label="compendium.field.type">
        {t(`compendium.weaponCategory.${e.category}` as MessageKey)}
      </Field>
      <Field label="compendium.field.trait">{t(`trait.${e.trait}` as MessageKey)}</Field>
      <Field label="compendium.field.range">{t(`range.${e.range}` as MessageKey)}</Field>
      <Field label="compendium.field.damage">
        {formatDice(e.damage)} {t(`damageType.${e.damageType}` as MessageKey)}
      </Field>
      <Field label="compendium.field.burden">{t(`burden.${e.burden}` as MessageKey)}</Field>
      <Field label="compendium.field.features">
        {e.feature === null ? '—' : <FeatureList features={[e.feature]} />}
      </Field>
    </dl>
  );
}

function ArmorDetail({ e }: { e: Armor }) {
  return (
    <dl>
      <Field label="compendium.field.tier">{e.tier}</Field>
      <Field label="compendium.field.baseScore">{e.baseScore}</Field>
      <Field label="compendium.field.thresholds">
        {e.baseThresholds.major} / {e.baseThresholds.severe}
      </Field>
      <Field label="compendium.field.features">
        {e.feature === null ? '—' : <FeatureList features={[e.feature]} />}
      </Field>
    </dl>
  );
}

function formatStatBlockDamage(damage: { count: number; die: number | null; modifier: number }): string {
  const dice = damage.die === null ? '' : `${damage.count}d${damage.die}`;
  return `${dice}${formatModifier(damage.modifier)}`.trim();
}

function formatAttackModifier(modifier: Adversary['attackModifier']): string {
  if (modifier.flat !== null) return formatModifier(modifier.flat);
  if (modifier.roll !== null) return `+${modifier.roll.count}d${modifier.roll.die}`;
  return '—';
}

function AdversaryDetail({ e }: { e: Adversary }) {
  return (
    <>
      <p className="card-text">{e.description}</p>
      <dl>
        <Field label="compendium.field.tier">{e.tier}</Field>
        <Field label="compendium.field.type">{t(`compendium.adversaryType.${e.type}` as MessageKey)}</Field>
        <Field label="compendium.field.difficulty">{e.difficulty}</Field>
        <Field label="compendium.field.thresholds">
          {e.thresholds === null
            ? '—'
            : `${e.thresholds.major} / ${e.thresholds.severe === null ? '—' : e.thresholds.severe}`}
        </Field>
        <Field label="compendium.field.hp">{e.hp}</Field>
        <Field label="compendium.field.stress">{e.stress}</Field>
        <Field label="compendium.field.attack">
          {formatAttackModifier(e.attackModifier)} — {e.standardAttack.name} ·{' '}
          {t(`range.${e.standardAttack.range}` as MessageKey)} · {formatStatBlockDamage(e.standardAttack.damage)}{' '}
          {t(`damageType.${e.standardAttack.damageType}` as MessageKey)}
          {e.standardAttack.direct ? ` · ${t('compendium.field.direct')}` : ''}
        </Field>
        <Field label="compendium.field.motives">
          <p className="card-text">{e.motivesAndTactics}</p>
        </Field>
        <Field label="compendium.field.experiences">
          {e.experiences.map((x) => (
            <span key={x.name} className="badge">
              {x.name} {formatModifier(x.modifier)}
            </span>
          ))}
        </Field>
      </dl>
      <FeatureList features={e.features} />
    </>
  );
}

function EnvironmentDetail({ e }: { e: Environment }) {
  return (
    <>
      <p className="card-text">{e.description}</p>
      <dl>
        <Field label="compendium.field.tier">{e.tier}</Field>
        <Field label="compendium.field.type">{t(`compendium.environmentType.${e.type}` as MessageKey)}</Field>
        <Field label="compendium.field.difficulty">
          {e.difficulty === 'special' ? t('compendium.field.difficultySpecial') : e.difficulty}
        </Field>
        <Field label="compendium.field.impulses">
          <p className="card-text">{e.impulses}</p>
        </Field>
        <Field label="compendium.field.potentialAdversaries">
          <p className="card-text">{e.potentialAdversaries}</p>
        </Field>
      </dl>
      <FeatureList features={e.features} />
    </>
  );
}

function ItemDetail({ e }: { e: Item }) {
  return (
    <>
      <dl>
        <Field label="compendium.field.roll">{e.roll}</Field>
      </dl>
      <p className="card-text">{e.text}</p>
    </>
  );
}

function BeastformDetail({ e }: { e: Beastform }) {
  return (
    <dl>
      <Field label="compendium.field.tier">{e.tier}</Field>
      <Field label="compendium.field.examples">{e.examples}</Field>
      <Field label="compendium.field.trait">
        {e.trait === null
          ? '—'
          : `${t(`trait.${e.trait}` as MessageKey)} ${e.traitBonus === null ? '' : formatModifier(e.traitBonus)}`.trim()}
      </Field>
      <Field label="compendium.field.evasion">{e.evasionBonus === null ? '—' : formatModifier(e.evasionBonus)}</Field>
      <Field label="compendium.field.attack">
        {e.attack === null
          ? '—'
          : `${t(`trait.${e.attack.trait}` as MessageKey)} · ${t(`range.${e.attack.range}` as MessageKey)} · ${formatDice(
              e.attack.damage,
            )} ${t(`damageType.${e.attack.damageType}` as MessageKey)}`}
      </Field>
      <Field label="compendium.field.advantages">{e.advantages.length === 0 ? '—' : e.advantages.join(', ')}</Field>
      <Field label="compendium.field.features">
        <FeatureList features={e.features} />
      </Field>
    </dl>
  );
}

export function EntryDetail({
  collection,
  id,
  onNavigate,
}: {
  collection: CollectionKey;
  id: string;
  onNavigate: Nav;
}) {
  const entry = (srd()[collection] as readonly { id: string; name: string }[]).find((e) => e.id === id);
  if (entry === undefined) return <p className="muted">{t('compendium.notFound')}</p>;
  return (
    <article className="compendium-entry">
      <h2>{entry.name}</h2>
      {collection === 'classes' ? <ClassDetail e={entry as CharacterClass} nav={onNavigate} /> : null}
      {collection === 'subclasses' ? <SubclassDetail e={entry as Subclass} nav={onNavigate} /> : null}
      {collection === 'ancestries' ? <AncestryDetail e={entry as Ancestry} /> : null}
      {collection === 'communities' ? <CommunityDetail e={entry as Community} /> : null}
      {collection === 'domains' ? <DomainDetail e={entry as Domain} nav={onNavigate} /> : null}
      {collection === 'domainCards' ? <DomainCardDetail e={entry as DomainCard} nav={onNavigate} /> : null}
      {collection === 'weapons' ? <WeaponDetail e={entry as Weapon} /> : null}
      {collection === 'armor' ? <ArmorDetail e={entry as Armor} /> : null}
      {collection === 'adversaries' ? <AdversaryDetail e={entry as Adversary} /> : null}
      {collection === 'environments' ? <EnvironmentDetail e={entry as Environment} /> : null}
      {collection === 'loot' ? <ItemDetail e={entry as Item} /> : null}
      {collection === 'consumables' ? <ItemDetail e={entry as Item} /> : null}
      {collection === 'beastforms' ? <BeastformDetail e={entry as Beastform} /> : null}
    </article>
  );
}
