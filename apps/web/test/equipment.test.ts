import {
  applyChoice,
  availableOptions,
  createInitialState,
  requiresSpellcast,
  spellcastTrait,
  type CreationState,
  type Trait,
} from '@daggerheart/character';
import { srd, type ClassId, type Weapon } from '@daggerheart/srd-data';
import { describe, expect, it } from 'vitest';

import { printedDamage } from '../src/components/wizard/cardItems.js';
import {
  armorGlyph,
  glyphFromId,
  rankWeapons,
  recommendReason,
  topTraits,
  weaponGlyph,
  weaponTrait,
} from '../src/state/equipment.js';

const AGILE: Record<Trait, number> = {
  agility: 2,
  strength: 1,
  finesse: 1,
  instinct: 0,
  presence: 0,
  knowledge: -1,
};

const weapon = (id: string): Weapon => {
  const found = srd().weapons.find((w) => w.id === id);
  if (found === undefined) throw new Error(`no weapon ${id}`);
  return found;
};

function stateFor(classId: ClassId, traits = AGILE): CreationState {
  const characterClass = srd().classes.find((c) => c.id === classId);
  const subclassId = characterClass?.subclasses[0];
  if (subclassId === undefined) throw new Error(`no subclass for ${classId}`);
  let state = applyChoice(createInitialState(), { type: 'chooseClass', classId });
  state = applyChoice(state, { type: 'chooseSubclass', subclassId });
  return applyChoice(state, { type: 'assignTraits', traits });
}

describe('the legal list the step shows (availableOptions step 5)', () => {
  it('shows no magic weapon to a class without a Spellcast trait', () => {
    for (const classId of ['warrior', 'guardian'] as const) {
      const options = availableOptions(stateFor(classId), 5);
      expect(options.primaryWeapons.length).toBeGreaterThan(0);
      expect(options.primaryWeapons.some(requiresSpellcast), classId).toBe(false);
      expect(options.secondaryWeapons.some(requiresSpellcast), classId).toBe(false);
    }
  });

  it('shows magic weapons to a spellcaster, all Tier 1', () => {
    for (const classId of ['wizard', 'sorcerer'] as const) {
      const options = availableOptions(stateFor(classId), 5);
      expect(options.primaryWeapons.some(requiresSpellcast), classId).toBe(true);
      expect(options.primaryWeapons.every((w) => w.tier === 1)).toBe(true);
    }
  });

  it('offers no secondary beside a two-handed primary', () => {
    const base = stateFor('warrior');
    const withPrimary = (primaryWeaponId: string) =>
      applyChoice(base, {
        type: 'chooseEquipment',
        equipment: {
          primaryWeaponId,
          secondaryWeaponId: null,
          armorId: 'leather-armor',
          potion: 'health',
          classItem: '',
          spellCarrier: null,
        },
      });
    expect(availableOptions(withPrimary('greatsword'), 5).secondaryWeapons).toEqual([]);
    expect(availableOptions(withPrimary('broadsword'), 5).secondaryWeapons.length).toBeGreaterThan(0);
  });
});

describe('topTraits', () => {
  it('keeps every trait at the two highest values, ties included', () => {
    expect([...topTraits(AGILE)].sort()).toEqual(['agility', 'finesse', 'strength']);
  });

  it('is empty before traits are assigned', () => {
    expect(topTraits(null)).toEqual([]);
  });
});

describe('weaponTrait / recommendReason', () => {
  it('resolves the arcane wheelchair to the subclass trait', () => {
    expect(weaponTrait(weapon('arcane-frame-wheelchair'), 'instinct')).toBe('instinct');
    expect(weaponTrait(weapon('broadsword'), 'instinct')).toBe('agility');
  });

  it('recommends a weapon in a top trait, or in the Spellcast trait first', () => {
    expect(recommendReason(weapon('broadsword'), AGILE, null)).toBe('topTrait');
    expect(recommendReason(weapon('dagger'), AGILE, null)).toBe('topTrait'); // finesse +1
    expect(recommendReason(weapon('wand'), AGILE, null)).toBeNull(); // knowledge −1
    expect(recommendReason(weapon('wand'), AGILE, 'knowledge')).toBe('spellcast');
    expect(recommendReason(weapon('broadsword'), null, null)).toBeNull();
  });
});

describe('rankWeapons', () => {
  it('puts recommended weapons first, highest modifier first, SRD order on ties', () => {
    const state = stateFor('warrior');
    const ranked = rankWeapons(availableOptions(state, 5).primaryWeapons, state.traits, spellcastTrait(state));
    const firstPlain = ranked.findIndex((r) => r.reason === null);
    expect(firstPlain).toBeGreaterThan(0);
    expect(ranked.slice(firstPlain).every((r) => r.reason === null)).toBe(true);
    expect(ranked[0]?.trait).toBe('agility');
    expect(ranked[0]?.weapon.id).toBe('broadsword');
    const modifiers = ranked.slice(0, firstPlain).map((r) => r.modifier ?? 0);
    expect(modifiers).toEqual([...modifiers].sort((a, b) => b - a));
  });

  it('follows the assigned traits', () => {
    const strong: Record<Trait, number> = { ...AGILE, agility: -1, knowledge: 1, strength: 2 };
    const state = stateFor('warrior', strong);
    const ranked = rankWeapons(availableOptions(state, 5).primaryWeapons, state.traits, null);
    expect(ranked[0]?.trait).toBe('strength');
    expect(ranked.find((r) => r.weapon.id === 'broadsword')?.reason).toBeNull();
  });

  it('keeps every weapon it was given', () => {
    const list = availableOptions(stateFor('wizard'), 5).primaryWeapons;
    expect(rankWeapons(list, AGILE, 'knowledge')).toHaveLength(list.length);
  });
});

describe('glyphs and damage text', () => {
  it('picks a glyph from the weapon id, specific words first', () => {
    expect(weaponGlyph(weapon('hand-crossbow'))).toBe('crossbow');
    expect(weaponGlyph(weapon('longbow'))).toBe('bow');
    expect(weaponGlyph(weapon('whipsword'))).toBe('sword');
    expect(weaponGlyph(weapon('whip'))).toBe('whip');
    expect(weaponGlyph(weapon('rune-shield'))).toBe('shield');
    expect(weaponGlyph(weapon('casting-dagger'))).toBe('dagger');
    expect(weaponGlyph(weapon('battleaxe'))).toBe('axe');
    expect(weaponGlyph(weapon('arcane-frame-wheelchair'))).toBe('wheel');
  });

  it('falls back on range and damage type for an unknown id', () => {
    expect(weaponGlyph({ id: 'x', range: 'far', damageType: 'physical' })).toBe('bow');
    expect(weaponGlyph({ id: 'x', range: 'veryFar', damageType: 'magic' })).toBe('wand');
    expect(weaponGlyph({ id: 'x', range: 'melee', damageType: 'physical' })).toBe('sword');
    expect(weaponGlyph({ id: 'x', range: 'close', damageType: 'magic' })).toBe('rune');
  });

  it('names a glyph for every weapon a new character can see', () => {
    const unnamed = srd()
      .weapons.filter((w) => w.tier === 1)
      .filter((w) => glyphFromId(w.id) === null);
    expect(unnamed.map((w) => w.id)).toEqual([]);
  });

  it('dresses armor by its score', () => {
    expect(armorGlyph({ id: 'gambeson-armor', baseScore: 3 })).toBe('tunic');
    expect(armorGlyph({ id: 'full-plate-armor', baseScore: 4 })).toBe('plate');
    expect(armorGlyph({ id: 'mage-robes', baseScore: 2 })).toBe('robe');
  });

  it('prints damage as the die and modifier', () => {
    expect(printedDamage(weapon('mace'))).toBe('d8+1');
    expect(printedDamage(weapon('broadsword'))).toBe('d8');
  });
});
