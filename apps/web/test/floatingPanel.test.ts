import { describe, expect, it } from 'vitest';

import { clampPanelPosition } from '../src/state/floatingPanel.js';

describe('clampPanelPosition', () => {
  it('leaves an in-bounds position untouched', () => {
    expect(clampPanelPosition(100, 200, 1600, 900)).toEqual({ x: 100, y: 200 });
  });

  it('pulls the header back on-screen when dragged past the right/bottom edge', () => {
    expect(clampPanelPosition(5000, 5000, 1600, 900)).toEqual({ x: 1576, y: 876 });
  });

  it('pulls the header back on-screen when dragged past the left/top edge', () => {
    expect(clampPanelPosition(-500, -500, 1600, 900)).toEqual({ x: 0, y: 0 });
  });
});
