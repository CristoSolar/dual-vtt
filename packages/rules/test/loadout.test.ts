import { describe, expect, it } from 'vitest';

import { MAX_LOADOUT, recallCard, vaultCard } from '../src/index.js';

const full = ['a', 'b', 'c', 'd', 'e'];

describe('recallCard', () => {
  it('costs Stress equal to the Recall Cost outside a rest', () => {
    const result = recallCard({
      loadout: ['a'],
      vault: ['z'],
      cardId: 'z',
      recallCost: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.stressCost).toBe(2);
    expect(result.result.loadout).toEqual(['a', 'z']);
    expect(result.result.vault).toEqual([]);
  });

  it('is free during a rest', () => {
    const result = recallCard({
      loadout: ['a'],
      vault: ['z'],
      cardId: 'z',
      recallCost: 3,
      duringRest: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.stressCost).toBe(0);
  });

  it('refuses when the PC has too little Stress to pay the cost', () => {
    const result = recallCard({
      loadout: ['a'],
      vault: ['z'],
      cardId: 'z',
      recallCost: 3,
      availableStress: 2,
    });
    expect(result).toEqual({ ok: false, error: 'notEnoughStress' });
  });

  it('rejects a card that is not in the vault', () => {
    const result = recallCard({ loadout: ['a'], vault: [], cardId: 'z', recallCost: 1 });
    expect(result).toEqual({ ok: false, error: 'cardNotInVault' });
  });

  it('needs a card to vault when the loadout is already at five', () => {
    expect(MAX_LOADOUT).toBe(5);
    const result = recallCard({ loadout: full, vault: ['z'], cardId: 'z', recallCost: 1 });
    expect(result).toEqual({ ok: false, error: 'loadoutFull' });
  });

  it('swaps for free when making space, keeping the loadout at five', () => {
    const result = recallCard({
      loadout: full,
      vault: ['z'],
      cardId: 'z',
      recallCost: 1,
      vaulting: 'c',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.loadout).toEqual(['a', 'b', 'd', 'e', 'z']);
    expect(result.result.loadout).toHaveLength(MAX_LOADOUT);
    expect(result.result.vault).toEqual(['c']);
    // Making space is free; only the recall itself costs Stress.
    expect(result.result.stressCost).toBe(1);
  });

  it('rejects vaulting a card that is not in the loadout', () => {
    const result = recallCard({
      loadout: full,
      vault: ['z'],
      cardId: 'z',
      recallCost: 1,
      vaulting: 'nope',
    });
    expect(result).toEqual({ ok: false, error: 'cardNotInLoadout' });
  });
});

describe('vaultCard', () => {
  it('moves a card to the vault', () => {
    const result = vaultCard({ loadout: ['a', 'b'], vault: [] }, 'a');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result).toEqual({ loadout: ['b'], vault: ['a'] });
  });

  it('rejects a card that is not in the loadout', () => {
    expect(vaultCard({ loadout: ['a'], vault: [] }, 'z')).toEqual({
      ok: false,
      error: 'cardNotInLoadout',
    });
  });
});
