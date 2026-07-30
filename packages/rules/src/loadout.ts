/** You can have up to 5 domain cards in your loadout at one time (SRD p.9). */
export const MAX_LOADOUT = 5;

export interface Loadout {
  /** Card ids whose effects are active in play. At most `MAX_LOADOUT`. */
  loadout: readonly string[];
  /** Card ids in the vault: inactive, and do not influence play (SRD p.9). */
  vault: readonly string[];
}

export type LoadoutError =
  | 'cardNotInVault'
  | 'cardNotInLoadout'
  | 'loadoutFull'
  | 'notEnoughStress';

export interface SwapResult extends Loadout {
  /** Stress the PC must mark for this swap: the card's Recall Cost, or 0 during a rest. */
  stressCost: number;
}

export interface RecallOptions extends Loadout {
  /** Id of the vaulted card being moved into the loadout. */
  cardId: string;
  /** The card's Recall Cost. */
  recallCost: number;
  /**
   * True at the start of a rest, before downtime moves, when cards move freely
   * (SRD p.9). Outside a rest, recalling costs Stress equal to the Recall Cost.
   */
  duringRest?: boolean;
  /** Id of a loadout card to vault, required when the loadout is already full. */
  vaulting?: string | undefined;
  /** Unmarked Stress slots available to pay the cost. */
  availableStress?: number;
}

/**
 * Moves a card from the vault into the loadout. Costs Stress equal to the card's
 * Recall Cost outside a rest and nothing during one. When the loadout is already
 * full, a card must move to the vault to make space, which is always free.
 */
export function recallCard(
  options: RecallOptions,
): { ok: true; result: SwapResult } | { ok: false; error: LoadoutError } {
  const { cardId, recallCost, duringRest = false, vaulting, availableStress } = options;

  if (!options.vault.includes(cardId)) return { ok: false, error: 'cardNotInVault' };

  const stressCost = duringRest ? 0 : recallCost;
  if (availableStress !== undefined && stressCost > availableStress) {
    return { ok: false, error: 'notEnoughStress' };
  }

  let loadout = options.loadout.filter((id) => id !== cardId);
  let vault = options.vault.filter((id) => id !== cardId);

  if (loadout.length >= MAX_LOADOUT) {
    if (vaulting === undefined) return { ok: false, error: 'loadoutFull' };
    if (!loadout.includes(vaulting)) return { ok: false, error: 'cardNotInLoadout' };
    loadout = loadout.filter((id) => id !== vaulting);
    vault = [...vault, vaulting];
  }

  return { ok: true, result: { loadout: [...loadout, cardId], vault, stressCost } };
}

/** Moves a card from the loadout to the vault. Always free (SRD p.9). */
export function vaultCard(
  state: Loadout,
  cardId: string,
): { ok: true; result: Loadout } | { ok: false; error: LoadoutError } {
  if (!state.loadout.includes(cardId)) return { ok: false, error: 'cardNotInLoadout' };
  return {
    ok: true,
    result: {
      loadout: state.loadout.filter((id) => id !== cardId),
      vault: [...state.vault, cardId],
    },
  };
}
