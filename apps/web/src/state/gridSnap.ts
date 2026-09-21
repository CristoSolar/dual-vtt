import type { Grid } from '@daggerheart/protocol';

/** The footprint being snapped, when it is bigger or smaller than one cell. */
export interface SnapSize {
  width: number;
  height: number;
}

/** Aligns one axis: the footprint lands on whole cells and sits centred in them. */
function snapAxis(value: number, extent: number, offset: number, size: number): number {
  const cells = Math.max(1, Math.round(extent / size));
  const span = cells * size;
  const centre = value + extent / 2;
  const left = offset + Math.round((centre - offset - span / 2) / size) * size;
  // A token narrower than the cells it occupies sits in the middle of them rather
  // than against the left-hand line.
  return left + (span - extent) / 2;
}

/**
 * Snaps a token to the grid on drop — a no-op when the scene has no square grid.
 *
 * Only meant to be applied on release, not during the drag itself, so the token
 * doesn't visually jump around mid-gesture. Passing the token's size makes the
 * snap aware of its footprint: a two-cell creature lands on two whole cells, and
 * a token smaller than a cell sits in the middle of it rather than in a corner.
 */
export function snapToGrid(
  x: number,
  y: number,
  grid: Grid,
  size?: SnapSize,
): { x: number; y: number } {
  if (grid.mode !== 'square') return { x, y };
  if (size === undefined) {
    return {
      x: grid.offsetX + Math.round((x - grid.offsetX) / grid.size) * grid.size,
      y: grid.offsetY + Math.round((y - grid.offsetY) / grid.size) * grid.size,
    };
  }
  return {
    x: snapAxis(x, size.width, grid.offsetX, grid.size),
    y: snapAxis(y, size.height, grid.offsetY, grid.size),
  };
}
