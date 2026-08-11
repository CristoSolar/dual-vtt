import { MAX_HOPE } from '@daggerheart/rules';

import { describeWeaponDamage, label, selectSheetView } from '../../state/selectors.js';
import type { SheetState } from '../../state/sheet.js';

interface PrintableSheetProps {
  sheet: SheetState;
  onClose: () => void;
}

/** Spanish flavor examples printed under each trait, same order as the official sheet. */
const TRAIT_EXAMPLES: Record<string, readonly [string, string, string]> = {
  agility: ['Correr', 'Saltar', 'Maniobrar'],
  strength: ['Levantar', 'Golpear', 'Forcejear'],
  finesse: ['Controlar', 'Ocultarse', 'Manipular'],
  instinct: ['Percibir', 'Sentir', 'Navegar'],
  presence: ['Encantar', 'Actuar', 'Engañar'],
  knowledge: ['Recordar', 'Analizar', 'Comprender'],
};

/** `total` boxes, the first `marked` of them filled in. */
const boxes = (marked: number, total: number): readonly boolean[] =>
  Array.from({ length: total }, (_, i) => i < marked);

/** A print-only recreation of the official Daggerheart character sheet, in Spanish. */
export function PrintableSheet({ sheet, onClose }: PrintableSheetProps) {
  const character = sheet.character;
  const view = selectSheetView(sheet);
  const experiences = Object.entries(character.experiences);
  const equippedWeapons = [view.primaryWeapon, view.secondaryWeapon] as const;

  return (
    <div className="print-overlay">
      <div className="print-toolbar no-print">
        <button type="button" onClick={() => window.print()}>
          Imprimir / Guardar PDF
        </button>
        <button type="button" onClick={onClose}>
          Cerrar
        </button>
      </div>

      <div className="print-sheet">
        <div className="ps-header">
          <div className="ps-header-title">
            <h1>DAGGERHEART</h1>
            <p>HOJA DE PERSONAJE</p>
          </div>
          <div className="ps-header-fields">
            <div className="ps-field ps-field--wide">
              <span className="ps-field-label">NOMBRE</span>
              <span className="ps-field-value">{character.name ?? ''}</span>
            </div>
            <div className="ps-field">
              <span className="ps-field-label">PRONOMBRES</span>
              <span className="ps-field-value">{character.pronouns ?? ''}</span>
            </div>
            <div className="ps-field ps-field--wide">
              <span className="ps-field-label">ASCENDENCIA</span>
              <span className="ps-field-value">{view.heritageLabel}</span>
            </div>
            <div className="ps-field">
              <span className="ps-field-label">SUBCLASE</span>
              <span className="ps-field-value">{view.subclassName}</span>
            </div>
          </div>
          <div className="ps-level">
            <span className="ps-level-number">{character.level}</span>
            <span className="ps-level-label">NIVEL</span>
          </div>
        </div>

        <div className="ps-traits-row">
          {view.traits.map((trait) => (
            <div className="ps-trait" key={trait.trait}>
              <span className="ps-trait-name">{trait.label.toUpperCase()}</span>
              <span className="ps-trait-circle">
                {trait.modifier >= 0 ? `+${trait.modifier}` : trait.modifier}
              </span>
              <span className="ps-trait-examples">
                {(TRAIT_EXAMPLES[trait.trait] ?? ['', '', '']).join(' · ')}
              </span>
            </div>
          ))}
        </div>

        <div className="ps-defenses-row">
          <div className="ps-shield">
            <span className="ps-shield-value">{character.evasion}</span>
            <span className="ps-shield-label">EVASIÓN</span>
          </div>
          <div className="ps-shield">
            <span className="ps-shield-value">{character.armorScore}</span>
            <span className="ps-shield-label">ARMADURA</span>
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
              <h2 className="ps-section-title">DAÑO Y VIDA</h2>
              <p className="ps-hint">Suma tu nivel a tus umbrales de daño.</p>
              <div className="ps-thresholds">
                <span>DAÑO MENOR</span>
                <span>DAÑO MAYOR ({character.major})</span>
                <span>DAÑO GRAVE ({character.severe})</span>
              </div>
              <div className="ps-tracker">
                <span className="ps-tracker-label">PV</span>
                {boxes(sheet.hpMarked, character.hpSlots).map((marked, i) => (
                  <span key={i} className={marked ? 'ps-box ps-box--marked' : 'ps-box'} />
                ))}
              </div>
              <div className="ps-tracker">
                <span className="ps-tracker-label">ESTRÉS</span>
                {boxes(sheet.stressMarked, character.stressSlots).map((marked, i) => (
                  <span key={i} className={marked ? 'ps-box ps-box--marked' : 'ps-box'} />
                ))}
              </div>
            </section>

            <section className="ps-section">
              <h2 className="ps-section-title">ESPERANZA</h2>
              <p className="ps-hint">
                Gasta una Esperanza para usar una experiencia o ayudar a un aliado.
              </p>
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
              <h2 className="ps-section-title">EXPERIENCIAS</h2>
              <ul className="ps-lines">
                {experiences.map(([name, modifier]) => (
                  <li key={name}>
                    {name} {modifier >= 0 ? `+${modifier}` : modifier}
                  </li>
                ))}
              </ul>
            </section>

            <section className="ps-section">
              <h2 className="ps-section-title">ORO</h2>
              <div className="ps-gold-row">
                <span className="ps-gold-label">PUÑADOS</span>
                {boxes(Math.min(sheet.gold.handfuls, 9), 9).map((marked, i) => (
                  <span key={i} className={marked ? 'ps-pip ps-pip--marked' : 'ps-pip'} />
                ))}
              </div>
              <div className="ps-gold-row">
                <span className="ps-gold-label">BOLSAS</span>
                {boxes(Math.min(sheet.gold.bags, 9), 9).map((marked, i) => (
                  <span key={i} className={marked ? 'ps-pip ps-pip--marked' : 'ps-pip'} />
                ))}
              </div>
              <div className="ps-gold-row">
                <span className="ps-gold-label">COFRES</span>
                <span className="ps-gold-count">{sheet.gold.chests}</span>
              </div>
            </section>

            <section className="ps-section ps-section--grow">
              <h2 className="ps-section-title">RASGO DE CLASE</h2>
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
            <section className="ps-section">
              <h2 className="ps-section-title">ARMAS</h2>
              {equippedWeapons.map((weapon, index) => (
                <div className="ps-weapon" key={weapon?.id ?? `equipped-${index}`}>
                  <div className="ps-weapon-row">
                    {weapon ? (index === 0 ? '☑ PRIMARIA' : '☑ SECUNDARIA') : '☐'}
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
              <h2 className="ps-section-title">ARMADURA ACTIVA</h2>
              {view.armor ? (
                <div className="ps-weapon">
                  <div className="ps-weapon-row ps-weapon-row--fields">
                    <span className="ps-field-value">{view.armor.name}</span>
                    <span className="ps-field-value">
                      Umbrales base {view.armor.baseThresholds.major}/{view.armor.baseThresholds.severe}
                    </span>
                    <span className="ps-field-value">Puntuación base {view.armor.baseScore}</span>
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

            <section className="ps-section ps-section--grow">
              <h2 className="ps-section-title">INVENTARIO</h2>
              <ul className="ps-lines">
                {character.inventory.map((item) => (
                  <li key={item}>{item}</li>
                ))}
                {character.inventory.length === 0 ? <li className="ps-line" /> : null}
              </ul>
            </section>
          </div>
        </div>

        <p className="ps-footer">Daggerheart © Darrington Press 2025 · Traducción no oficial</p>
      </div>
    </div>
  );
}
