import { DEFAULT_GRID } from '@daggerheart/protocol';
import { describe, expect, it } from 'vitest';

import { snapToGrid } from '../src/state/gridSnap.js';

describe('snapToGrid', () => {
  it('leaves the position untouched when the grid has no squares', () => {
    expect(snapToGrid(123, 456, DEFAULT_GRID)).toEqual({ x: 123, y: 456 });
  });

  it('snaps to the nearest grid line when the grid is square', () => {
    const grid = { ...DEFAULT_GRID, mode: 'square' as const, size: 50, offsetX: 0, offsetY: 0 };
    expect(snapToGrid(62, 38, grid)).toEqual({ x: 50, y: 50 });
    expect(snapToGrid(24, 24, grid)).toEqual({ x: 0, y: 0 });
  });

  it('accounts for a grid offset', () => {
    const grid = { ...DEFAULT_GRID, mode: 'square' as const, size: 50, offsetX: 10, offsetY: 10 };
    expect(snapToGrid(58, 58, grid)).toEqual({ x: 60, y: 60 });
  });
});
