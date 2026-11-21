import { srd } from '@daggerheart/srd-data';
import { describe, expect, it } from 'vitest';

import {
  clampIndex,
  flavorText,
  ringOffset,
  visibleWindow,
  wrapIndex,
} from '../src/state/carousel.js';

describe('wrapIndex / clampIndex', () => {
  it('wraps past either end of the ring', () => {
    expect(wrapIndex(-1, 5)).toBe(4);
    expect(wrapIndex(5, 5)).toBe(0);
    expect(wrapIndex(12, 5)).toBe(2);
    expect(wrapIndex(-11, 5)).toBe(4);
  });

  it('clamps into range', () => {
    expect(clampIndex(-3, 5)).toBe(0);
    expect(clampIndex(9, 5)).toBe(4);
    expect(clampIndex(2, 5)).toBe(2);
  });

  it('is 0 for an empty list rather than NaN', () => {
    expect(wrapIndex(3, 0)).toBe(0);
    expect(clampIndex(3, 0)).toBe(0);
  });
});

describe('ringOffset', () => {
  it('goes the short way round', () => {
    expect(ringOffset(0, 0, 9)).toBe(0);
    expect(ringOffset(1, 0, 9)).toBe(1);
    expect(ringOffset(8, 0, 9)).toBe(-1);
    expect(ringOffset(0, 8, 9)).toBe(1);
    expect(ringOffset(4, 0, 9)).toBe(4);
    expect(ringOffset(5, 0, 9)).toBe(-4);
  });

  it('breaks the even-ring tie towards the right', () => {
    expect(ringOffset(2, 0, 4)).toBe(2);
  });
});

describe('visibleWindow', () => {
  it('returns the centre and its neighbours, left to right, across the seam', () => {
    expect(visibleWindow(0, 9, 2)).toEqual([7, 8, 0, 1, 2]);
    expect(visibleWindow(4, 9, 2)).toEqual([2, 3, 4, 5, 6]);
  });

  it('never repeats a card when the ring is small', () => {
    expect(visibleWindow(0, 3, 2)).toEqual([2, 0, 1]);
    expect(visibleWindow(0, 1, 2)).toEqual([0]);
    expect(visibleWindow(0, 0, 2)).toEqual([]);
  });
});

describe('flavorText', () => {
  it('keeps a short first sentence whole', () => {
    expect(flavorText('Tienes alas. Puedes volar.')).toBe('Tienes alas.');
  });

  it('cuts a long sentence at a word boundary with an ellipsis', () => {
    const long = `${'palabra '.repeat(40)}fin.`;
    const out = flavorText(long, 60);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith('palabra…')).toBe(true);
  });

  it('flattens line breaks and only ever quotes the source', () => {
    expect(flavorText('Una línea\ny otra')).toBe('Una línea y otra');
    for (const community of srd().communities) {
      const out = flavorText(community.feature.text).replace(/…$/, '');
      expect(community.feature.text.replace(/\s+/g, ' ')).toContain(out);
    }
  });
});
