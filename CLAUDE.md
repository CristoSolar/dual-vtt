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
```

Package names: `@daggerheart/srd-data`, `rules`, `character`, `protocol`, `server`, `web`.

There is no linter or formatter — `typecheck` under a strict tsconfig is the only
static gate. Do not add one unasked.

Server env vars (all optional, defaults in `apps/server/src/main.ts`): `PORT`,
`SNAPSHOT_PATH`, `SNAPSHOT_INTERVAL_MS`, `UPLOAD_DIR`, `ALLOWED_ORIGINS`. Web reads
`VITE_SERVER_URL`. `/health` on the server reports room count.

## Layering

Dependencies run strictly one way; nothing imports upward.

```
srd-data  →  rules  →  character  →  protocol  →  server
                                              ↘  web
```

- **srd-data** — JSON plus Zod schemas, nothing else. `src/index.ts` parses every file
  at import time, so a malformed JSON fails the process rather than surfacing later.
  Adding a data file means three edits in that one file: the JSON import, an entry in
  the `datasets` array (which `validate` walks), and the typed export.
- **rules** — pure functions over that data. Every function that randomizes takes an
  injectable `rng: () => number`; nothing reads a clock or a global.
- **character** — the 9-step creation reducer. `applyChoice` never throws or coerces:
  an invalid choice lands in state and is reported by `validateStep`, and completion
  flags are recomputed from `validateStep` after every action so they cannot drift.
- **protocol** — wire schemas *and* the reducers both ends run. `applyRoomEvent` in
  `src/room.ts` is the single choke point where room state changes, permissions
  included; the server calls it, and the client calls the same sheet reducers
  underneath for its optimistic echo. New room behaviour goes here, not in the server.
- **server** — transport only. `gateway.ts` validates messages and resolves the actor
  from the socket's session (never from a client-supplied field); `rooms.ts` owns the
  in-memory store, seat tokens, and the per-room dice seed. Neither contains game logic.
- **web** — renders and dispatches. No game logic; state transitions live in
  `apps/web/src/state` as pure functions.

## Invariants worth knowing before editing

- **Two audiences, two payloads.** The gateway broadcasts to `room:<code>:gm` and
  `room:<code>:players` separately. `roomForRole` / `mapForPlayer` strip inactive
  scenes, GM-only tokens, and unrevealed fog *before* the send — a player's browser
  never receives them. Any new GM-only state must be filtered there too.
- **Intents, not results.** A client sends `takeDamage { incoming }`; the server
  computes HP. Adding an event that carries a computed outcome breaks the model.
- **Rolls are server-side** from the room's seed (`rooms.ts`), which never leaves the
  process — this is what makes the log auditable.
- **Room state is plain JSON**, no Maps or class instances, because it is broadcast and
  snapshotted as-is. Slices in `RoomStateSchema` are top-level and independent.
- **Trust boundaries stay validated**: `localStorage` reads
  (`apps/web/src/state/storage.ts`), every socket message, and map uploads (checked by
  magic bytes, not the browser's content type).

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
