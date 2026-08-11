# Exportar hoja de personaje a PDF — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player export their character sheet as a print-ready, Spanish-language recreation of the official Daggerheart sheet, saved to PDF via the browser's native print dialog.

**Architecture:** A new presentational component (`PrintableSheet`) renders the full sheet from data already available on `SheetRoute` (no new state, no new selectors beyond what exists). A dedicated stylesheet lays it out as a fixed A4 page with cut-corner boxes and shield/diamond marks built from CSS `clip-path`, no images. `SheetRoute` gets one button that toggles the overlay; the overlay's own button calls `window.print()`.

**Tech Stack:** React + TypeScript (existing `apps/web` app), plain CSS (no new npm packages).

## Global Constraints

- No new dependencies (spec: "Sin dependencias nuevas").
- All new user-facing text in Spanish.
- Fiel a 1 página: fixed A4 layout, overflow inside a section is clipped rather than growing the page (spec: "Manejo de overflow").
- `tsconfig.base.json` strict mode applies: relative imports use `.js` extensions, indexing returns `T | undefined`, optional fields can't be assigned explicit `undefined`.
- No linter/formatter exists in this repo — `pnpm -F @daggerheart/web typecheck` is the static gate for every task.

---

### Task 1: Print stylesheet

**Files:**
- Create: `apps/web/src/styles/print-sheet.css`
- Modify: `apps/web/src/main.tsx` (add one import line)

**Interfaces:**
- Consumes: nothing (pure CSS).
- Produces: the class names Task 2's markup relies on — `print-overlay`, `print-toolbar`, `no-print`, `print-sheet`, `ps-header`, `ps-header-title`, `ps-header-fields`, `ps-field`, `ps-field--wide`, `ps-field-label`, `ps-field-value`, `ps-level`, `ps-level-number`, `ps-level-label`, `ps-traits-row`, `ps-trait`, `ps-trait-name`, `ps-trait-circle`, `ps-trait-examples`, `ps-defenses-row`, `ps-shield`, `ps-shield-value`, `ps-shield-label`, `ps-armor-slots`, `ps-box`, `ps-box--marked`, `ps-diamonds`, `ps-diamond`, `ps-diamond--marked`, `ps-pip`, `ps-pip--marked`, `ps-columns`, `ps-col`, `ps-section`, `ps-section--grow`, `ps-section-title`, `ps-hint`, `ps-thresholds`, `ps-tracker`, `ps-tracker-label`, `ps-feature-text`, `ps-feature-group-heading`, `ps-feature-list`, `ps-lines`, `ps-line`, `ps-gold-row`, `ps-gold-label`, `ps-gold-count`, `ps-weapon`, `ps-weapon-row`, `ps-weapon-row--fields`, `ps-footer`.

- [ ] **Step 1: Create the stylesheet**

Create `apps/web/src/styles/print-sheet.css`:

```css
/*
 * Print-only recreation of the official Daggerheart character sheet
 * (SRD, Darrington Press), translated to Spanish. Deliberately not themed
 * off tokens.css: this renders as white paper regardless of the app's dark
 * theme, both on screen (live preview) and when printed.
 */

.print-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  overflow-y: auto;
  background: #2b2b2b;
  padding: 24px;
}

.print-toolbar {
  display: flex;
  gap: 8px;
  justify-content: center;
  margin: 0 auto 16px;
  max-width: 210mm;
}

.print-toolbar button {
  font-family: var(--font-sans, sans-serif);
  font-weight: 700;
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.print-toolbar button:first-child {
  background: #1a1a1a;
  color: #fff;
}

.print-toolbar button:last-child {
  background: #ddd;
  color: #1a1a1a;
}

.print-sheet {
  width: 210mm;
  min-height: 297mm;
  margin: 0 auto;
  background: #fff;
  color: #1a1a1a;
  font-family: var(--font-sans, sans-serif);
  padding: 10mm;
  box-shadow: 0 0 24px rgb(0 0 0 / 40%);
  display: flex;
  flex-direction: column;
  gap: 6mm;
}

/* -------------------------------------------------------------- header */

.ps-header {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 6mm;
  align-items: stretch;
}

.ps-header-title {
  background: #1a1a1a;
  color: #fff;
  padding: 6mm 10mm 6mm 4mm;
  clip-path: polygon(0 0, 100% 0, 82% 100%, 0 100%);
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.ps-header-title h1 {
  margin: 0;
  font-size: 22pt;
  font-weight: 800;
  letter-spacing: 0.5px;
  color: #fff;
}

.ps-header-title p {
  margin: 0;
  font-size: 9pt;
  letter-spacing: 2px;
}

.ps-header-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2mm;
  align-content: center;
}

.ps-field {
  border: 1.5pt solid #1a1a1a;
  padding: 1mm 2mm;
  display: flex;
  flex-direction: column;
  min-height: 9mm;
}

.ps-field--wide {
  grid-column: span 2;
}

.ps-field-label {
  font-size: 6.5pt;
  font-weight: 700;
  letter-spacing: 1px;
}

.ps-field-value {
  font-size: 10pt;
}

.ps-level {
  background: #ccc;
  clip-path: polygon(50% 0, 100% 20%, 100% 100%, 0 100%, 0 20%);
  width: 22mm;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.ps-level-number {
  font-size: 20pt;
  font-weight: 800;
}

.ps-level-label {
  font-size: 7pt;
  font-weight: 700;
  letter-spacing: 1px;
}

/* -------------------------------------------------------------- traits */

.ps-traits-row {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 2mm;
}

.ps-trait {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 1mm;
}

.ps-trait-name {
  background: #1a1a1a;
  color: #fff;
  font-size: 7pt;
  font-weight: 700;
  letter-spacing: 0.5px;
  padding: 1mm 3mm;
  clip-path: polygon(0 0, 100% 0, 88% 100%, 0 100%);
  width: 100%;
  text-align: center;
}

.ps-trait-circle {
  width: 13mm;
  height: 13mm;
  border: 2pt solid #1a1a1a;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13pt;
  font-weight: 800;
}

.ps-trait-examples {
  font-size: 6.5pt;
  color: #444;
  line-height: 1.3;
}

/* ------------------------------------------------------------ defenses */

.ps-defenses-row {
  display: flex;
  align-items: center;
  gap: 6mm;
}

.ps-shield {
  width: 20mm;
  height: 22mm;
  clip-path: polygon(0 0, 100% 0, 100% 65%, 50% 100%, 0 65%);
  background: #f2f2f2;
  border: 1.5pt solid #1a1a1a;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.ps-shield-value {
  font-size: 16pt;
  font-weight: 800;
}

.ps-shield-label {
  font-size: 6.5pt;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.ps-armor-slots {
  display: flex;
  flex-wrap: wrap;
  gap: 1mm;
}

/* -------------------------------------------------------------- boxes */

.ps-box {
  width: 3.5mm;
  height: 3.5mm;
  border: 1.2pt solid #1a1a1a;
  display: inline-block;
}

.ps-box--marked {
  background: #1a1a1a;
}

.ps-diamonds {
  display: flex;
  gap: 2mm;
}

.ps-diamond {
  width: 4mm;
  height: 4mm;
  border: 1.2pt solid #1a1a1a;
  transform: rotate(45deg);
  display: inline-block;
}

.ps-diamond--marked {
  background: #1a1a1a;
}

.ps-pip {
  width: 3mm;
  height: 3mm;
  border-radius: 50%;
  border: 1.2pt solid #1a1a1a;
  display: inline-block;
}

.ps-pip--marked {
  background: #1a1a1a;
}

/* ------------------------------------------------------------- layout */

.ps-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6mm;
  flex: 1;
}

.ps-col {
  display: flex;
  flex-direction: column;
  gap: 4mm;
}

.ps-section {
  border: 1.5pt solid #1a1a1a;
  clip-path: polygon(0 0, 100% 0, 100% 96%, 97% 100%, 0 100%);
  padding: 3mm;
}

.ps-section--grow {
  flex: 1;
}

.ps-section-title {
  background: #1a1a1a;
  color: #fff;
  display: inline-block;
  font-size: 10pt;
  font-weight: 800;
  letter-spacing: 1px;
  padding: 1mm 4mm;
  margin: -3mm -3mm 2mm -3mm;
  clip-path: polygon(3% 0, 100% 0, 97% 100%, 0 100%);
}

.ps-hint {
  font-size: 6.5pt;
  color: #555;
  margin: 0 0 1mm;
}

.ps-thresholds {
  display: flex;
  justify-content: space-between;
  font-size: 6.5pt;
  font-weight: 700;
  margin-bottom: 1mm;
}

.ps-tracker {
  display: flex;
  align-items: center;
  gap: 1mm;
  flex-wrap: wrap;
  margin-bottom: 1mm;
}

.ps-tracker-label {
  font-size: 7pt;
  font-weight: 700;
  width: 10mm;
}

.ps-feature-text {
  font-size: 7.5pt;
  margin: 0 0 1mm;
}

.ps-feature-group-heading {
  font-size: 7pt;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0 0 0.5mm;
}

.ps-feature-list {
  overflow: hidden;
}

.ps-lines {
  margin: 0;
  padding-left: 4mm;
  font-size: 7.5pt;
}

.ps-line {
  display: block;
  border-bottom: 0.75pt solid #999;
  height: 4mm;
  margin: 0 0 1mm;
}

.ps-gold-row {
  display: flex;
  align-items: center;
  gap: 1mm;
  margin-bottom: 1mm;
}

.ps-gold-label {
  font-size: 6.5pt;
  font-weight: 700;
  width: 16mm;
}

.ps-gold-count {
  font-size: 9pt;
  font-weight: 800;
}

.ps-weapon {
  margin-bottom: 2mm;
}

.ps-weapon-row {
  font-size: 6.5pt;
  font-weight: 700;
}

.ps-weapon-row--fields {
  display: grid;
  grid-template-columns: 2fr 1.4fr 1.4fr;
  gap: 2mm;
  font-size: 8pt;
  font-weight: 400;
}

.ps-footer {
  font-size: 6pt;
  color: #777;
  text-align: center;
  margin: 0;
}

/* ------------------------------------------------------------- overflow */

.ps-section--grow .ps-feature-list,
.ps-section--grow .ps-lines {
  max-height: 40mm;
  overflow: hidden;
  font-size: 7pt;
}

/* ----------------------------------------------------------------- print */

@media print {
  @page {
    size: A4;
    margin: 0;
  }

  body * {
    visibility: hidden;
  }

  .print-overlay,
  .print-overlay * {
    visibility: visible;
  }

  .print-overlay {
    position: absolute;
    inset: 0;
    background: none;
    padding: 0;
    overflow: visible;
  }

  .print-sheet {
    box-shadow: none;
    margin: 0;
    width: 210mm;
    min-height: 297mm;
  }

  .no-print {
    display: none !important;
  }
}
```

- [ ] **Step 2: Import it once, alongside the existing global stylesheet**

In `apps/web/src/main.tsx`, next to the existing `import './styles/app.css';`, add:

```ts
import './styles/print-sheet.css';
```

- [ ] **Step 3: Verify the app still boots**

Run: `pnpm -F @daggerheart/web dev`
Expected: Vite starts with no errors (there is no markup using these classes yet, so nothing renders differently — this step only confirms the CSS file has no syntax error Vite's PostCSS pass would reject).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/styles/print-sheet.css apps/web/src/main.tsx
git commit -m "feat: add print stylesheet for character sheet PDF export"
```

---

### Task 2: `PrintableSheet` component

**Files:**
- Create: `apps/web/src/components/sheet/PrintableSheet.tsx`

**Interfaces:**
- Consumes: `SheetState` from `../../state/sheet.js`; `selectSheetView`, `describeWeaponDamage`, `label` from `../../state/selectors.js`; `MAX_HOPE` from `@daggerheart/rules`. Reads `character.name`, `.pronouns`, `.level`, `.evasion`, `.armorScore`, `.major`, `.severe`, `.hpSlots`, `.stressSlots`, `.experiences` (`Record<string, number>`), `.inventory` (`string[]`), all confirmed to exist on `Character` in `packages/character/src/types.ts:193-233`. Reads `sheet.hpMarked`, `.stressMarked`, `.hope`, `.armorSlotsMarked`, `.gold.{handfuls,bags,chests}` from `SheetState` (`packages/protocol/src/sheet.ts:50-59`). `SheetView.traits[i]` is `{ trait: Trait; label: string; modifier: number }`; `SheetView.primaryWeapon`/`secondaryWeapon` is `Weapon | null` with `{ id, name, trait, range, damage, damageType, feature }` (`packages/srd-data/src/schemas.ts:91-107`); `SheetView.armor` is `Armor | null` with `{ name, baseThresholds: { major, severe }, baseScore, feature }` (`packages/srd-data/src/schemas.ts:109-118`); `Feature` is `{ name: string; text: string }`.
- Produces: `PrintableSheet({ sheet, onClose }: { sheet: SheetState; onClose: () => void }): JSX.Element`, consumed by Task 3.

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/sheet/PrintableSheet.tsx`:

```tsx
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
```

- [ ] **Step 2: Typecheck**

Run: `pnpm -F @daggerheart/web typecheck`
Expected: no errors. If `noUncheckedIndexedAccess` complains about `TRAIT_EXAMPLES[trait.trait]`, the `?? ['', '', '']` fallback already handles it — if it still fails, check the fallback tuple's type matches `readonly [string, string, string]`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/sheet/PrintableSheet.tsx
git commit -m "feat: add PrintableSheet component for character sheet PDF export"
```

---

### Task 3: Wire the export button into `SheetRoute`

**Files:**
- Modify: `apps/web/src/routes/SheetRoute.tsx`

**Interfaces:**
- Consumes: `PrintableSheet` from `../components/sheet/PrintableSheet.js` (Task 2), with props `{ sheet: SheetState; onClose: () => void }`.
- Produces: nothing further downstream — this is the final task.

- [ ] **Step 1: Import the component**

In `apps/web/src/routes/SheetRoute.tsx`, add to the existing block of sheet-component imports (near the top, alongside `DamageDialog`, `DeathMoveDialog`, etc.):

```ts
import { PrintableSheet } from '../components/sheet/PrintableSheet.js';
```

- [ ] **Step 2: Add the toggle state**

Next to the existing `useState` calls (around `const [showLevelUp, setShowLevelUp] = useState(false);`), add:

```ts
const [showPrint, setShowPrint] = useState(false);
```

- [ ] **Step 3: Add the button**

In the header's button row — the `<div className="row">` that currently contains "Recibir daño" and "Subir de nivel" — add a third button before the "Personajes" link:

```tsx
<div className="row">
  <button type="button" onClick={() => setShowDamage(true)}>
    Recibir daño
  </button>
  <button type="button" onClick={() => setShowLevelUp(true)}>
    Subir de nivel
  </button>
  <button type="button" onClick={() => setShowPrint(true)}>
    Exportar PDF
  </button>
  <Link to="/">
    <button type="button">Personajes</button>
  </Link>
</div>
```

- [ ] **Step 4: Render the overlay**

At the end of the returned JSX, alongside the other conditionally-rendered overlays (near `{toast !== null ? <Toast ... /> : null}`), add:

```tsx
{showPrint ? <PrintableSheet sheet={sheet} onClose={() => setShowPrint(false)} /> : null}
```

- [ ] **Step 5: Typecheck**

Run: `pnpm -F @daggerheart/web typecheck`
Expected: no errors.

- [ ] **Step 6: Manual verification**

Run: `pnpm -F @daggerheart/web dev`

In the browser: open a character's sheet, click "Exportar PDF". Confirm:
- The overlay shows a white A4 page styled like the reference image, with the character's actual name, traits, HP/Estrés/Esperanza marks, weapons, class features, and inventory, all in Spanish.
- "Imprimir / Guardar PDF" opens the browser print dialog with only the sheet visible (rest of the app hidden) — check the print preview specifically, not just the on-screen overlay.
- "Cerrar" dismisses the overlay and returns to the normal sheet.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/routes/SheetRoute.tsx
git commit -m "feat: add PDF export button to character sheet"
```
