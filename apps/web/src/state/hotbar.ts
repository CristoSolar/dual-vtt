import { srd, TraitSchema } from '@daggerheart/srd-data';
import { z } from 'zod';

import { t } from '../i18n/index.js';
import { label as prettify, selectSheetView, weaponDamage } from './selectors.js';
import type { SheetState } from './sheet.js';

/**
 * The hotbar: ten shortcuts to the rolls a player makes over and over, kept per
 * account and campaign on this device only. A slot stores what to roll, never a
 * modifier — the number is read off the sheet when the slot is used, so a level
 * up or a swapped weapon is reflected without touching the bar.
 */

export const HOTBAR_SIZE = 10;

export const HotbarSlotSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('trait'), trait: TraitSchema }),
  z.object({ kind: z.literal('weapon'), slot: z.enum(['primary', 'secondary']) }),
  z.object({ kind: z.literal('card'), cardId: z.string() }),
  z.object({ kind: z.literal('experience'), name: z.string() }),
]);
export type HotbarSlot = z.infer<typeof HotbarSlotSchema>;

export const HotbarSchema = z.array(HotbarSlotSchema.nullable()).length(HOTBAR_SIZE);
export type Hotbar = readonly (HotbarSlot | null)[];

export const emptyHotbar = (): Hotbar => Array<HotbarSlot | null>(HOTBAR_SIZE).fill(null);

/** Puts a slot (or null, to clear it) at `index`; any other index leaves the bar as is. */
export function setSlot(bar: Hotbar, index: number, slot: HotbarSlot | null): Hotbar {
  if (!Number.isInteger(index) || index < 0 || index >= HOTBAR_SIZE) return bar;
  return bar.map((current, i) => (i === index ? slot : current));
}

/** What the roll dialog opens with: the same shape the sheet's own buttons build. */
export interface HotbarRoll {
  title: string;
  modifiers: number;
  modifierLabel: string;
  damage: ReturnType<typeof weaponDamage> | null;
  /** Experiences ticked when the dialog opens; still a Hope spend the player confirms. */
  presetExperiences: readonly string[];
}

/**
 * The roll a slot stands for on this sheet, or null when the sheet no longer
 * has it: a card sent to the vault, an empty weapon slot, a renamed experience.
 */
export function rollRequestFor(slot: HotbarSlot, sheet: SheetState): HotbarRoll | null {
  const character = sheet.character;
  const view = selectSheetView(sheet);
  const spellcast = view.spellcastTrait;

  switch (slot.kind) {
    case 'trait': {
      const traitLabel = prettify(slot.trait);
      return {
        title: t('sheet.roll.traitRollTitle', { trait: traitLabel }),
        modifiers: character.traits[slot.trait],
        modifierLabel: traitLabel,
        damage: null,
        presetExperiences: [],
      };
    }
    case 'weapon': {
      const weapon = slot.slot === 'primary' ? view.primaryWeapon : view.secondaryWeapon;
      if (weapon === null) return null;
      const modifiers =
        weapon.trait === 'spellcast'
          ? spellcast === null
            ? 0
            : character.traits[spellcast]
          : character.traits[weapon.trait];
      return {
        title: t('sheet.roll.attackTitle', { weapon: weapon.name }),
        modifiers,
        modifierLabel: t('sheet.roll.attackModifierLabel', { trait: prettify(weapon.trait) }),
        damage: weaponDamage(weapon, character),
        presetExperiences: [],
      };
    }
    case 'card': {
      if (!sheet.loadout.includes(slot.cardId)) return null;
      const card = srd().domainCards.find((c) => c.id === slot.cardId);
      if (card === undefined) return null;
      // A card's roll is a Spellcast Roll; a class without one rolls it bare.
      return {
        title: card.name,
        modifiers: spellcast === null ? 0 : character.traits[spellcast],
        modifierLabel:
          spellcast === null
            ? t('map.sheet.noTraitLabel')
            : t('sheet.route.spellcastTraitLabel', { trait: prettify(spellcast) }),
        damage: null,
        presetExperiences: [],
      };
    }
    case 'experience': {
      if (character.experiences[slot.name] === undefined) return null;
      return {
        title: slot.name,
        modifiers: 0,
        modifierLabel: t('map.sheet.noTraitLabel'),
        damage: null,
        presetExperiences: [slot.name],
      };
    }
  }
}
