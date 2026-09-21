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

  it('centres a token smaller than a cell inside the cell it lands in', () => {
    const grid = { ...DEFAULT_GRID, mode: 'square' as const, size: 50, offsetX: 0, offsetY: 0 };
    // A 30px token in a 50px cell has 10px of margin on each side.
    expect(snapToGrid(62, 38, grid, { width: 30, height: 30 })).toEqual({ x: 60, y: 60 });
    expect(snapToGrid(6, 6, grid, { width: 30, height: 30 })).toEqual({ x: 10, y: 10 });
  });

  it('puts a two-cell creature on two whole cells', () => {
    const grid = { ...DEFAULT_GRID, mode: 'square' as const, size: 50, offsetX: 0, offsetY: 0 };
    expect(snapToGrid(48, 48, grid, { width: 100, height: 100 })).toEqual({ x: 50, y: 50 });
  });
});
