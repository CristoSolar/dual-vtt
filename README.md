# Daggerheart VTT

Self-hosted VTT for running Daggerheart at my own table. Create a character through
the SRD's nine steps, play off an interactive sheet, run a live campaign room with a
GM panel, and fight over a synced tactical map. Works fully offline too.

## Packages

| Package | What it is |
|---|---|
| `packages/srd-data` | SRD content as typed JSON, one Zod schema per file |
| `packages/rules` | Pure rules functions over that data — no I/O, no global state |
| `packages/character` | Headless 9-step character creation reducer |
| `packages/protocol` | Shared wire types and the pure reducers the server and client both run |
| `apps/server` | Node + Socket.io campaign rooms, authoritative state, JSON snapshots |
| `apps/web` | React app: creation wizard, character sheet, GM panel, tactical map |

## Commands

```sh
pnpm install
pnpm dev         # server (:4000) and web (:5173) together
pnpm dev:web     # web only — the app works with the server stopped
pnpm build       # typecheck + production bundle
pnpm typecheck   # tsc, strict, across every package
pnpm test        # vitest
pnpm validate    # parse every JSON against its schema; fails the build on mismatch
```

Requires Node 20+ and pnpm.

## Notes

- Every rules function takes an injectable `rng: () => number`, so tests are
  deterministic and nothing reads global state. `seededRng` and `scriptedRng` are
  provided for that.
- Dice are structured (`{ count: 1, die: 8, modifier: 3 }`), never strings.
  `formatDice` renders them for display.
- Rules text is stored verbatim from the SRD, including its own typos.
- `packages/srd-data/extract/` holds the scripts that generated the JSON from the
  PDF; see the README there to re-derive it.
- The web app holds no game logic: components render state and dispatch actions,
  while every rule lives in `rules` or `character`. State transitions are pure
  functions in `apps/web/src/state`, so they can later be replayed over a socket.
- The app is bilingual (English / Spanish). The choice is per device, stored in
  `localStorage`, and applies to UI text and SRD content alike. SRD data ships in
  both languages under `packages/srd-data/data/{en,es}` with identical ids; the web
  reads it through `srd()`, which follows the active locale.
- Characters and in-progress creations are saved to `localStorage`, and the sheet
  works with the server stopped. A campaign is opt-in.
- In a campaign the **server is authoritative**: clients send intents, never results.
  A client asks to `takeDamage`; the server computes the HP with `applyDamage` and
  broadcasts it. Dice are rolled server-side from a per-room seed, so every roll is
  reproducible and auditable from the log.
- Permissions are enforced server-side: a player may only mutate their own character,
  and only the GM may touch Fear, spotlight, countdowns, adversaries, or the
  environment.
- Rooms live in memory and are snapshotted to `.data/rooms.json`; a lost snapshot
  costs the session's progress, not the characters, which live on each player's
  device.
- The map has no grid by default: distances are reported as Daggerheart's range
  bands (Melee / Very Close / Close / Far / Very Far), with the SRD's optional
  1-inch-grid rule available per scene. The band maths lives in
  `packages/protocol/src/ranges.ts` and is tested there, not in a canvas component.
- Players are sent only the active scene, without GM-only tokens, and fog is
  transmitted as the list of *revealed* cells — an unrevealed region never reaches a
  player's browser at all.
- Map images are uploaded to `.data/uploads` and validated by their magic bytes, not
  by the content type the browser claims.

## Licensing

Game content is from the Daggerheart System Reference Document, © 2025 Critical
Role LLC, used under the Darrington Press Community Gaming License. The SRD PDF
itself is not committed. This project is personal, non-commercial use.
