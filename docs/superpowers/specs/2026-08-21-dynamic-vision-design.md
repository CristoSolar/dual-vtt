# Dynamic vision (line-of-sight)

Item 1 of `2026-08-21-vtt-parity-roadmap.md`.

## Goal

A player sees only what their character's vision actually reaches: a radius
around their token, blocked by walls and doors the GM draws on the scene —
computed automatically, not hand-painted. Fog stays the source of truth for
*what a player has ever seen* (cumulative, never un-reveals itself, matching
the existing manual-fog behavior); vision decides *what's newly revealed*
each time a token moves.

## Decisions (confirmed)

- **Manual and automatic fog coexist, chosen per scene.** `Scene.visionMode:
  'manual' | 'auto'`. Manual is the existing hand-painted brush, unchanged.
  Auto computes reveals from wall geometry and each player's own token. A
  scene with no grid can still use auto — walls and vision are pixel-space
  geometry, not grid-cell math, so squares aren't a prerequisite.
- **Walls include doors.** A wall segment has `kind: 'wall' | 'door'`; a door
  additionally carries `open: boolean`. Closed doors block vision exactly
  like a wall; open ones don't. The GM toggles a door open/closed; that's the
  only door-specific interaction in this pass (no locks, no player-openable
  doors).
- **Vision radius is a per-token field**, editable from the existing
  `TokenPopover`, with a sane default so most tokens never need it touched.

## Data model — `packages/protocol/src/map.ts`

```ts
export const WallSchema = z.object({
  id: z.string().min(1).max(64),
  x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(),
  kind: z.enum(['wall', 'door']).default('wall'),
  /** Doors only. Open doors don't block vision. Ignored for plain walls. */
  open: z.boolean().default(false),
});
export type Wall = z.infer<typeof WallSchema>;
```

`Scene` gains:
- `walls: z.array(WallSchema).max(500).default([])`
- `visionMode: z.enum(['manual', 'auto']).default('manual')`

`Token` gains:
- `visionRadius: z.number().min(0).max(4000).default(720)` (px; ~12 squares
  at the default 60px grid — arbitrary but reasonable, and editable per
  token same as size/rotation already are).

Every new field ships with a zod `.default()`, per the cross-cutting note in
the roadmap doc — a snapshot saved before this feature must still restore.

## Algorithm — `packages/protocol/src/vision.ts` (new, pure, tested)

Same category as `ranges.ts`: pure math, no React/Konva/socket dependency,
usable identically by the server (to compute what to persist as revealed)
and the client (to render instantly during a drag, before the server's
patch arrives).

```ts
export function computeVisionPolygon(
  origin: { x: number; y: number },
  radius: number,
  walls: readonly Wall[],
  bounds: { width: number; height: number },
): { x: number; y: number }[]
```

Ray-casting visibility polygon:
1. Filter out open doors — only `kind: 'wall'` and closed doors block.
2. Build the candidate angle set: every blocking wall's two endpoints (as
   seen from `origin`, each ± a tiny epsilon so a ray grazing a corner
   resolves consistently), plus a fixed ring of evenly-spaced angles (64)
   as a fallback so open areas render as a smooth-ish circle rather than a
   polygon with only as many sides as there are walls nearby.
3. For each angle, cast a ray from `origin` out to `radius`; intersect
   against every blocking wall segment; keep the nearest hit (or the full
   radius length if nothing blocks it, clamped to `bounds` so it never
   escapes the scene image).
4. Sort the resulting points by angle and return them as a polygon.

This is the one genuinely new piece of math in the whole roadmap — it gets
its own thorough test file mirroring `ranges.test.ts`'s style: no walls →
roughly circular; a single wall directly in front → polygon stops at it and
wraps around the corners; origin inside a fully enclosed room → polygon
doesn't leak outside it.

## Server — persisting what auto-reveals

`packages/protocol/src/room.ts`'s `moveToken`/`addToken` cases: when the
affected scene has `visionMode === 'auto'` and the token is `kind: 'pc'`,
recompute that token's polygon and reveal every fog cell whose center falls
inside it, merging into `Fog.revealed` with the existing `reveal()` helper
(already additive/cumulative — no behavior change needed there). Adversary
and marker tokens don't drive reveals; only a player's own character does,
matching "the party can only know what the party has seen."

`setSceneGrid`/wall-editing events don't need to retroactively recompute
past reveals — changing a wall after the fact doesn't un-reveal what was
already seen, same philosophy as the existing manual fog never un-revealing
on its own.

## GM authoring — walls panel

New map-rail panel (`PanelId: 'walls'`, alongside the existing
scenes/battlemap/grid/tokens/fog panels): a draw-mode toggle (click-drag to
place a segment, matching the existing measuring-tool interaction style),
a list of placed walls with a "convertir en puerta" toggle and, for doors,
an open/closed toggle, and delete. New GM-only `RoomEvent`s: `addWall`,
`removeWall`, `updateWall` (for the open/closed flip), `setSceneVisionMode`.

Rendering: the GM always sees wall/door lines on the canvas (thin, a color
distinct from the grid); players never see the lines themselves, only their
vision-blocking effect.

## Client rendering

- The GM's own view is never restricted — unchanged from today.
- A player computes (or receives, already computed for the persisted part)
  their own token's vision polygon and clips the fog layer to it: fog is
  drawn everywhere, then the polygon is punched out via a Konva `clipFunc`
  (same technique already used for the token-image rounded-rect clip in
  `MapCanvas.tsx`).
- Client-side prediction: while dragging their own token, the client
  recomputes the polygon locally every frame (cheap — pure function, no
  network round-trip) for instant feedback, the same way `DragThrottle`
  already previews token position before the server's `moveToken` patch
  confirms it. The server's persisted `Fog.revealed` remains the source of
  truth for "what's been seen forever"; the live polygon is only the
  current-instant view on top of that history.
- In `auto` mode, the existing manual fog-paint UI (brush size, reveal/hide
  buttons) is hidden for that scene — painting would be redundant with (and
  confusing alongside) the computed reveal.

## Testing

- `packages/protocol/test/vision.test.ts` — the ray-casting algorithm itself
  (new, thorough — this is the one place real bugs would hide).
- `packages/protocol/test/map.test.ts` — `Wall`/`visionRadius`/`visionMode`
  defaults parse against pre-existing (field-less) fixtures.
- `apps/server/test/map.test.ts` — `addWall`/`removeWall`/`updateWall`/
  `setSceneVisionMode` are GM-only; auto-mode reveal actually persists to
  `Fog.revealed` after a player's `moveToken`.
- Web: no Konva-dependent unit test for the clip rendering itself (same
  constraint hit with `snapToGrid` — Konva needs a real browser to render),
  but `computeVisionPolygon` is imported and used directly by a small,
  Konva-free web-side positioning helper if one is needed, same pattern as
  `gridSnap.ts`.

## Complexity

Large — this is the single biggest item on the roadmap. Realistically two
implementation passes: (1) protocol + server (schema, algorithm, reducer,
persistence, GM wall tool, tests) and (2) client rendering (clip mask,
prediction, panel UI, hiding manual controls in auto mode). Worth planning
and reviewing as two tasks rather than one.
