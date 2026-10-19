import { describe, expect, it } from 'vitest';

import { GM_COLOR, PLAYER_COLORS, colorFor } from '../src/state/playerColor.js';

describe('colorFor', () => {
  it('gives an account the same colour every time', () => {
    expect(colorFor('acc-alex')).toBe(colorFor('acc-alex'));
    expect(PLAYER_COLORS).toContain(colorFor('acc-alex'));
  });

  it('tells two accounts apart', () => {
    expect(colorFor('acc-alex')).not.toBe(colorFor('acc-sam'));
  });

  it('gives the GM one colour of its own, whatever the account', () => {
    expect(colorFor('acc-alex', 'gm')).toBe(GM_COLOR);
    expect(colorFor('gm-1', 'gm')).toBe(GM_COLOR);
    expect(PLAYER_COLORS).not.toContain(GM_COLOR);
  });

  it('draws from a palette of eight distinct colours', () => {
    expect(new Set(PLAYER_COLORS).size).toBe(8);
  });
});
