import { classes, subclasses } from '@daggerheart/srd-data';
import { describe, expect, it } from 'vitest';

import {
  applyChoice,
  availableOptions,
  createInitialState,
  findAncestry,
  finalize,
  IncompleteCharacterError,
  isComplete,
  validateStep,
  type CreationState,
} from '../src/index.js';
import { buildCharacter, tier1Weapon, VALID_TRAITS } from './helpers.js';

describe('createInitialState', () => {
  it('starts empty on step 1 with nothing completed', () => {
    const state = createInitialState();
    expect(state.currentStep).toBe(1);
    expect(state.classId).toBeNull();
    expect(state.experiences).toEqual([]);
    // Step 9 has no required content, so it validates trivially from the start.
    expect(state.completed['1']).toBe(false);
    expect(isComplete(state)).toBe(false);
  });
});

describe('full creation', () => {
  it('builds and finalizes a valid PC for all 9 classes', () => {
    expect(classes).toHaveLength(9);
    for (const characterClass of classes) {
      const state = buildCharacter(characterClass.id);
      expect(isComplete(state), `${characterClass.id} incomplete`).toBe(true);

      const character = finalize(state);
      expect(character.classId, characterClass.id).toBe(characterClass.id);
      expect(character.level).toBe(1);
      expect(character.proficiency).toBe(1);
      expect(character.hope).toBe(2);
      expect(character.stressSlots).toBe(6);
      // Evasion and HP come from the class.
      expect(character.evasion).toBe(characterClass.startingEvasion);
      expect(character.hpSlots).toBe(characterClass.startingHP);
      expect(character.domainCards).toHaveLength(2);
      expect(Object.values(character.experiences)).toEqual([2, 2]);
    }
  });

  it('builds both subclasses of every class', () => {
    for (const characterClass of classes) {
      for (const index of [0, 1] as const) {
        const state = buildCharacter(characterClass.id, { subclassIndex: index });
        expect(isComplete(state), `${characterClass.id}[${index}]`).toBe(true);
        expect(() => finalize(state)).not.toThrow();
      }
    }
  });

  it('derives damage thresholds from armor base plus level', () => {
    const state = buildCharacter('bard');
    const character = finalize(state);
    const options = availableOptions(state, 5);
    const equipped = options.armor.find((a) => a.id === character.equipment.armorId);
    expect(equipped).toBeDefined();
    if (!equipped) return;
    expect(character.major).toBe(equipped.baseThresholds.major + 1);
    expect(character.severe).toBe(equipped.baseThresholds.severe + 1);
    expect(character.thresholds).toEqual({ major: character.major, severe: character.severe });
  });

  it('gives every character the SRD starting inventory', () => {
    const character = finalize(buildCharacter('warrior'));
    expect(character.inventory).toContain('A torch');
    expect(character.inventory).toContain('50 feet of rope');
    expect(character.inventory).toContain('Basic supplies');
    expect(character.inventory).toContain('A handful of gold');
    expect(character.inventory.some((i) => i.includes('Minor Health Potion'))).toBe(true);
    // Warrior subclasses have no Spellcast trait, so no spell-carrier item.
    expect(character.equipment.spellCarrier).toBeNull();
  });

  it('gives a spellcasting character a spell-carrier item', () => {
    const character = finalize(buildCharacter('wizard'));
    expect(character.equipment.spellCarrier).not.toBeNull();
    expect(character.inventory).toContain(character.equipment.spellCarrier);
  });
});

describe('step 1 — class and subclass', () => {
  it('rejects a subclass belonging to another class', () => {
    let state = createInitialState();
    state = applyChoice(state, { type: 'chooseClass', classId: 'bard' });
    state = applyChoice(state, { type: 'chooseSubclass', subclassId: 'stalwart' });

    const result = validateStep(state, 1);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('subclassMismatch');
  });

  it('offers only the chosen class’s two subclasses', () => {
    let state = createInitialState();
    expect(availableOptions(state, 1).subclasses).toHaveLength(0);

    state = applyChoice(state, { type: 'chooseClass', classId: 'druid' });
    const offered = availableOptions(state, 1).subclasses;
    expect(offered.map((s) => s.id).sort()).toEqual(
      ['warden-of-renewal', 'warden-of-the-elements'].sort(),
    );
  });

  it('clears the subclass and domain cards when the class changes', () => {
    let state = buildCharacter('bard');
    expect(state.subclassId).not.toBeNull();
    state = applyChoice(state, { type: 'chooseClass', classId: 'wizard' });
    expect(state.subclassId).toBeNull();
    expect(state.domainCardIds).toEqual([]);
  });
});

describe('step 2 — heritage', () => {
  it('accepts a mixed ancestry taking one first-slot and one second-slot feature', () => {
    let state = createInitialState();
    state = applyChoice(state, {
      type: 'chooseMixedAncestry',
      first: { ancestryId: 'goblin', slot: 'first' },
      second: { ancestryId: 'orc', slot: 'second' },
    });
    state = applyChoice(state, { type: 'chooseCommunity', communityId: 'slyborne' });
    expect(validateStep(state, 2).ok).toBe(true);
  });

  it('rejects a mixed ancestry drawing both features from the same ancestry', () => {
    let state = createInitialState();
    state = applyChoice(state, {
      type: 'chooseMixedAncestry',
      first: { ancestryId: 'goblin', slot: 'first' },
      second: { ancestryId: 'goblin', slot: 'second' },
    });
    state = applyChoice(state, { type: 'chooseCommunity', communityId: 'slyborne' });

    const result = validateStep(state, 2);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('invalidMixedAncestry');
  });

  it('rejects taking two first-slot features (the SRD’s goblin-orc example)', () => {
    // "You can't take both the Surefooted and Sturdy features, because these are
    // both the first features listed on their respective ancestry cards" (SRD p.31).
    const goblinFirst = findAncestry('goblin')?.features.find((f) => f.slot === 'first');
    const orcFirst = findAncestry('orc')?.features.find((f) => f.slot === 'first');
    expect(goblinFirst?.name).toBe('Surefooted');
    expect(orcFirst?.name).toBe('Sturdy');

    let state = createInitialState();
    state = applyChoice(state, {
      type: 'chooseMixedAncestry',
      first: { ancestryId: 'goblin', slot: 'first' },
      second: { ancestryId: 'orc', slot: 'first' },
    });
    state = applyChoice(state, { type: 'chooseCommunity', communityId: 'slyborne' });

    const result = validateStep(state, 2);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('duplicateAncestrySlot');
  });

  it('rejects taking two second-slot features too', () => {
    let state = createInitialState();
    state = applyChoice(state, {
      type: 'chooseMixedAncestry',
      first: { ancestryId: 'goblin', slot: 'second' },
      second: { ancestryId: 'orc', slot: 'second' },
    });
    state = applyChoice(state, { type: 'chooseCommunity', communityId: 'slyborne' });
    expect(validateStep(state, 2).errors.map((e) => e.code)).toContain('duplicateAncestrySlot');
  });

  it('accepts the two picks given in either order', () => {
    let state = createInitialState();
    state = applyChoice(state, {
      type: 'chooseMixedAncestry',
      first: { ancestryId: 'orc', slot: 'second' },
      second: { ancestryId: 'goblin', slot: 'first' },
    });
    state = applyChoice(state, { type: 'chooseCommunity', communityId: 'slyborne' });
    expect(validateStep(state, 2).ok).toBe(true);
  });

  it('rejects an unknown community', () => {
    let state = createInitialState();
    state = applyChoice(state, { type: 'chooseAncestry', ancestryId: 'elf' });
    state = applyChoice(state, { type: 'chooseCommunity', communityId: 'nowhereborne' });

    const result = validateStep(state, 2);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('unknownCommunity');
  });
});

describe('step 3 — traits', () => {
  it('accepts the +2/+1/+1/+0/+0/−1 array in any order', () => {
    const state = applyChoice(createInitialState(), {
      type: 'assignTraits',
      traits: VALID_TRAITS,
    });
    expect(validateStep(state, 3).ok).toBe(true);
  });

  it('rejects an array that is not the SRD spread', () => {
    const state = applyChoice(createInitialState(), {
      type: 'assignTraits',
      traits: { ...VALID_TRAITS, knowledge: 2 },
    });
    const result = validateStep(state, 3);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('invalidTraitArray');
  });
});

describe('step 5 — equipment', () => {
  const equip = (
    state: CreationState,
    overrides: Partial<NonNullable<CreationState['equipment']>>,
  ) =>
    applyChoice(state, {
      type: 'chooseEquipment',
      equipment: {
        primaryWeaponId: 'broadsword',
        secondaryWeaponId: null,
        armorId: 'leather-armor',
        potion: 'health',
        classItem: 'A totem from your mentor',
        spellCarrier: null,
        ...overrides,
      },
    });

  it('rejects a two-handed primary alongside any secondary', () => {
    const twoHanded = tier1Weapon((w) => w.category === 'primary' && w.burden === 'twoHanded');
    const secondary = tier1Weapon((w) => w.category === 'secondary');

    let state = buildCharacter('guardian');
    state = equip(state, {
      primaryWeaponId: twoHanded.id,
      secondaryWeaponId: secondary.id,
    });

    const result = validateStep(state, 5);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('burdenExceeded');
  });

  it('accepts a one-handed primary with a one-handed secondary', () => {
    const oneHanded = tier1Weapon(
      (w) => w.category === 'primary' && w.burden === 'oneHanded' && w.damageType === 'physical',
    );
    const secondary = tier1Weapon((w) => w.category === 'secondary');

    let state = buildCharacter('guardian');
    state = equip(state, {
      primaryWeaponId: oneHanded.id,
      secondaryWeaponId: secondary.id,
    });
    expect(validateStep(state, 5).ok).toBe(true);
  });

  it('offers no secondary weapons once the primary is two-handed', () => {
    const twoHanded = tier1Weapon((w) => w.category === 'primary' && w.burden === 'twoHanded');
    let state = buildCharacter('guardian');
    state = equip(state, { primaryWeaponId: twoHanded.id });
    expect(availableOptions(state, 5).secondaryWeapons).toHaveLength(0);
  });

  it('makes magic weapons unavailable to a subclass with spellcastTrait null', () => {
    const guardianSubclasses = subclasses.filter((s) => s.classId === 'guardian');
    expect(guardianSubclasses.every((s) => s.spellcastTrait === null)).toBe(true);

    const state = buildCharacter('guardian');
    const offered = availableOptions(state, 5).primaryWeapons;
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.every((w) => w.damageType === 'physical')).toBe(true);
    expect(offered.some((w) => w.trait === 'spellcast')).toBe(false);

    // A spellcaster does get them.
    const wizardOffers = availableOptions(buildCharacter('wizard'), 5).primaryWeapons;
    expect(wizardOffers.some((w) => w.damageType === 'magic')).toBe(true);
  });

  it('rejects equipping a magic weapon without a Spellcast trait', () => {
    const magic = tier1Weapon((w) => w.category === 'primary' && w.damageType === 'magic');
    let state = buildCharacter('guardian');
    state = equip(state, { primaryWeaponId: magic.id });

    const result = validateStep(state, 5);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('spellcastRequired');
  });

  it('offers only Tier 1 gear and rejects anything higher', () => {
    const state = buildCharacter('guardian');
    const options = availableOptions(state, 5);
    expect(options.primaryWeapons.every((w) => w.tier === 1)).toBe(true);
    expect(options.armor.every((a) => a.tier === 1)).toBe(true);

    const higherTier = equip(state, { primaryWeaponId: 'improved-broadsword' });
    const result = validateStep(higherTier, 5);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('weaponTierTooHigh');
  });

  it('requires the class item to be one of the class’s two options', () => {
    const state = equip(buildCharacter('guardian'), { classItem: 'A borrowed sword' });
    const result = validateStep(state, 5);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('invalidClassItem');
  });

  it('requires a spell carrier for a spellcaster and refuses one otherwise', () => {
    const missing = applyChoice(buildCharacter('wizard'), {
      type: 'chooseEquipment',
      equipment: {
        primaryWeaponId: 'broadsword',
        secondaryWeaponId: null,
        armorId: 'leather-armor',
        potion: 'health',
        classItem: 'A book you’re trying to translate',
        spellCarrier: null,
      },
    });
    expect(validateStep(missing, 5).errors.map((e) => e.code)).toContain('spellCarrierRequired');

    const extra = equip(buildCharacter('guardian'), { spellCarrier: 'A stick' });
    expect(validateStep(extra, 5).errors.map((e) => e.code)).toContain(
      'spellCarrierNotApplicable',
    );
  });
});

describe('step 7 — experiences', () => {
  const withExperiences = (experiences: { name: string; modifier: number }[]) =>
    applyChoice(createInitialState(), { type: 'setExperiences', experiences });

  it('requires exactly two', () => {
    expect(
      withExperiences([{ name: 'Sailor', modifier: 2 }]),
    ).toSatisfy((s: CreationState) =>
      validateStep(s, 7).errors.some((e) => e.code === 'experienceCount'),
    );
  });

  it('rejects an empty name', () => {
    const state = withExperiences([
      { name: '   ', modifier: 2 },
      { name: 'Sailor', modifier: 2 },
    ]);
    expect(validateStep(state, 7).errors.map((e) => e.code)).toContain('emptyExperience');
  });

  it('rejects a modifier other than +2', () => {
    const state = withExperiences([
      { name: 'Sailor', modifier: 3 },
      { name: 'Cook', modifier: 2 },
    ]);
    expect(validateStep(state, 7).errors.map((e) => e.code)).toContain('experienceModifier');
  });
});

describe('step 8 — domain cards', () => {
  it('offers a Bard only level-1 Codex and Grace cards', () => {
    const state = buildCharacter('bard');
    const offered = availableOptions(state, 8).cards;

    expect(offered.length).toBeGreaterThan(0);
    expect(offered.every((c) => c.level === 1)).toBe(true);
    expect([...new Set(offered.map((c) => c.domain))].sort()).toEqual(['codex', 'grace']);
  });

  it('rejects a card from outside the class’s domains', () => {
    const state = applyChoice(buildCharacter('bard'), {
      type: 'chooseDomainCards',
      // "Get Back Up" is a Blade card; Bard has Codex and Grace.
      cardIds: ['get-back-up', 'not-good-enough'],
    });
    const result = validateStep(state, 8);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('domainCardOutOfDomain');
  });

  it('rejects a count other than two, and duplicates', () => {
    const one = applyChoice(buildCharacter('bard'), {
      type: 'chooseDomainCards',
      cardIds: [availableOptions(buildCharacter('bard'), 8).cards[0]?.id ?? ''],
    });
    expect(validateStep(one, 8).errors.map((e) => e.code)).toContain('domainCardCount');

    const first = availableOptions(buildCharacter('bard'), 8).cards[0]?.id ?? '';
    const dupe = applyChoice(buildCharacter('bard'), {
      type: 'chooseDomainCards',
      cardIds: [first, first],
    });
    expect(validateStep(dupe, 8).errors.map((e) => e.code)).toContain('duplicateDomainCard');
  });

  it('allows both cards from a single domain', () => {
    const graceCards = availableOptions(buildCharacter('bard'), 8)
      .cards.filter((c) => c.domain === 'grace')
      .slice(0, 2);
    expect(graceCards).toHaveLength(2);

    const state = applyChoice(buildCharacter('bard'), {
      type: 'chooseDomainCards',
      cardIds: graceCards.map((c) => c.id),
    });
    expect(validateStep(state, 8).ok).toBe(true);
  });
});

describe('finalize', () => {
  it('throws with the outstanding errors when creation is incomplete', () => {
    const state = createInitialState();
    expect(() => finalize(state)).toThrow(IncompleteCharacterError);
    try {
      finalize(state);
    } catch (error) {
      expect(error).toBeInstanceOf(IncompleteCharacterError);
      if (error instanceof IncompleteCharacterError) {
        expect(error.errors.map((e) => e.step)).toContain(1);
      }
    }
  });
});
