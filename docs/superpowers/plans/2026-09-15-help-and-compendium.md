# Help, Guide, Rules Primer, and Compendium Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A first-run pop-up guide, a `/help` route with an app guide, a hand-written rules primer, and a searchable compendium over the SRD data — all bilingual.

**Architecture:** Web-only. `GuideDialog` reuses `Dialog`; `HelpRoute` is one route with three tabs mirrored to the URL hash; `Compendium` reads `srd()` at render and renders one detail view per dataset shape. All text lives in `apps/web/src/i18n/{es,en}.ts`.

**Tech Stack:** React 18, react-router-dom (HashRouter), TypeScript strict, Vitest with `renderToStaticMarkup`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-15-help-and-compendium-design.md`

## Global Constraints

- No package, protocol, or server changes. No new dependency.
- All user-visible text through `t()`; `es.ts` (`as const`) is the key source, `en.ts` is `Record<keyof typeof es, string>`; placeholders identical (the existing parity test enforces).
- `srd()` and `t()` are called at render/call time, never captured in a module-level `const`. `MessageKey` maps at module level are fine (they hold keys, not text).
- `.js` relative imports; `import type`; no `!` in `src/`; `exactOptionalPropertyTypes` (conditional keys, never `x: undefined`).
- `localStorage` reads/writes wrapped in try/catch; storage injected as `StorageLike` where the existing code does so.
- Attribution line on rules and compendium views: reuse key `sheet.print.footer`.
- Spanish terms follow the SRD es data: Esperanza, Miedo, Estrés, Puntos de Vida (PV), Umbrales (Mayor/Grave), Armadura, Evasión, Bóveda, Equipo activo, Costo de Recuperación, Rangos (Cuerpo a cuerpo / Muy cerca / Cerca / Lejos / Muy lejos), DJ.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Gate per task: `pnpm -F @daggerheart/web typecheck && pnpm -F @daggerheart/web test`.

---

## File structure

| Path | Responsibility |
|---|---|
| `apps/web/src/state/storage.ts` | + `hasSeenGuide(storage, accountId)`, `markGuideSeen(storage, accountId)` |
| `apps/web/src/components/GuideDialog.tsx` | Stepped first-run guide, per role |
| `apps/web/src/routes/HelpRoute.tsx` | Tabs (`app` / `rules` / `compendium`), hash sync, text filter, `<details>` sections |
| `apps/web/src/components/help/Compendium.tsx` | Collection select, filter, result list, detail pane, deep link |
| `apps/web/src/components/help/details.tsx` | One detail renderer per dataset shape + `FeatureList` |
| `apps/web/src/App.tsx` | `?` topbar button, `/help` route, auto-open guide |
| `apps/web/src/styles/app.css` | `.help-tabs`, `.help-filter`, `.compendium` grid, `.guide-steps` |
| `apps/web/src/i18n/es.ts`, `en.ts` | `guide.*`, `help.*`, `rules.*`, `compendium.*` |
| `apps/web/test/storage.test.ts`, `render.test.tsx` | Tests |

---

### Task 1: Guide-seen storage helper + `GuideDialog` + topbar `?` + auto-open

**Files:**
- Modify: `apps/web/src/state/storage.ts`
- Create: `apps/web/src/components/GuideDialog.tsx`
- Modify: `apps/web/src/App.tsx` (topbar, state, route stub for `/help` pointing to a placeholder until Task 2)
- Modify: `apps/web/src/i18n/es.ts`, `en.ts`
- Modify: `apps/web/src/styles/app.css`
- Test: `apps/web/test/storage.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // storage.ts
  export function hasSeenGuide(storage: StorageLike, accountId: string): boolean;
  export function markGuideSeen(storage: StorageLike, accountId: string): void;
  // GuideDialog.tsx
  export function GuideDialog(props: { role: 'gm' | 'player'; onClose: () => void }): JSX.Element;
  ```
- Keys: `guide.title`, `guide.step` (`{n} / {total}`), `guide.prev`, `guide.next`, `guide.done`, `guide.openHelp`, `guide.gm.<1..5>.title|body`, `guide.player.<1..4>.title|body`, `help.open`.

- [ ] **Step 1: Failing storage test**

Append to `apps/web/test/storage.test.ts` (it already has a `fakeStorage()` helper — check its name with `grep -n "function fake" apps/web/test/storage.test.ts` and use that):

```ts
describe('guide seen flag', () => {
  it('is false until marked, then true, per account', () => {
    const storage = fakeStorage();
    expect(hasSeenGuide(storage, 'u1')).toBe(false);
    markGuideSeen(storage, 'u1');
    expect(hasSeenGuide(storage, 'u1')).toBe(true);
    expect(hasSeenGuide(storage, 'u2')).toBe(false);
  });

  it('treats a throwing storage as not seen and does not throw on write', () => {
    const broken: StorageLike = {
      getItem: () => { throw new Error('nope'); },
      setItem: () => { throw new Error('nope'); },
      removeItem: () => {},
    };
    expect(hasSeenGuide(broken, 'u1')).toBe(false);
    expect(() => markGuideSeen(broken, 'u1')).not.toThrow();
  });
});
```

Add `hasSeenGuide`, `markGuideSeen`, `type StorageLike` to the file's import from `../src/state/storage.js`.

- [ ] **Step 2: Run, expect failure** — `pnpm -F @daggerheart/web test storage` → FAIL (not exported).

- [ ] **Step 3: Implement the helper** — append to `storage.ts`:

```ts
const guideSeenKey = (accountId: string): string => `${KEY_PREFIX}:guide-seen:${accountId}`;

/** True once this account has closed the first-run guide on this device. */
export function hasSeenGuide(storage: StorageLike, accountId: string): boolean {
  try {
    return storage.getItem(guideSeenKey(accountId)) === '1';
  } catch {
    return false;
  }
}

export function markGuideSeen(storage: StorageLike, accountId: string): void {
  try {
    storage.setItem(guideSeenKey(accountId), '1');
  } catch {
    // Private mode or quota: the guide will simply show again next time.
  }
}
```

- [ ] **Step 4: Run, expect pass** — `pnpm -F @daggerheart/web test storage`.

- [ ] **Step 5: Keys** — add to `es.ts` (then mirror in `en.ts`):

```ts
  // first-run guide
  'guide.title': 'Bienvenido a Dual VTT',
  'guide.step': '{n} / {total}',
  'guide.prev': 'Anterior',
  'guide.next': 'Siguiente',
  'guide.done': 'Entendido',
  'guide.openHelp': 'Ver la ayuda completa',
  'guide.gm.1.title': 'Crea una campaña',
  'guide.gm.1.body': 'Desde Inicio, crea una campaña. Tú eres el DJ; la sala vive en el servidor y se guarda sola.',
  'guide.gm.2.title': 'Añade jugadores',
  'guide.gm.2.body': 'En Jugadores creas cuentas con contraseña inicial. Luego, en la tarjeta de la campaña, los añades por nombre de usuario.',
  'guide.gm.3.title': 'Panel del DJ',
  'guide.gm.3.body': 'Miedo, foco, cuentas regresivas, adversarios y entornos. Todo lo que cambias se emite a la mesa al instante.',
  'guide.gm.4.title': 'Mapa táctico',
  'guide.gm.4.body': 'Sube una imagen, crea escenas, coloca fichas y revela niebla. Los jugadores solo ven la escena activa y lo revelado.',
  'guide.gm.5.title': 'Comparte la mesa',
  'guide.gm.5.body': 'Con "Generar enlace" abres un túnel público para jugar a distancia. Cambia el idioma con la bandera arriba a la derecha.',
  'guide.player.1.title': 'Entra a tu campaña',
  'guide.player.1.body': 'El DJ te añadió a una campaña; ábrela desde Inicio.',
  'guide.player.2.title': 'Crea tu personaje',
  'guide.player.2.body': 'Nueve pasos guiados: clase, linaje, comunidad, rasgos, equipo, trasfondo, experiencias, cartas y conexiones. Se guarda al final.',
  'guide.player.3.title': 'Tu hoja',
  'guide.player.3.body': 'Marca daño, gasta Esperanza, gestiona Estrés y armadura, mueve cartas entre equipo activo y bóveda. Las tiradas las hace el servidor.',
  'guide.player.4.title': 'El mapa',
  'guide.player.4.body': 'Mueve tu ficha, mide distancias en rangos y sigue la escena que el DJ tiene activa.',
  'help.open': 'Ayuda',
```

English: natural equivalents (GM, Fear, spotlight, countdowns, Hope, Stress, vault/loadout, range bands, "Generate link").

- [ ] **Step 6: `GuideDialog.tsx`**

```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { t, type MessageKey } from '../i18n/index.js';
import { Dialog } from './Dialog.js';

const STEPS: Record<'gm' | 'player', readonly { title: MessageKey; body: MessageKey }[]> = {
  gm: [1, 2, 3, 4, 5].map((n) => ({
    title: `guide.gm.${n}.title` as MessageKey,
    body: `guide.gm.${n}.body` as MessageKey,
  })),
  player: [1, 2, 3, 4].map((n) => ({
    title: `guide.player.${n}.title` as MessageKey,
    body: `guide.player.${n}.body` as MessageKey,
  })),
};

/** First-run walkthrough. Steps are static keys; the text follows the active locale. */
export function GuideDialog({ role, onClose }: { role: 'gm' | 'player'; onClose: () => void }) {
  const steps = STEPS[role];
  const [index, setIndex] = useState(0);
  const step = steps[index];
  if (step === undefined) return null;
  const last = index === steps.length - 1;

  return (
    <Dialog title={t('guide.title')} onClose={onClose}>
      <div className="guide-steps">
        <p className="muted">{t('guide.step', { n: index + 1, total: steps.length })}</p>
        <h3>{t(step.title)}</h3>
        <p>{t(step.body)}</p>
        <div className="row">
          <button type="button" onClick={() => setIndex(index - 1)} disabled={index === 0}>
            {t('guide.prev')}
          </button>
          {last ? (
            <>
              <Link to="/help" onClick={onClose}>
                <button type="button">{t('guide.openHelp')}</button>
              </Link>
              <button type="button" onClick={onClose}>{t('guide.done')}</button>
            </>
          ) : (
            <button type="button" onClick={() => setIndex(index + 1)}>{t('guide.next')}</button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
```

If `MessageKey` rejects the template-literal casts, keep the `as MessageKey`; they are the same pattern `describeEffect` uses. Check the class name the app already uses for a horizontal button row (`grep -n "className=\"row\|className=\"actions" apps/web/src/components/sheet/*.tsx | head -3`) and use that instead of `row` if it differs.

- [ ] **Step 7: Wire into `App.tsx`**

Inside `Shell` after `account` is known (below the `mustChangePassword` early return):

```tsx
const [guideOpen, setGuideOpen] = useState(() => !hasSeenGuide(storage, account.id));
const closeGuide = () => {
  markGuideSeen(storage, account.id);
  setGuideOpen(false);
};
```

(`useState` lazy initializer runs once per mount; the tree remounts per locale, but `hasSeenGuide` is then already true.) Render `{guideOpen ? <GuideDialog role={account.role} onClose={closeGuide} /> : null}` next to the existing `<Toast>`s.

Topbar: before `<LocaleToggle />` add

```tsx
<Link to="/help">
  <button type="button" aria-label={t('help.open')}>?</button>
</Link>
```

Route stub so the link works before Task 2: `<Route path="/help" element={<section><h1>{t('help.open')}</h1></section>} />` placed before the `*` route. Task 2 replaces it.

- [ ] **Step 8: CSS** — in `app.css` near `.dialog`: `.guide-steps h3 { margin: 0.5rem 0; } .guide-steps .row { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1rem; }` (adjust the row class to what Step 6 chose).

- [ ] **Step 9: Gate** — `pnpm -F @daggerheart/web typecheck && pnpm -F @daggerheart/web test`. If `render.test.tsx` renders `Shell`/`App` and now hits `GuideDialog`, its fake storage must return `'1'` for the guide key or the test asserts the dialog — pick whichever the test intends and say so in the report.

- [ ] **Step 10: Commit** — `feat(web): first-run guide dialog and help button`.

---

### Task 2: `/help` route — tabs, hash sync, filter, app-guide sections

**Files:**
- Create: `apps/web/src/routes/HelpRoute.tsx`
- Modify: `apps/web/src/App.tsx` (replace stub route)
- Modify: `es.ts`, `en.ts`, `app.css`
- Test: `apps/web/test/render.test.tsx`

**Interfaces:**
- Produces: `export function HelpRoute(): JSX.Element` reading `useLocation().hash`; tab ids `'app' | 'rules' | 'compendium'`. Exposes for Task 3/4 a `Section` sub-component: `function Section({ title, body }: { title: MessageKey; body: MessageKey; filter: string })`.
- Keys: `help.title`, `help.tab.app|rules|compendium`, `help.filterPlaceholder`, `help.noMatches`, `help.quickGuide`, `help.app.<key>.title|body` for keys `start, campaigns, creation, sheet, gm, map, rolls, faq`.

- [ ] **Step 1: Failing render test** — in `render.test.tsx`:

```ts
import { HelpRoute } from '../src/routes/HelpRoute.js';

describe('HelpRoute', () => {
  it('renders the three tabs and the app-guide sections', () => {
    const html = render(<HelpRoute />, '/help#app');
    expect(html).toContain(t('help.tab.app'));
    expect(html).toContain(t('help.tab.rules'));
    expect(html).toContain(t('help.tab.compendium'));
    expect(html).toContain(t('help.app.start.title'));
    expect(html).toContain(t('help.app.faq.title'));
  });
});
```

Check the file's `render(element, path?)` helper signature (line ~30) and pass the path the way it expects.

- [ ] **Step 2: Run, expect failure** — module not found.

- [ ] **Step 3: Implement `HelpRoute.tsx`**

```tsx
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { t, type MessageKey } from '../i18n/index.js';

export type HelpTab = 'app' | 'rules' | 'compendium';
const TABS: readonly HelpTab[] = ['app', 'rules', 'compendium'];

const APP_SECTIONS = ['start', 'campaigns', 'creation', 'sheet', 'gm', 'map', 'rolls', 'faq'] as const;

/** Parses `#<tab>[/rest]`; anything unknown falls back to the app guide. */
export function parseHelpHash(hash: string): { tab: HelpTab; rest: string[] } {
  const [head = '', ...rest] = hash.replace(/^#/, '').split('/');
  const tab = (TABS as readonly string[]).includes(head) ? (head as HelpTab) : 'app';
  return { tab, rest };
}

/** A collapsible section that hides itself when the filter matches neither title nor body. */
export function Section({ title, body, filter }: { title: MessageKey; body: MessageKey; filter: string }) {
  const heading = t(title);
  const text = t(body);
  const needle = filter.trim().toLowerCase();
  if (needle !== '' && !`${heading} ${text}`.toLowerCase().includes(needle)) return null;
  return (
    <details open={needle !== ''}>
      <summary>{heading}</summary>
      <p className="card-text">{text}</p>
    </details>
  );
}

export function HelpRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  const { tab } = parseHelpHash(location.hash);
  const [filter, setFilter] = useState('');

  return (
    <section className="help">
      <h1>{t('help.title')}</h1>
      <div className="help-tabs" role="tablist">
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => navigate(`/help#${id}`)}
          >
            {t(`help.tab.${id}` as MessageKey)}
          </button>
        ))}
      </div>

      {tab !== 'compendium' ? (
        <input
          className="help-filter"
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t('help.filterPlaceholder')}
          aria-label={t('help.filterPlaceholder')}
        />
      ) : null}

      {tab === 'app' ? (
        <div className="help-sections">
          {APP_SECTIONS.map((key) => (
            <Section
              key={key}
              title={`help.app.${key}.title` as MessageKey}
              body={`help.app.${key}.body` as MessageKey}
              filter={filter}
            />
          ))}
        </div>
      ) : null}

      {tab === 'rules' ? <p className="muted">{t('help.tab.rules')}</p> : null}
      {tab === 'compendium' ? <p className="muted">{t('help.tab.compendium')}</p> : null}
    </section>
  );
}
```

Tasks 3 and 4 replace the two placeholder paragraphs.

- [ ] **Step 4: Content** — author the 8 `help.app.*` sections in `es.ts`, then `en.ts`. Each body: 3-6 sentences, plain prose, one paragraph. Required content per section:
  - `start`: two audiences; the GM creates everything, players join; the flag toggles language; where the `?` is.
  - `campaigns`: create campaign, create player accounts (initial password, forced change), add members, "Generate link" tunnel, players see only their campaigns.
  - `creation`: the nine steps in order and that the draft autosaves per campaign in the browser; finishing claims the character into the campaign.
  - `sheet`: damage dialog → thresholds → HP; Hope gain/spend; Stress and Vulnerable; armor slots; loadout/vault and recall cost; level up; death move when the last HP is marked; the printable sheet.
  - `gm`: Fear track, spotlight, countdowns, adding adversaries/environments from the SRD list, presence, shared roll log; only the GM may change these.
  - `map`: scenes and the active scene, upload image (validated), tokens (PC / adversary), fog reveal, walls & vision, grid toggle and range bands, measure tool; players never receive hidden tokens or unrevealed fog.
  - `rolls`: duality roll (Hope die vs Fear die), the five outcomes, why the server rolls (seeded, auditable), the shared log, damage rolls with Proficiency.
  - `faq`: works offline for the sheet? (creation drafts and locale live in this browser; a campaign needs the server); where data lives (`.data/` on the server, browser storage on devices); how to change language; why a player can't edit another's character; what "unofficial" means (DPCGL).

- [ ] **Step 5: Wire route + CSS** — replace the Task 1 stub: `<Route path="/help" element={<HelpRoute />} />`. CSS: `.help-tabs { display:flex; gap:.5rem; margin-bottom:1rem } .help-tabs [aria-selected="true"] { /* match the app's active-button look; grep .topbar button or .badge for the accent variables */ } .help-filter { width:100%; margin-bottom:1rem } .help-sections details { margin-bottom:.5rem }`.

- [ ] **Step 6: Gate + commit** — `feat(web): help route with app guide sections`.

---

### Task 3: Rules primer tab

**Files:** `HelpRoute.tsx`, `es.ts`, `en.ts`, `render.test.tsx`.

**Interfaces:** keys `help.rules.<key>.title|body` for keys `duality, hope, fear, stress, damage, armor, rests, death, conditions, ranges, cards, levelUp`; `help.attribution` is NOT a new key — reuse `sheet.print.footer`.

- [ ] **Step 1: Failing test** — add to the `HelpRoute` describe: render `/help#rules`, expect `t('help.rules.duality.title')`, `t('help.rules.levelUp.title')`, and `t('sheet.print.footer')` present.

- [ ] **Step 2: Implement** — in `HelpRoute.tsx` add `const RULE_SECTIONS = ['duality','hope','fear','stress','damage','armor','rests','death','conditions','ranges','cards','levelUp'] as const;` and replace the rules placeholder with the same `Section` map over `help.rules.*`, followed by `<p className="muted">{t('sheet.print.footer')}</p>`.

- [ ] **Step 3: Content** — author 12 sections, es then en. Each body one paragraph ending with the SRD page reference in parentheses, e.g. "(SRD p. 36)". Required facts (SRD 9-09-25 pages as used in code comments across the repo):
  - `duality`: 2d12 Hope + Fear + modifiers vs Difficulty; success/failure; with Hope/with Fear by which die is higher; matching dice = critical success (auto success, clear a Stress, gain a Hope) (p.36).
  - `hope`: max 6; gained on rolls with Hope; spent on Experiences (1 each), Help an Ally, class Hope feature (3), tag team; start with 2.
  - `fear`: GM resource, max 12, gained on rolls with Fear; spent to interrupt, activate Fear features, add adversaries to the spotlight.
  - `stress`: mark when required; all marked → Vulnerable; must mark Stress but can't → mark 1 HP instead (p.39).
  - `damage`: compare to thresholds: below Major = 1 HP, Major = 2, Severe = 3; thresholds = armor base + level (p.40, p.56).
  - `armor`: Armor Score = slots; mark one to reduce damage one threshold step; direct damage ignores armor (p.40).
  - `rests`: short vs long, downtime moves (clear HP/Stress, repair armor, prepare), recall cards for free during a rest (p.9, p.42-43).
  - `death`: last HP marked → death move: Blaze of Glory, Avoid Death (scar), Risk It All (p.42).
  - `conditions`: Hidden, Restrained, Vulnerable — what each does (p.41).
  - `ranges`: Melee / Very Close / Close / Far / Very Far and the optional 1-inch grid equivalents (p.35).
  - `cards`: loadout max 5, vault, Recall Cost in Stress outside a rest, level cap on cards, grimoires (p.8-9).
  - `levelUp`: tiers 1 / 2-4 / 5-7 / 8-10; two advancements per level; tier achievements (Experience, Proficiency, clear marked traits); multiclass from level 5 (p.10-11).
  Where the codebase already encodes a rule (`packages/rules/src/*.ts` comments cite pages), match those numbers; do not invent values.

- [ ] **Step 4: Gate + commit** — `feat(web): rules primer in help`.

---

### Task 4: Compendium

**Files:**
- Create: `apps/web/src/components/help/Compendium.tsx`, `apps/web/src/components/help/details.tsx`
- Modify: `HelpRoute.tsx` (mount + pass `rest`), `es.ts`, `en.ts`, `app.css`
- Test: `render.test.tsx`

**Interfaces:**
- `Compendium({ path, onNavigate }: { path: string[]; onNavigate: (collection: CollectionKey, id: string | null) => void })` where `path` is the hash `rest` from `parseHelpHash` (`[collection?, id?]`) and `onNavigate` writes `/help#compendium/<collection>/<id>`.
- `type CollectionKey = keyof SrdData` (13 keys from `@daggerheart/srd-data`).
- `details.tsx` exports `EntryDetail({ collection, id, onNavigate })` which finds the entry in `srd()[collection]` and dispatches to a per-shape renderer; returns `null` when not found.
- Keys: `compendium.collection.<key>` ×13, `compendium.filterPlaceholder`, `compendium.results` (`{n}`), `compendium.tooMany`, `compendium.empty`, `compendium.pick`, field labels `compendium.field.tier|level|domain|type|recallCost|difficulty|thresholds|hp|stress|attack|range|damage|burden|trait|evasion|baseScore|features|hopeFeature|foundation|specialization|mastery|classItems|startingEvasion|startingHP|domains|subclasses|classes|cards|experiences|motives|impulses|potentialAdversaries|examples|advantages|roll|fear`, adversary types `compendium.adversaryType.<type>` ×10, environment types ×4, card types ×3, weapon category ×2, burden `compendium.burden.oneHanded|twoHanded` (check `BurdenSchema` values in `schemas.ts`), feature types `compendium.featureType.action|reaction|passive`. Range bands reuse existing `range.*`; traits reuse existing `trait.*`; damage types reuse `damageType.*`.

- [ ] **Step 1: Failing tests**

```ts
describe('Compendium', () => {
  it('deep-links to an adversary and follows the locale', () => {
    setLocale('es');
    expect(render(<HelpRoute />, '/help#compendium/adversaries/acid-burrower')).toContain('Excavador Ácido');
    setLocale('en');
    expect(render(<HelpRoute />, '/help#compendium/adversaries/acid-burrower')).toContain('Acid Burrower');
  });
  it('falls back to the default collection on an unknown deep link', () => {
    const html = render(<HelpRoute />, '/help#compendium/nope/nothing');
    expect(html).toContain(t('compendium.collection.classes'));
    expect(html).not.toContain('Excavador');
  });
});
```

Import `setLocale` from `../src/i18n/index.js`; add `afterEach(() => setLocale('es'))` (the file may already have one from the previous plan — check).

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: `Compendium.tsx`**

```tsx
import { srd, type SrdData } from '@daggerheart/srd-data';
import { useState } from 'react';

import { t, type MessageKey } from '../../i18n/index.js';
import { EntryDetail } from './details.js';

export type CollectionKey = keyof SrdData;
export const COLLECTIONS: readonly CollectionKey[] = [
  'classes', 'subclasses', 'ancestries', 'communities', 'domains', 'domainCards',
  'weapons', 'armor', 'adversaries', 'environments', 'loot', 'consumables', 'beastforms',
];
const MAX_RESULTS = 100;

const isCollection = (value: string | undefined): value is CollectionKey =>
  value !== undefined && (COLLECTIONS as readonly string[]).includes(value);

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

export function Compendium({ path, onNavigate }: { path: string[]; onNavigate: (c: CollectionKey, id: string | null) => void }) {
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
            <option key={key} value={key}>{t(`compendium.collection.${key}` as MessageKey)}</option>
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
          {matches.length > MAX_RESULTS ? <li className="muted">{t('compendium.tooMany', { n: matches.length })}</li> : null}
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
```

The `as readonly SrdData[CollectionKey][number][]` cast is needed because indexing a union of array types loses the element union; `haystack`/`metaLine` narrow with `in` checks. If TS still complains about `.filter` on the union, keep the cast on `entries` (it is a widening cast, safe).

- [ ] **Step 4: `details.tsx`** — one exported `EntryDetail` plus private renderers. Skeleton (fill every renderer; the pattern is the same):

```tsx
import { formatDice, srd, type Adversary, type Armor, type Beastform, type CharacterClass, type Community, type Domain, type DomainCard, type Environment, type Item, type Subclass, type Weapon, type Ancestry } from '@daggerheart/srd-data';

import { t, type MessageKey } from '../../i18n/index.js';
import type { CollectionKey } from './Compendium.js';

type Nav = (c: CollectionKey, id: string | null) => void;

function Field({ label, children }: { label: MessageKey; children: React.ReactNode }) {
  return (
    <div className="compendium-field">
      <dt>{t(label)}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function FeatureList({ features }: { features: readonly { name: string; text: string; type?: 'action' | 'reaction' | 'passive'; costsFear?: boolean }[] }) {
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
  return <button type="button" className="link" onClick={() => nav(to, id)}>{label}</button>;
}

function ClassDetail({ e, nav }: { e: CharacterClass; nav: Nav }) {
  const subs = srd().subclasses.filter((s) => e.subclasses.includes(s.id));
  const domains = srd().domains.filter((d) => e.domains.includes(d.id));
  return (
    <dl>
      <Field label="compendium.field.startingEvasion">{e.startingEvasion}</Field>
      <Field label="compendium.field.startingHP">{e.startingHP}</Field>
      <Field label="compendium.field.classItems">{e.classItems}</Field>
      <Field label="compendium.field.domains">{domains.map((d) => <LinkButton key={d.id} to="domains" id={d.id} label={d.name} nav={nav} />)}</Field>
      <Field label="compendium.field.subclasses">{subs.map((s) => <LinkButton key={s.id} to="subclasses" id={s.id} label={s.name} nav={nav} />)}</Field>
      <Field label="compendium.field.hopeFeature"><FeatureList features={[e.hopeFeature]} /></Field>
      <Field label="compendium.field.features"><FeatureList features={e.features} /></Field>
    </dl>
  );
}
// SubclassDetail: spellcastTrait (t(`trait.${x}`) or —), foundation/specialization/mastery FeatureLists, link to class.
// AncestryDetail, CommunityDetail: FeatureList (community has a single `feature` → wrap in array).
// DomainDetail: text, classes (links), cards (links to domainCards filtered by domain, sorted by level).
// DomainCardDetail: domain (link), level, type (t compendium.cardType.*), recallCost, text.
// WeaponDetail: tier, category, trait (t trait.*), range (t range.*), damage `${formatDice(e.damage)} ${t(`damageType.${e.damageType}`)}`, burden, feature (FeatureList or —).
// ArmorDetail: tier, baseScore, thresholds `${major} / ${severe}`, feature.
// AdversaryDetail: tier, type, difficulty, thresholds (`—` when null; severe `—` when null), hp, stress, attack: `${name} · ${t(range)} · ${damage.count}${damage.die ? 'd'+damage.die : ''}${formatModifier(damage.modifier)} ${t(damageType)}${direct ? ' · direct' : ''}` plus attackModifier flat/roll; description; motives; experiences `name +N`; FeatureList (typed, Fear badge).
// EnvironmentDetail: tier, type, difficulty (number or t('compendium.field.difficultySpecial')), description, impulses, potentialAdversaries (plain text — it's prose in the data), FeatureList.
// ItemDetail (loot & consumables): roll, text.
// BeastformDetail: tier, examples, trait+traitBonus, evasionBonus, attack (like weapon), advantages joined ', ', FeatureList. Null fields render '—'.

export function EntryDetail({ collection, id, onNavigate }: { collection: CollectionKey; id: string; onNavigate: Nav }) {
  const entry = (srd()[collection] as readonly { id: string; name: string }[]).find((e) => e.id === id);
  if (entry === undefined) return <p className="muted">{t('compendium.empty')}</p>;
  return (
    <article className="compendium-entry">
      <h2>{entry.name}</h2>
      {collection === 'classes' ? <ClassDetail e={entry as CharacterClass} nav={onNavigate} /> : null}
      {/* … one line per collection, casting `entry` to the collection's type … */}
    </article>
  );
}
```

The casts in `EntryDetail` are justified: `collection` selects which array `entry` came from. Use `formatModifier` from srd-data for `+N`. Check `BurdenSchema` and `WeaponTraitSchema` enum values in `schemas.ts`/`core.ts` before writing the `compendium.burden.*` keys and the trait lookup (weapon `trait` may include `'spellcast'`; add `trait.spellcast` if missing).

- [ ] **Step 5: Mount in `HelpRoute.tsx`**

Replace the compendium placeholder:

```tsx
{tab === 'compendium' ? (
  <Compendium
    path={rest}
    onNavigate={(collection, id) => navigate(`/help#compendium/${collection}${id === null ? '' : `/${id}`}`)}
  />
) : null}
```

and destructure `rest` from `parseHelpHash`.

- [ ] **Step 6: Keys** — add every `compendium.*` key listed in Interfaces to `es.ts` then `en.ts`. Collection labels es: Clases, Subclases, Linajes, Comunidades, Dominios, Cartas de dominio, Armas, Armaduras, Adversarios, Entornos, Botín, Consumibles, Formas bestiales. Adversary types es: Bruto, Horda, Líder, Esbirro, A distancia, Acechador, Social, Solitario, Estándar, Apoyo. Environment types: Evento, Exploración, Social, Travesía. Card types: Habilidad, Conjuro, Grimorio. Feature types: Acción, Reacción, Pasiva.

- [ ] **Step 7: CSS** — `.compendium-controls { display:flex; gap:.5rem; margin-bottom:1rem } .compendium-body { display:grid; grid-template-columns: minmax(12rem, 1fr) 2fr; gap:1rem } @media (max-width: 700px) { .compendium-body { grid-template-columns: 1fr } } .compendium-list { list-style:none; padding:0; margin:0; max-height: 60vh; overflow:auto } .compendium-list button { width:100%; text-align:left; display:flex; flex-direction:column } .compendium-field { display:grid; grid-template-columns: 10rem 1fr; gap:.5rem; margin-bottom:.5rem } button.link { background:none; border:none; padding:0; color: inherit; text-decoration: underline; cursor:pointer }` — reuse the app's existing colour variables for the pressed state.

- [ ] **Step 8: Gate + commit** — `feat(web): SRD compendium in help`.

---

### Task 5: Docs + full gate

- [ ] README Notes bullet: "Help lives at `/help`: an app guide, a short rules primer (hand-written, with SRD page references), and a compendium that browses the bundled SRD data in the active language. A first-run guide opens once per account per device."
- [ ] CLAUDE.md `web` bullet, one sentence: "`/help` renders help text from the dictionaries and the compendium straight from `srd()`; there is no separate help data file."
- [ ] `pnpm typecheck && pnpm test && pnpm validate` green.
- [ ] Manual: `pnpm dev`, log in as `gm`, guide opens; close; `?` → three tabs; compendium deep link `#compendium/adversaries/acid-burrower`; toggle flag → everything switches.
- [ ] Commit `docs: help module and compendium`.

---

## Self-review

- Spec §1 → Task 1; §2 → Tasks 2-3; §3 → Task 4; §4 keys → Tasks 1-4; error handling (unknown hash, throwing storage, missing related entry) → Task 4 `isCollection` fallback + `find` → `null`, Task 1 try/catch, `LinkButton` only rendered from `filter` results; testing → each task's Step 1; docs → Task 5.
- Type names: `CollectionKey`, `Compendium`, `EntryDetail`, `parseHelpHash`, `Section`, `HelpTab`, `hasSeenGuide`, `markGuideSeen`, `GuideDialog` consistent across tasks.
- Deviation: the spec's "quick guide" button on `/help` is dropped — the topbar `?` already reaches `/help`, and reopening the guide is available by clearing the seen flag only; if wanted, Task 2 may add a "Quick guide" button that renders `GuideDialog` locally (one `useState`). Ruling left to the executor: add it if under 10 lines.
