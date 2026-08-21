import type { Grid } from '@daggerheart/protocol';

/**
 * Snaps a token's top-left corner to the nearest grid line on drop — a no-op
 * when the scene has no square grid. Only meant to be applied on release, not
 * during the drag itself, so the token doesn't visually jump around mid-gesture.
 */
export function snapToGrid(x: number, y: number, grid: Grid): { x: number; y: number } {
  if (grid.mode !== 'square') return { x, y };
  return {
    x: grid.offsetX + Math.round((x - grid.offsetX) / grid.size) * grid.size,
    y: grid.offsetY + Math.round((y - grid.offsetY) / grid.size) * grid.size,
  };
}
