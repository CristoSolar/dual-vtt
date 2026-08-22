# VTT parity roadmap

High-level roadmap for closing the gap between this app's map/table tooling and
general-purpose VTTs (Foundry, Roll20). Each item below gets its own design
spec and implementation plan when its turn comes — this document only orders
them and sketches the approach enough to sanity-check scope and sequencing.

Daggerheart-specific tooling (fear, spotlight, countdowns, environments,
adversary bestiary, character sheet, PDF export) is already at or above parity
and is out of scope here. Everything below is general VTT infrastructure this
app doesn't have yet.

## Order

1. Dynamic vision (line-of-sight)
2. Chat and map pings
3. Reusable asset gallery
4. Drawing tools
5. Handouts / journal entries
6. Audio (ambience + SFX)
7. Undo history

Vision is first because it's the single biggest gap and touches the same
map/token/fog data model the other map features build on — sequencing it
first avoids redoing fog-related code twice. Chat/pings is second because
it's independent, low-risk, and immediately felt at the table. The rest are
ordered roughly by impact-to-effort ratio, cheapest/most-isolated last.

---

## 1. Dynamic vision (line-of-sight)

**Today:** Fog of war is a hand-painted reveal grid (`Fog.revealed`, a set of
cell indices) — the GM brushes regions visible/hidden manually. No automatic
computation of what a token can actually see.

**Goal:** A token's vision is computed from its position, a vision radius,
and scene geometry (walls) that block line of sight — matching how Foundry
computes per-token vision polygons every time a token moves.

**Approach:**
- New `Wall` shape on `Scene` (line segments the GM draws, blocking sight —
  and optionally movement later, though movement-blocking is out of scope
  here). Protocol: `WallSchema { id, x1, y1, x2, y2 }`, `Scene.walls: Wall[]`.
- Vision polygon computed **client-side** per viewer from `token.x/y`,
  `visionRadius` (new token field), and `scene.walls` — a ray-casting /
  visibility-polygon algorithm (e.g. cast a ray to every wall endpoint, sort
  by angle, clip radius). This can reuse `packages/protocol`'s existing pure
  math style (see `ranges.ts`) for a testable, server-independent function
  shared between client render and — if needed later — server-side fog
  auto-reveal.
- Whether fog auto-reveals based on computed vision (replacing/augmenting the
  hand-painted brush) is a decision to make in that feature's own spec: full
  parity would compute the union of every player token's vision polygon each
  move and reveal those cells server-side, replacing manual painting for
  scenes where the GM wants it, while keeping manual paint as an override/
  option for the "theater of the mind" scenes that don't use a grid.
- Rendering: Konva clip mask per-viewer over the fog layer, likely as a
  filled polygon path (canvas clipping), GM sees everything as today.

**Complexity:** Large. New geometry data model, a real visibility algorithm,
performance work (recomputing on every token move), and a GM wall-drawing
tool (its own mini design: draw/edit/delete wall segments, snap to grid).

---

## 2. Chat and map pings

**Today:** No text chat. The roll log is the only shared feed, and it only
carries dice rolls. No way to point at a map location for the table without
external voice comms.

**Goal:** A lightweight chat panel (text messages, not dice — those already
have the roll log) and an alt-click-style ping that flashes a marker at a
scene-space point for everyone connected.

**Approach:**
- Chat: a new `RoomEvent` (`sendMessage`) and a bounded log analogous to
  `rollLog` (`ChatEntry[]`, same `MAX_LOG_ENTRIES` capping pattern). GM-only
  gating not needed — any seated player or the GM may chat. Rendered as a
  small floating panel (reuse `FloatingPanel`), always available regardless
  of whether the map is open.
- Pings: an ephemeral, non-persisted broadcast (doesn't belong in `RoomState`
  at all — it's a transient animation, not state) — a new socket message
  outside the `RoomEvent`/reducer path entirely, closer to how `rolled`
  already works as a fire-and-forget notification. Payload: `{sceneId, x, y,
  by}`. Client renders a brief expanding-ring animation at that point on the
  active scene, respecting `prefers-reduced-motion`.

**Complexity:** Medium. Chat is a straightforward log-and-broadcast feature
following an existing pattern almost exactly (rollLog). Pings are simpler
still — no persistence, no reducer changes, just a broadcast and a client
animation.

---

## 3. Reusable asset gallery

**Today:** `POST /uploads` is one-shot — every map background or token
portrait is a fresh upload with no way to browse or reuse a previous one.
Re-adding the same monster art means re-uploading the same file.

**Goal:** A small library view (in the battlemap/token panels) listing
previously uploaded images for this campaign, so the GM picks instead of
re-uploading.

**Approach:**
- The upload endpoint already returns a URL; the gap is purely "remember
  what's been uploaded." Add a per-campaign list of `{url, width, height,
  uploadedAt}` records — could live in `CampaignStore`'s existing snapshot
  (a new array field, learn from the grid-schema incident: ship it with a
  sane default/migration path) or, simpler, be derived by having the server
  list the campaign's own upload directory rather than tracking it in state
  at all (`GET /uploads?campaignId=`, scoped uploads-per-campaign instead of
  one global folder).
- UI: a small grid of thumbnails in the existing upload panels, "pick
  existing" alongside "upload new."

**Complexity:** Small–Medium. Mostly plumbing; the only real decision is
where the list of past uploads lives (derived from disk vs. tracked in
state) and whether uploads should become campaign-scoped on disk at all
(today they're one global `.data/uploads` folder for the whole server).

---

## 4. Drawing tools

**Today:** No freehand annotation. The GM can only place tokens, paint fog,
and (with this roadmap) walls — nothing for "here's a trap" or "the party
went this way" as an ad-hoc mark.

**Goal:** Freehand/shape drawing on the active scene — lines, arrows,
circles/rects, and free-draw strokes, GM-authored (or optionally
player-authored for their own annotations), visible to whoever the GM
chooses.

**Approach:**
- `Scene.drawings: Drawing[]` — `{id, kind: 'line'|'arrow'|'rect'|'circle'|
  'freehand', points, color, strokeWidth, visibleToPlayers}`. Very much the
  same shape as `Wall` from item 1 (point-list geometry) — worth designing
  these two together if item 1's spec is still in flux when this comes up,
  since a "wall" is really just a special-purpose drawing.
- New `RoomEvent`s: `addDrawing`/`removeDrawing`, GM-gated like other map
  events, rendered as an extra Konva `Layer`.

**Complexity:** Medium. Mostly UI work (a drawing toolbar, shape/freehand
input handling) once the data model exists; no new algorithmic complexity
like vision has.

---

## 5. Handouts / journal entries

**Today:** Nothing between "put it on the map as a token/scene image" and
"say it out loud." No way to show a player a specific picture or read them a
note without it being a permanent map fixture.

**Goal:** The GM shares a one-off image or block of text to some/all
players; it shows as a dismissible overlay, not part of the persistent map
state.

**Approach:**
- Reuses the ping's "ephemeral broadcast, not persisted state" shape: a
  `showHandout` message `{kind: 'image'|'text', content, audience}` sent
  directly over the socket (or as a lightweight `RoomEvent` if the GM wants
  the last handout to survive a reconnect — a design decision for that
  feature's own spec).
- Client renders a modal (reuse `Dialog`) with the image/text and a close
  button.

**Complexity:** Small. Almost entirely reuses existing patterns (Dialog,
upload flow, ephemeral broadcast from item 2).

---

## 6. Audio (ambience + SFX)

**Today:** No sound at all.

**Goal:** GM-controlled ambient background music/loops per scene, and
optionally one-shot SFX triggers (e.g. on a critical hit).

**Approach:**
- Audio files go through the same upload endpoint (already accepts
  arbitrary bytes if the magic-byte sniff allowlist is widened — currently
  image-only, would need an audio branch).
- `Scene.ambience: {url, volume, loop} | null`, changed via a
  `setSceneAmbience` `RoomEvent` (mirrors `setSceneImage` exactly).
- Playback is entirely client-side: each browser tab plays its own `<audio>`
  element synced to `scene.ambience`. No server-side audio mixing — every
  client just loads and loops the same file locally. SFX one-shots can be
  fire-and-forget broadcasts like pings/handouts.
- Autoplay-policy caveat: browsers block audio until a user gesture: the app
  will need a "enable sound" button per session (a real, first-class UX
  concern for this feature's spec, not an afterthought).

**Complexity:** Medium. The audio plumbing itself is simple (mirrors
setSceneImage), but browser autoplay restrictions and volume/mute UX need
real design attention.

---

## 7. Undo history

**Today:** No undo. A misclick (delete the wrong token, paint fog over the
wrong area) is permanent; the GM manually redoes the fix.

**Goal:** A bounded undo stack for map edits (scene/token/fog changes),
GM-only, at least a few steps deep.

**Approach:**
- The reducer (`packages/protocol/src/room.ts`) already produces a fresh
  `RoomState` per event — the cheapest approach is keeping a short ring
  buffer of previous `map: MapState` snapshots server-side (per campaign,
  capped depth, e.g. 20) and a `undoMap`/`redoMap` `RoomEvent` that pops one
  off and re-broadcasts. Bounded memory cost is the main constraint (map
  state includes token/fog data, capped depth keeps it small).
- Deliberately scoped to map edits only — undoing a dice roll or an HP
  change doesn't make sense the same way and is out of scope.

**Complexity:** Medium. Conceptually simple (snapshot ring buffer) but needs
care around what counts as "one undo step" (should dragging a token 50 times
during a move be one step or fifty? — batch by `commit: true` moveToken
events, matching the throttle pattern already used for those) and what to do
if two GMs (or a GM and co-GM, if that ever exists) undo concurrently — not
a real concern today since there's exactly one GM per campaign.

---

## Cross-cutting notes

- **Learn from the grid-schema incident:** every new persisted field on
  `Scene`/`Token`/`RoomState` must ship with a zod `.default()` (or be
  additive-only) so a campaign snapshot saved before the field existed still
  restores. `campaigns-snapshot.ts`/`users-snapshot.ts` now also parse each
  record independently, so a schema mistake in one campaign won't wipe every
  other campaign in the file — but the per-field default is still the first
  line of defense and should be habitual going forward.
- **Ephemeral vs. persisted:** pings, handouts, and SFX one-shots don't
  belong in `RoomState` — they're notifications, not state, matching the
  existing `rolled` message's fire-and-forget pattern rather than the
  reducer/event-sourcing pattern used for map/character mutations. Getting
  this distinction right per-feature avoids bloating `RoomState` with
  transient junk.
- **Shared geometry:** walls (1) and drawings (4) are structurally the same
  "list of points with a style" — worth a shared `Shape`-ish type if both
  land close together, to avoid two parallel near-identical schemas.
