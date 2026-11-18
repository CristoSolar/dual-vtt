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
```

Package names: `@daggerheart/srd-data`, `rules`, `character`, `protocol`, `server`, `web`.

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
srd-data  →  rules  →  character  →  protocol  →  server
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
  accounts, campaign membership/invitations and the character library — no
  `RoomState` travels over HTTP, only over the socket (a library entry carries a
  `SheetState`, never a room).
  `claimCharacterInRoom` / `releaseCharacterInRoom` are how a sheet enters and leaves a
  room; linking from the library goes through them. Fear-on-new-PC is decided by the
  server (`CampaignRecord.partyIds`: once per account per campaign, so swapping
  characters adds none) and passed in as `isNewToTheParty`. There is no socket
  claim: the only way into a room is the library link, which refuses an occupied seat.
- **server** — transport only. Two layers:
  - HTTP (`auth-http.ts`, `campaigns-http.ts`, `characters-http.ts`, `uploads.ts`,
    `tunnel-http.ts`, `static.ts`): login issues a token (`sessions.ts`, in-memory —
    restart signs everyone out, by design); GM creates player accounts and campaigns
    and invites players (`invitedIds`); a player accepts or declines, which is the only
    way to become a member. `/characters` is each account's own library (owner-only;
    someone else's id answers 404). HTTP routes that change a room get a `broadcast`
    callback (the gateway's `broadcastPatches`) so live sockets see the change.
  - Socket (`gateway.ts`): authenticates once at connect with that same token, then
    `joinCampaign` seats the socket after a membership check. The web client names its
    campaign in the handshake `auth` instead, so a reconnect is seated before socket.io
    flushes messages buffered while offline (otherwise they bounce with `noSeat`). Membership is re-checked
    on every message, so a removed player is cut off mid-session.
  - `campaigns.ts` owns the in-memory store, ownership (`ownerId` is GM, `memberIds`
    are players, `invitedIds` are pending invitations), and the per-campaign dice seed.
    `users.ts` holds accounts with password hashes that never leave the server.
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
- **web** — renders and dispatches. No game logic; state transitions live in
  `apps/web/src/state` as pure functions. Routing is `HashRouter`, so the static
  server never sees app paths. UI text goes through `t()` from `apps/web/src/i18n`;
  `es.ts` is the source of keys and `en.ts` is typed against it. A player account lands
  on two doors, **Mis personajes** (`/characters`) and **Mis campañas** (`/campaigns`);
  a GM account lands on the campaigns list. The wizard (`/create/:step`) needs no
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
  never receives them. Any new GM-only state must be filtered there too.
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
  type).
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
