import { describe, expect, it } from 'vitest';

import { claimLanded } from '../src/state/claim.js';

describe('claimLanded', () => {
  it('finishes once the room shows the character the wizard sent', () => {
    expect(claimLanded('saving', true)).toBe(true);
  });

  it('still finishes when a failed reconnect re-enabled the button before the claim landed', () => {
    expect(claimLanded('retry', true)).toBe(true);
  });

  it('waits while the claim is unconfirmed', () => {
    expect(claimLanded('saving', false)).toBe(false);
    expect(claimLanded('retry', false)).toBe(false);
  });

  it('ignores a character that was already there before the wizard sent anything', () => {
    expect(claimLanded('idle', true)).toBe(false);
  });
});
