import { describe, expect, it } from 'vitest';

import { MAX_LIGHTS, buildFogMask, hexToRgb, pickLights } from '../src/components/map/FogGl.js';

describe('fog mask', () => {
  it('marks revealed cells and leaves the rest covered', () => {
    const mask = buildFogMask({ cols: 3, rows: 2, revealed: [0, 4] });
    expect(Array.from(mask)).toEqual([255, 0, 0, 0, 255, 0]);
  });

  it('ignores indices outside the grid rather than growing the mask', () => {
    const mask = buildFogMask({ cols: 2, rows: 2, revealed: [-1, 3, 99] });
    expect(mask).toHaveLength(4);
    expect(Array.from(mask)).toEqual([0, 0, 0, 255]);
  });

  it('covers everything when nothing has been revealed', () => {
    const mask = buildFogMask({ cols: 2, rows: 2, revealed: [] });
    expect(Array.from(mask).every((value) => value === 0)).toBe(true);
  });
});

describe('hexToRgb', () => {
  it('reads both the long and short forms', () => {
    expect(hexToRgb('#ffffff')).toEqual([1, 1, 1]);
    expect(hexToRgb('#000')).toEqual([0, 0, 0]);
    expect(hexToRgb(' #0b0812 ')).toEqual([11 / 255, 8 / 255, 18 / 255]);
  });

  it('falls back to black on anything it cannot read', () => {
    expect(hexToRgb('rgb(1,2,3)')).toEqual([0, 0, 0]);
    expect(hexToRgb('')).toEqual([0, 0, 0]);
  });
});

describe('pickLights', () => {
  const light = (x: number) => ({ x, y: 0, radius: 100 });

  it('passes every light through while they fit', () => {
    const lights = [light(0), light(10)];
    expect(pickLights(lights, { x: 0, y: 0 })).toEqual(lights);
  });

  it('keeps the ones nearest the middle of the view when there are too many', () => {
    const lights = [light(500), light(10), light(300), light(20)];
    expect(pickLights(lights, { x: 0, y: 0 }, 2)).toEqual([light(10), light(20)]);
  });

  it('carries at most what the shader has room for', () => {
    const many = Array.from({ length: 20 }, (_, index) => light(index));
    expect(pickLights(many, { x: 0, y: 0 })).toHaveLength(MAX_LIGHTS);
  });
});
