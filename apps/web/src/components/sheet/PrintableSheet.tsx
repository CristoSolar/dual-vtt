import { MAX_HOPE } from '@daggerheart/rules';
import { createPortal } from 'react-dom';

import { t, type MessageKey } from '../../i18n/index.js';
import { describeWeaponDamage, label, selectSheetView } from '../../state/selectors.js';
import type { SheetState } from '../../state/sheet.js';

interface PrintableSheetProps {
  sheet: SheetState;
  onClose: () => void;
}

/** Flavor examples printed under each trait, same order as the official sheet. */
const TRAIT_EXAMPLE_KEYS: Record<string, MessageKey> = {
  agility: 'sheet.print.traitExamples.agility',
  strength: 'sheet.print.traitExamples.strength',
  finesse: 'sheet.print.traitExamples.finesse',
  instinct: 'sheet.print.traitExamples.instinct',
  presence: 'sheet.print.traitExamples.presence',
  knowledge: 'sheet.print.traitExamples.knowledge',
};

const traitExamples = (trait: string): string => {
  const key = TRAIT_EXAMPLE_KEYS[trait];
  return key === undefined ? '' : t(key);
};

/** `total` boxes, the first `marked` of them filled in. */
const boxes = (marked: number, total: number): readonly boolean[] =>
  Array.from({ length: total }, (_, i) => i < marked);

/** A print-only recreation of the official Daggerheart character sheet. */
export function PrintableSheet({ sheet, onClose }: PrintableSheetProps) {
  const character = sheet.character;
  const view = selectSheetView(sheet);
  const experiences = Object.entries(character.experiences);
  const equippedWeapons = [view.primaryWeapon, view.secondaryWeapon] as const;

  return createPortal(
    <div className="print-overlay">
      <div className="print-toolbar no-print">
        <button type="button" onClick={() => window.print()}>
          {t('sheet.print.printButton')}
        </button>
        <button type="button" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>

      <div className="print-sheet">
        <div className="ps-header">
          <div className="ps-header-title">
            <h1>DUAL VTT</h1>
            <p>{t('sheet.print.subtitle')}</p>
          </div>
          <div className="ps-header-fields">
            <div className="ps-field ps-field--wide">
              <span className="ps-field-label">{t('sheet.print.name')}</span>
              <span className="ps-field-value">{character.name ?? ''}</span>
            </div>
            <div className="ps-field">
              <span className="ps-field-label">{t('sheet.print.pronouns')}</span>
              <span className="ps-field-value">{character.pronouns ?? ''}</span>
            </div>
            <div className="ps-field ps-field--wide">
              <span className="ps-field-label">{t('sheet.print.ancestry')}</span>
              <span className="ps-field-value">{view.heritageLabel}</span>
            </div>
            <div className="ps-field">
              <span className="ps-field-label">{t('sheet.print.subclass')}</span>
              <span className="ps-field-value">{view.subclassName}</span>
            </div>
          </div>
          <div className="ps-level">
            <span className="ps-level-number">{character.level}</span>
            <span className="ps-level-label">{t('sheet.print.level')}</span>
          </div>
        </div>

        <div className="ps-traits-row">
          {view.traits.map((trait) => (
            <div className="ps-trait" key={trait.trait}>
              <span className="ps-trait-name">{trait.label.toUpperCase()}</span>
              <span className="ps-trait-circle">
                {trait.modifier >= 0 ? `+${trait.modifier}` : trait.modifier}
              </span>
              <span className="ps-trait-examples">{traitExamples(trait.trait)}</span>
            </div>
          ))}
        </div>

        <div className="ps-defenses-row">
          <div className="ps-shield">
            <span className="ps-shield-value">{character.evasion}</span>
            <span className="ps-shield-label">{t('sheet.print.evasion')}</span>
          </div>
          <div className="ps-shield">
            <span className="ps-shield-value">{character.armorScore}</span>
            <span className="ps-shield-label">{t('sheet.print.armor')}</span>
          </div>
          <div className="ps-armor-slots">
            {boxes(sheet.armorSlotsMarked, character.armorScore).map((marked, i) => (
              <span key={i} className={marked ? 'ps-box ps-box--marked' : 'ps-box'} />
            ))}
          </div>
        </div>

        <div className="ps-columns">
          <div className="ps-col">
            <section className="ps-section">
              <h2 className="ps-section-title">{t('sheet.print.damageAndHp')}</h2>
              <p className="ps-hint">{t('sheet.print.thresholdsHint')}</p>
              <div className="ps-thresholds">
                <span>{t('sheet.print.minorDamage')}</span>
                <span>{t('sheet.print.majorDamage', { major: character.major })}</span>
                <span>{t('sheet.print.severeDamage', { severe: character.severe })}</span>
              </div>
              <div className="ps-tracker">
                <span className="ps-tracker-label">{t('sheet.print.hpAbbrev')}</span>
                {boxes(sheet.hpMarked, character.hpSlots).map((marked, i) => (
                  <span key={i} className={marked ? 'ps-box ps-box--marked' : 'ps-box'} />
                ))}
              </div>
              <div className="ps-tracker">
                <span className="ps-tracker-label">{t('sheet.print.stress')}</span>
                {boxes(sheet.stressMarked, character.stressSlots).map((marked, i) => (
                  <span key={i} className={marked ? 'ps-box ps-box--marked' : 'ps-box'} />
                ))}
              </div>
            </section>

            <section className="ps-section">
              <h2 className="ps-section-title">{t('sheet.print.hope')}</h2>
              <p className="ps-hint">{t('sheet.print.hopeHint')}</p>
              <div className="ps-diamonds">
                {boxes(sheet.hope, MAX_HOPE).map((marked, i) => (
                  <span key={i} className={marked ? 'ps-diamond ps-diamond--marked' : 'ps-diamond'} />
                ))}
              </div>
              <p className="ps-feature-text">
                <strong>{view.hopeFeature.name}:</strong> {view.hopeFeature.text}
              </p>
            </section>

            <section className="ps-section">
              <h2 className="ps-section-title">{t('sheet.print.experiences')}</h2>
              <ul className="ps-lines">
                {experiences.map(([name, modifier]) => (
                  <li key={name}>
                    {name} {modifier >= 0 ? `+${modifier}` : modifier}
                  </li>
                ))}
              </ul>
            </section>

            <section className="ps-section">
              <h2 className="ps-section-title">{t('sheet.print.gold')}</h2>
              <div className="ps-gold-row">
                <span className="ps-gold-label">{t('sheet.print.handfuls')}</span>
                {boxes(Math.min(sheet.gold.handfuls, 9), 9).map((marked, i) => (
                  <span key={i} className={marked ? 'ps-pip ps-pip--marked' : 'ps-pip'} />
                ))}
              </div>
              <div className="ps-gold-row">
                <span className="ps-gold-label">{t('sheet.print.bags')}</span>
                {boxes(Math.min(sheet.gold.bags, 9), 9).map((marked, i) => (
                  <span key={i} className={marked ? 'ps-pip ps-pip--marked' : 'ps-pip'} />
                ))}
              </div>
              <div className="ps-gold-row">
                <span className="ps-gold-label">{t('sheet.print.chests')}</span>
                <span className="ps-gold-count">{sheet.gold.chests}</span>
              </div>
            </section>

          </div>

          <div className="ps-col">
            <section className="ps-section">
              <h2 className="ps-section-title">{t('sheet.print.weapons')}</h2>
              {equippedWeapons.map((weapon, index) => (
                <div className="ps-weapon" key={weapon?.id ?? `equipped-${index}`}>
                  <div className="ps-weapon-row">
                    {weapon
                      ? index === 0
                        ? t('sheet.print.primaryChecked')
                        : t('sheet.print.secondaryChecked')
                      : '☐'}
                  </div>
                  <div className="ps-weapon-row ps-weapon-row--fields">
                    <span className="ps-field-value">{weapon?.name ?? ''}</span>
                    <span className="ps-field-value">
                      {weapon ? `${label(weapon.trait)} · ${label(weapon.range)}` : ''}
                    </span>
                    <span className="ps-field-value">
                      {weapon ? `${describeWeaponDamage(weapon, character)} ${label(weapon.damageType)}` : ''}
                    </span>
                  </div>
                  {weapon?.feature ? (
                    <p className="ps-feature-text">
                      <strong>{weapon.feature.name}:</strong> {weapon.feature.text}
                    </p>
                  ) : (
                    <p className="ps-line" />
                  )}
                </div>
              ))}
              {[0, 1].map((i) => (
                <div className="ps-weapon" key={`extra-${i}`}>
                  <div className="ps-weapon-row ps-weapon-row--fields">
                    <span className="ps-line" />
                    <span className="ps-line" />
                    <span className="ps-line" />
                  </div>
                  <p className="ps-line" />
                </div>
              ))}
            </section>

            <section className="ps-section">
              <h2 className="ps-section-title">{t('sheet.print.activeArmor')}</h2>
              {view.armor ? (
                <div className="ps-weapon">
                  <div className="ps-weapon-row ps-weapon-row--fields">
                    <span className="ps-field-value">{view.armor.name}</span>
                    <span className="ps-field-value">
                      {t('sheet.print.baseThresholds', {
                        major: view.armor.baseThresholds.major,
                        severe: view.armor.baseThresholds.severe,
                      })}
                    </span>
                    <span className="ps-field-value">
                      {t('sheet.print.baseScore', { score: view.armor.baseScore })}
                    </span>
                  </div>
                  {view.armor.feature ? (
                    <p className="ps-feature-text">
                      <strong>{view.armor.feature.name}:</strong> {view.armor.feature.text}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="ps-line" />
              )}
            </section>

          </div>
        </div>

        <div className="ps-columns ps-page-break">
          <div className="ps-col">
            <section className="ps-section ps-section--grow">
              <h2 className="ps-section-title">{t('sheet.print.classFeature')}</h2>
              <div className="ps-feature-list">
                {[
                  { heading: view.className, features: view.classFeatures },
                  { heading: view.subclassName, features: view.subclassFeatures },
                  { heading: view.heritageLabel, features: view.ancestryFeatures },
                  { heading: view.communityName, features: [view.communityFeature] },
                ].map((group) => (
                  <div key={group.heading}>
                    <p className="ps-feature-group-heading">{group.heading}</p>
                    {group.features
                      .filter((feature) => feature.name !== '')
                      .map((feature) => (
                        <p className="ps-feature-text" key={feature.name}>
                          <strong>{feature.name}:</strong> {feature.text}
                        </p>
                      ))}
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="ps-col">
            <section className="ps-section ps-section--grow">
              <h2 className="ps-section-title">{t('sheet.print.inventory')}</h2>
              <ul className="ps-lines">
                {character.inventory.map((item) => (
                  <li key={item}>{item}</li>
                ))}
                {character.inventory.length === 0 ? <li className="ps-line" /> : null}
              </ul>
            </section>
          </div>
        </div>

        <p className="ps-footer">{t('sheet.print.footer')}</p>
      </div>
    </div>,
    document.body,
  );
}
