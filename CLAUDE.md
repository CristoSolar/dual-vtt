# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Read `README.md` first — it covers the package map, the design rules the code holds
itself to, and the licensing constraint on SRD content. This file covers what the
README does not: how to run one thing at a time, and the architecture invariants that
only show up after reading several packages.

## Commands

Root scripts fan out over the workspace with `pnpm -r`. To work on one package, use
`pnpm -F <name>`:

```sh
pnpm -F @daggerheart/rules test           # one package's suite
pnpm -F @daggerheart/rules test damage    # one file (vitest name filter)
pnpm -F @daggerheart/rules exec vitest    # watch mode
pnpm -F @daggerheart/protocol typecheck   # one package's tsc
pnpm -F @daggerheart/srd-data validate    # re-parse the JSON against the schemas
pnpm -F @daggerheart/server start         # server without watch
pnpm -F @daggerheart/server host          # build web same-origin, then serve app + API from :4000
pnpm -F @daggerheart/desktop start        # Electron app from source (builds web + bundle first)
pnpm -F @daggerheart/desktop dist         # installers for this OS into apps/desktop/dist
```

Package names: `@daggerheart/srd-data`, `rules`, `character`, `protocol`, `server`, `web`,
`desktop`.

There is no linter or formatter — `typecheck` under a strict tsconfig is the only
static gate. Do not add one unasked.

Server env vars (all optional, defaults in `apps/server/src/main.ts`): `PORT`,
`CAMPAIGNS_SNAPSHOT_PATH`, `CAMPAIGNS_SNAPSHOT_INTERVAL_MS`, `USERS_SNAPSHOT_PATH`,
`CHARACTERS_SNAPSHOT_PATH`,
`UPLOAD_DIR`, `WEB_DIST_DIR`, `GM_USERNAME` / `GM_PASSWORD` (first GM account, created
on boot), `ALLOWED_ORIGINS`. Web reads `VITE_SERVER_URL`; `host` sets it empty so the
app talks to its own origin. `/health` on the server reports campaign count.

## Layering

Dependencies run strictly one way; nothing imports upward.

```
srd-data  →  rules  →  character  →  protocol  →  server  →  desktop
                                              ↘  web
```

- **srd-data** — JSON plus Zod schemas, nothing else. `src/index.ts` parses every file
  at import time, so a malformed JSON fails the process rather than surfacing later.
  Data lives in `data/en` and `data/es` with identical ids. Adding a file means two
  JSON imports, one entry in `schemas`, one in `fileNames`, and the same key in both
  `raw` maps in `src/index.ts`. Consumers never import arrays; they call `srd()` at
  use time, which follows `setLocale`.
- **rules** — pure functions over that data. Every function that randomizes takes an
  injectable `rng: () => number`; nothing reads a clock or a global.
- **character** — the 9-step creation reducer. `applyChoice` never throws or coerces:
  an invalid choice lands in state and is reported by `validateStep`, and completion
  flags are recomputed from `validateStep` after every action so they cannot drift.
- **protocol** — wire schemas *and* the reducers both ends run. `applyRoomEvent` in
  `src/room.ts` is the single choke point where room state changes, permissions
  included; the server calls it, and the client calls the same sheet reducers
  underneath for its optimistic echo. New room behaviour goes here, not in the server.
  `auth.ts`, `campaign.ts` and `library.ts` hold the HTTP request/response schemas for
  accounts (incl. `ManagedPlayer`, a "Mis jugadores" row), campaign
  membership/invitations/status (`CampaignStatus`: `active | paused | finished`,
  `UpdateCampaignRequest`, `CampaignDetail`) and the character library — no
  `RoomState` travels over HTTP, only over the socket (a library entry carries a
  `SheetState`, never a room; `CampaignDetail` carries three GM slices — `story`,
  `prepAdversaries`, `journal` — never the room). `CampaignPrepEventSchema` is the
  subset of `RoomEvent` the GM's campaign page may send over HTTP (story, prep list —
  `addPrepAdversary` is additive, so quick repeated adds all count — and journal); it still goes through `applyRoomEvent`. `story` (`prep.ts`) and
  `prepAdversaries` are GM-only room slices, emptied by `roomForRole`.
  `claimCharacterInRoom` / `releaseCharacterInRoom` are how a sheet enters and leaves a
  room; linking from the library goes through them. Fear-on-new-PC is decided by the
  server (`CampaignRecord.partyIds`: once per account per campaign, so swapping
  characters adds none) and passed in as `isNewToTheParty`. There is no socket
  claim: the only way into a room is the library link, which refuses an occupied seat.
- **server** — transport only. `main.ts` only reads env vars and calls
  `startServer(options)` (`server.ts`), which restores the stores, wires the routes and
  the gateway, listens, and returns `{ port, close }`; `close()` is the shutdown path
  (tunnel stop + final snapshots + `io.close()`). The desktop app calls the same
  function with its own options. Two layers:
  - HTTP (`auth-http.ts`, `campaigns-http.ts`, `characters-http.ts`, `uploads.ts`,
    `tunnel-http.ts`, `static.ts`): login issues a token (`sessions.ts`, in-memory —
    restart signs everyone out, by design); GM creates player accounts and campaigns
    and invites players (`invitedIds`); a player accepts or declines, which is the only
    way to become a member. A GM manages the players it created (`createdBy`) and
    legacy ones (`createdBy: null`) that sit at one of its tables — member or invitee
    — or, on a single-GM server, at no table (`managed-players.ts`). `GET /users`,
    `GET /players` (`players-http.ts`), reset-password and invites see only those;
    another GM's player answers 404 like a missing one. A reset or invite claims a
    legacy player for that GM unless it also sits at another GM's table. The GM's campaign page uses
    `GET /campaigns/:id` (detail), `PATCH /campaigns/:id` (name/status) and
    `POST /campaigns/:id/prep` (one prep intent, broadcast to live sockets).
    `GET`/`POST /setup` (`setup-http.ts`) is the first-run door: only when
    `startServer` gets `firstRunSetup: true` (desktop) and no GM account exists, it
    creates the first GM (`SetupRequestSchema`, not flagged `mustChangePassword`) and
    returns a `LoginResponse`; loopback callers only, rate-limited, 409 once a GM exists.
    `pnpm start`/`host`/Docker pass `bootGm` from `GM_USERNAME`/`GM_PASSWORD` instead and
    keep `/setup` closed. The web shows `SetupRoute` while `GET /setup` says
    `needsSetup` (auth status `setup`). All are
    owner-only (403 otherwise, unknown id included). `/characters` is each account's own library (owner-only;
    someone else's id answers 404). HTTP routes that change a room get a `broadcast`
    callback (the gateway's `broadcastPatches`) so live sockets see the change.
  - Socket (`gateway.ts`): authenticates once at connect with that same token, then
    `joinCampaign` seats the socket after a membership check. The web client names its
    campaign in the handshake `auth` instead, so a reconnect is seated before socket.io
    flushes messages buffered while offline (otherwise they bounce with `noSeat`). Membership is re-checked
    on every message, so a removed player is cut off mid-session. Status too
    (`CampaignStore.mayEnter`): a paused or finished campaign seats only its GM;
    players get `campaignNotActive` at join and on their next message, and pausing
    over HTTP calls `unseatPlayers` so they are cut off at once.
  - `campaigns.ts` owns the in-memory store, ownership (`ownerId` is GM, `memberIds`
    are players, `invitedIds` are pending invitations, `status`), and the per-campaign
    dice seed. `users.ts` holds accounts with password hashes that never leave the
    server, plus `createdBy` and `lastLoginAt` (both null in old snapshots).
    `characters.ts` holds every account's character library. None contains game logic.
  - `library.ts` keeps library and rooms in agreement: a character is linked to at
    most one campaign, a player has at most one character per campaign (the room
    still keys characters by account id), and while linked **the room's sheet is the
    live one** — the library reads through to it (`liveSheet`) and unlinking, or the
    GM removing the member, writes it back. `adoptRoomCharacters` runs at boot: it
    files any room character with no library entry as a linked entry (that is the
    migration from before the library) — relinking an unlinked entry of the same
    character first, so a crash between the two snapshot writes cannot duplicate —
    and unlinks entries whose room no longer holds them. Idempotent.
  - `tunnel.ts` opens at most one Cloudflare quick tunnel for the whole server,
    triggered by the GM from the UI.
- **desktop** (`apps/desktop`) — Electron shell, no game logic. `src/main.ts` calls
  `startServer` in the main process: data under `app.getPath('userData')/data`, web
  build from `resources/web` (electron-builder `extraResources`), port 4000 or the next
  free (`net.ts`), host `0.0.0.0` for LAN players, `bootGm: null` + `firstRunSetup`,
  cloudflared downloaded to `userData/bin` (the asar is read-only). `before-quit` waits
  for `close()`. Sandboxed renderer, no preload, navigation pinned to the local origin.
  `scripts/bundle.mjs` (esbuild) bundles main + server + workspace packages into
  `out/main.cjs`, so the package ships no `node_modules`; keep server deps bundleable
  (no native modules). Config: `electron-builder.config.cjs` (version from the root
  `package.json`). CI: `.github/workflows/desktop.yml` on `v*` tags. The icon in
  `resources/` is a placeholder.
- **web** — renders and dispatches. No game logic; state transitions live in
  `apps/web/src/state` as pure functions. Routing is `HashRouter`, so the static
  server never sees app paths. UI text goes through `t()` from `apps/web/src/i18n`;
  `es.ts` is the source of keys and `en.ts` is typed against it. A player account lands
  on two doors, **Mis personajes** (`/characters`) and **Mis campañas** (`/campaigns`);
  a GM account lands on **Mis campañas** (`/campaigns`, tabs by status) and **Mis
  jugadores** (`/players`); `/campaigns/:id` is the GM's campaign page (Historia,
  Notas = the room journal, Monstruos = the prep list, Jugadores). The GM panel shows
  the prep list with "Añadir al encuentro" (`addAdversary`, via `encounterEvents`). The wizard (`/create/:step`) needs no
  campaign: its draft stays in `localStorage` (scope `library`) and finishing saves to
  the server library. `state/library.ts` also finds characters and drafts the old flow
  left in `localStorage` and offers a one-time import; imported keys are moved aside
  under `daggerheart-vtt:imported:`, never deleted. The tree remounts on
  locale switch (`key={locale}` in `main.tsx`). The remount also tears down and
  reopens the campaign socket, so a mid-session toggle briefly reconnects; nothing is
  lost because room state is server-authoritative. Switching locale mid-creation makes
  step 5 report `invalidClassItem` until the class item is re-picked, because the
  chosen item is stored as SRD text (see the spec's non-goals). `/help` renders help
  text from the dictionaries and the compendium straight from `srd()`; there is no
  separate help data file.

## Invariants worth knowing before editing

- **Two audiences, two payloads.** After each event the server diffs before/after with
  `roomPatch` twice — once raw for `campaign:<id>:gm`, once through `roomForRole(…,
  'player')` for `campaign:<id>:players`. `roomForRole` / `mapForPlayer` strip inactive
  scenes, GM-only tokens, and unrevealed fog *before* the send — a player's browser
  never receives them. Any new GM-only state must be filtered there too (as `tables`,
  `story` and `prepAdversaries` are — with a shared frozen empty value, so the player
  view stays reference-stable and an unrelated change is not a player patch).
- **Intents, not results.** A client sends `takeDamage { incoming }`; the server
  computes HP. Adding an event that carries a computed outcome breaks the model.
- **Rolls are server-side** from the campaign's seed plus `rollCount`
  (`rngForRoll` in `campaigns.ts`); the seed never leaves the process — this is what
  makes the log auditable.
- **Actor comes from the socket**, never a client field: `gateway.ts` resolves account
  from the connect-time token and role from campaign membership.
- **Room state is plain JSON**, no Maps or class instances, because it is broadcast and
  snapshotted as-is. Slices in `RoomStateSchema` are top-level and independent.
- **Trust boundaries stay validated**: `localStorage` reads
  (`apps/web/src/state/storage.ts`), every HTTP body and socket message (Zod schemas
  from `protocol`), and map uploads (checked by magic bytes, not the browser's content
  type). `POST /uploads/avatar` is the door any account may use for a character
  portrait: images only, 2 MB. A sheet's `avatar` (`protocol/src/avatar.ts`) names
  its picture by ancestry id, gallery id or `/uploads/<hex>` path — never a free URL.
- **Tokens are sized in grid cells.** `width`/`height` stay in map pixels, but the
  reducer keeps them at `cells × grid.size`: `setSceneGrid` refits every token
  (`refitTokensToGrid`), and a player's own token is one cell whatever it sent.
- **Characters live on the server, tied to the account.** Campaigns, users and the
  character library snapshot to `.data/` (`campaigns.json`, `users.json`,
  `characters.json`); losing `.data/` loses characters too. Only an unfinished wizard
  draft stays in the browser. A linked character's snapshot copy is taken from the
  room at write time, so the two files never disagree for long. An unreadable
  `characters.json` is copied to `characters.json.bad-<timestamp>` (with a loud log)
  before the server starts empty; a single record that fails the schema is kept raw
  and written back unchanged, never dropped.

## tsconfig friction

`tsconfig.base.json` sets `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, and `verbatimModuleSyntax`. Consequences that come up
constantly:

- Indexing an array or record yields `T | undefined` — handle it, don't `!`.
- An optional field cannot be assigned an explicit `undefined`. Building an object
  from a wire schema means adding keys conditionally (see the `levelUp` case in
  `packages/protocol/src/room.ts`), not spreading possibly-undefined values.
- Type-only imports need `import type`.
- Relative imports carry a `.js` extension even in `.ts` source.
