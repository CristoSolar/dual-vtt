# Onboarding guide, help module, rules primer, and SRD compendium

Date: 2026-09-15

## Goal

A new user learns the app without being told; anyone at the table can look up how a
feature works, how a core rule works, and any SRD entry (class, card, adversary,
weapon, …) in the active language, from inside the app.

## Decisions

- **Web-only.** No package changes, no protocol changes, no server changes, no new
  dependency. Content lives in the i18n dictionaries; SRD entries come from `srd()`.
- **Pop-up guide, not a spotlight tour.** Positioned tooltips over live elements need
  selectors, positioning, and fallbacks for elements that don't exist yet (a GM with
  no campaign has no map). A stepped dialog covers the need at a tenth of the code.
- **Rules primer is hand-written**, short, and bilingual. The SRD's rules prose is not
  in `srd-data`; extracting it from the PDF is a separate project. The primer cites
  SRD pages so the reader can go deeper.
- **Compendium renders existing data as-is.** No new fields, no editorial text. It is a
  browser over the 13 datasets `srd()` already exposes.
- Attribution: every rules/compendium view carries the Darrington Press Community
  Gaming License line already used on the printable sheet (`sheet.print.footer`).

## Non-goals

- Full SRD rules text. Spotlight/tour UI. Search across rules prose (only the
  compendium and the help sections are searchable). Persisting "read" state per
  section. Offline-caching anything new (everything is already bundled).

## Architecture

### 1. `GuideDialog` — first-run pop-up

`apps/web/src/components/GuideDialog.tsx`, built on the existing `Dialog`.

- Props: `role: 'gm' | 'player'`, `onClose()`.
- Steps: an array of `{ titleKey, bodyKey }` per role, 5 for GM (create campaign →
  add players → GM panel → map → share link) and 4 for players (join → create
  character → sheet → map). Step counter "2 / 5", buttons ◀ ▶, last step shows
  "Open the full help" (`Link to="/help"`) and "Got it".
- Opens automatically once per account per device: key
  `daggerheart-vtt:guide-seen:<accountId>` in `localStorage` (via a small helper in
  `state/storage.ts` following its existing `StorageLike` pattern, read/write wrapped
  in try/catch). Never opens on the login/change-password screens.
- Reopen: the `?` topbar button's menu has "Show the quick guide again"; simplest form
  is that `?` navigates to `/help`, and `/help` has a "Quick guide" button that opens
  the dialog. That avoids a menu component.

### 2. `/help` route — `HelpRoute.tsx`

`apps/web/src/routes/HelpRoute.tsx`, reachable for any signed-in account, in or out
of a campaign. Topbar gets a `?` button (`aria-label` = `help.open`) before the locale
toggle.

Three tabs (plain buttons with `aria-pressed`, tab state in `useState`; tab also
mirrored to the URL hash `#app`, `#rules`, `#compendium` so links can deep-link):

**App guide** — a text filter `<input>` + eight `<details>` sections. Filter matches
against the section's title and body text (lower-cased `includes`); non-matching
sections are hidden. Sections: getting started (GM / player), campaigns & players,
character creation, character sheet, GM panel, map, rolls, FAQ.

**Rules** — the primer. Twelve `<details>` sections: duality roll & outcomes, Hope,
Fear, Stress, damage & thresholds, armor, rests, death moves, conditions, range
bands, domain cards & recall, levelling up. Each ~1 paragraph plus an "SRD p. N"
reference. Same text filter as the app guide. Attribution line at the bottom.

**Compendium** — see §3.

### 3. Compendium

`apps/web/src/components/help/Compendium.tsx` plus one detail renderer per shape.

- A `<select>` of the 13 collections (labels from `compendium.collection.<key>`), a
  text filter, a result list (`name` plus one line of metadata: tier / level /
  domain / type), and a detail pane for the selected entry.
- Filtering: `name` and, when present, `text`/`description`/feature texts,
  lower-cased `includes`. Results capped at 100 with a "narrow your search" line.
- Detail renderers, one per dataset shape, chosen by collection key:
  - `classes`, `subclasses`, `ancestries`, `communities`, `domains`: name, then
    features as `<dl>` (name → text), and links (as buttons that switch collection
    and selection) to related entries: class → its subclasses and domains; subclass
    → its class; domain → its classes and its cards.
  - `domainCards`: domain, level, recall cost, type, text.
  - `weapons`: tier, category, trait, range, damage (`formatDice`), burden, feature.
  - `armor`: tier, base score, thresholds, feature.
  - `adversaries`: tier, type, difficulty, thresholds, HP, Stress, attack, features
    grouped by type with a Fear badge, experiences, motives.
  - `environments`: tier, type, difficulty, impulses, features, potential adversaries
    (linked).
  - `loot`, `consumables`: roll, text.
  - `beastforms`: tier, trait bonus, evasion bonus, attack, advantages, features,
    examples.
- Everything reads `srd()` at render; a locale switch remounts the tree (existing
  behaviour) so the compendium follows the language with no extra wiring. Selection
  is by `id`, which is identical across locales, so the selected entry survives a
  switch when the route is re-entered with the same hash.
- Deep link: `#compendium/<collection>/<id>` so a GM can paste a link to an adversary
  in chat. Parsed once on mount; written on selection.

### 4. Dictionaries

New key areas in `es.ts`/`en.ts`: `guide.*` (steps), `help.*` (tabs, sections,
filter, attribution), `rules.*` (primer), `compendium.*` (collection labels, field
labels, empty states). Roughly 150 keys. Spanish is authored first (source of keys),
English second. Rules terminology follows the Spanish SRD data (Esperanza, Miedo,
Estrés, Puntos de Vida, Umbrales, Bóveda, Costo de Recuperación).

## Data flow

```
login → App sees account → GuideDialog if !guideSeen(accountId) → user closes → mark seen
topbar ? → /help#app  |  GuideDialog last step → /help
/help#compendium/adversaries/acid-burrower → Compendium(select=adversaries, id=acid-burrower) → srd().adversaries.find(id)
```

## Error handling

- Unknown hash collection/id → compendium opens with the default collection and no
  selection; no throw.
- `localStorage` unavailable → the guide shows every login; nothing else breaks.
- Missing related entry (bad id in data) → the link is simply not rendered.

## Testing

- `render.test.tsx` (existing static-render harness): `HelpRoute` renders all three
  tabs' headings; compendium deep link selects the right entry and renders its name in
  both locales; unknown deep link falls back cleanly.
- `storage.test.ts`: guide-seen helper round-trips and tolerates a throwing storage.
- `i18n.test.ts` already enforces key and placeholder parity — new keys are covered.
- Typecheck gates the `MessageKey` maps used for section/collection labels.
