import { seededRng, type Rng } from '@daggerheart/rules';
import { srd } from '@daggerheart/srd-data';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  applyRoomEvent,
  claimCharacterInRoom,
  createRoomState,
  createScene,
  createSheet,
  recallCostOf,
  roomForRole,
  RoomStateSchema,
  type Actor,
  type RoomEvent,
  type RoomState,
  type SheetState,
  type Token,
} from '../src/index.js';

import { makeCharacter } from './helpers.js';

/**
 * `applyRoomEvent` is the one place room state changes, permissions included, so
 * these cover both what each intent does and who is allowed to send it.
 */

const GM: Actor = { id: 'gm-1', role: 'gm' };
const ALEX: Actor = { id: 'acc-alex', role: 'player' };
const SAM: Actor = { id: 'acc-sam', role: 'player' };

const rng: Rng = seededRng(42);
const NOW = 1_700_000_000_000;

/** A room with a GM, two seated players, and a claimed character for each. */
function roomWithPlayers(): RoomState {
  const base = createRoomState('c-1', { id: GM.id, name: 'GM', connected: true });
  const sheet = (): SheetState => createSheet(makeCharacter());
  return {
    ...base,
    players: [
      { id: ALEX.id, name: 'Alex', connected: true, characterId: ALEX.id },
      { id: SAM.id, name: 'Sam', connected: true, characterId: SAM.id },
    ],
    characters: { [ALEX.id]: sheet(), [SAM.id]: sheet() },
  };
}

/** Applies an event and fails the test if it was rejected. */
function apply(state: RoomState, actor: Actor, event: RoomEvent): RoomState {
  const result = applyRoomEvent(state, actor, event, rng, NOW);
  if (!result.ok) throw new Error(`rejected: ${result.error} ${result.message}`);
  return result.state;
}

/** Applies an event expecting a refusal, and returns the error code. */
function refusal(state: RoomState, actor: Actor, event: RoomEvent): string {
  const result = applyRoomEvent(state, actor, event, rng, NOW);
  if (result.ok) throw new Error(`expected a refusal, got a new state`);
  return result.error;
}

describe('character permissions', () => {
  let room: RoomState;
  beforeEach(() => {
    room = roomWithPlayers();
  });

  it('lets a player act on their own character', () => {
    const next = apply(room, ALEX, { type: 'markStress', characterId: ALEX.id, amount: 1 });
    expect(next.characters[ALEX.id]?.stressMarked).toBe(1);
  });

  it('refuses a player acting on somebody else’s character', () => {
    expect(refusal(room, ALEX, { type: 'markStress', characterId: SAM.id, amount: 1 })).toBe(
      'notYourCharacter',
    );
  });

  it('lets the GM act on any character', () => {
    const next = apply(room, GM, { type: 'markHP', characterId: SAM.id, amount: 2 });
    expect(next.characters[SAM.id]?.hpMarked).toBe(2);
  });

  it('refuses an intent for a character that is not in the room', () => {
    expect(refusal(room, GM, { type: 'markHP', characterId: 'nobody', amount: 1 })).toBe(
      'unknownCharacter',
    );
  });

  it.each([
    ['gainFear', { type: 'gainFear', amount: 1 }],
    ['setSpotlight', { type: 'setSpotlight', spotlight: 'acc-alex' }],
    ['setEnvironment', { type: 'setEnvironment', environmentId: null }],
    ['removeCountdown', { type: 'removeCountdown', id: 'x' }],
  ] as const)('refuses %s from a player', (_name, event) => {
    expect(refusal(room, ALEX, event as RoomEvent)).toBe('notGameMaster');
  });
});

describe('gold, cards and level-up', () => {
  let room: RoomState;
  beforeEach(() => {
    room = roomWithPlayers();
  });

  it('converts ten handfuls into a bag', () => {
    let next = room;
    for (let i = 0; i < 10; i += 1) {
      next = apply(next, ALEX, { type: 'gainGold', characterId: ALEX.id, amount: 1, unit: 'handfuls' });
    }
    const gold = next.characters[ALEX.id]?.gold;
    expect(gold?.bags).toBe(1);
    expect(gold?.handfuls).toBeLessThan(10);
  });

  it('leaves the purse alone when there is not enough gold, and says so', () => {
    // Shortfalls are reported as an effect rather than a rejection, the same way a
    // missing Armor Slot is: the intent is valid, it just could not be paid.
    const result = applyRoomEvent(
      room,
      ALEX,
      { type: 'spendGold', characterId: ALEX.id, amount: 5, unit: 'chests' },
      rng,
      NOW,
    );
    if (!result.ok) throw new Error('expected an effect, not a refusal');
    expect(result.effect?.code).toBe('notEnoughGold');
    expect(result.state.characters[ALEX.id]?.gold).toEqual(room.characters[ALEX.id]?.gold);
  });

  it('vaults a card and recalls it at the card’s own Recall Cost', () => {
    const cardId = room.characters[ALEX.id]?.loadout[0];
    if (cardId === undefined) throw new Error('no card in the starting loadout');

    let next = apply(room, ALEX, { type: 'vaultCard', characterId: ALEX.id, cardId });
    expect(next.characters[ALEX.id]?.vault).toContain(cardId);

    next = apply(next, ALEX, { type: 'recallCard', characterId: ALEX.id, cardId });
    // The cost is read from the SRD, never from the intent.
    expect(next.characters[ALEX.id]?.stressMarked).toBe(recallCostOf(cardId));
    expect(next.characters[ALEX.id]?.loadout).toContain(cardId);
  });

  it('recalls for free while the party is resting', () => {
    const cardId = room.characters[ALEX.id]?.loadout[0];
    if (cardId === undefined) throw new Error('no card in the starting loadout');
    let next = apply(room, ALEX, { type: 'vaultCard', characterId: ALEX.id, cardId });
    next = apply(next, GM, { type: 'beginRest', kind: 'short' });
    next = apply(next, ALEX, { type: 'recallCard', characterId: ALEX.id, cardId });
    expect(next.characters[ALEX.id]?.stressMarked).toBe(0);
  });

  it('levels a character up through the rules engine', () => {
    const next = apply(room, ALEX, {
      type: 'levelUp',
      characterId: ALEX.id,
      choices: { advancements: ['hitPoint', 'stress'] },
    });
    const character = next.characters[ALEX.id]?.character;
    expect(character?.level).toBe(2);
    expect(character?.hpSlots).toBeGreaterThan(room.characters[ALEX.id]?.character.hpSlots ?? 0);
  });
});

describe('rolls are server-side and read from the sheet', () => {
  let room: RoomState;
  beforeEach(() => {
    room = roomWithPlayers();
  });

  it('logs a duality roll and hands Fear to the GM when it rolls with Fear', () => {
    const result = applyRoomEvent(
      room,
      ALEX,
      {
        type: 'rollDuality',
        visibility: 'public',
        characterId: ALEX.id,
        request: {
          label: 'Agility Roll',
          modifiers: 0,
          difficulty: 10,
          advantage: 0,
          disadvantage: 0,
          helpDice: 0,
          reaction: false,
          experiences: [],
        },
      },
      rng,
      NOW,
    );
    if (!result.ok) throw new Error('roll was rejected');
    expect(result.entries).toHaveLength(1);
    expect(result.state.rollLog).toHaveLength(1);
    // Every roll is either with Hope or with Fear, so exactly one of these moved.
    const withFear = result.state.fear > room.fear;
    const withHope = (result.state.characters[ALEX.id]?.hope ?? 0) > (room.characters[ALEX.id]?.hope ?? 0);
    expect(withFear || withHope).toBe(true);
  });

  it('earns no Hope or Fear on a reaction roll', () => {
    const result = applyRoomEvent(
      room,
      ALEX,
      {
        type: 'rollDuality',
        visibility: 'public',
        characterId: ALEX.id,
        request: {
          label: 'Dodge',
          modifiers: 0,
          difficulty: 5,
          advantage: 0,
          disadvantage: 0,
          helpDice: 0,
          reaction: true,
          experiences: [],
        },
      },
      rng,
      NOW,
    );
    if (!result.ok) throw new Error('the reaction roll was rejected');
    expect(result.state.fear).toBe(room.fear);
    expect(result.state.characters[ALEX.id]?.hope).toBe(room.characters[ALEX.id]?.hope);
    const entry = result.entries[0];
    if (entry === undefined || entry.kind !== 'duality') throw new Error('no duality entry');
    expect(entry.reaction).toBe(true);
  });

  it('refuses a roll naming an Experience the character does not have', () => {
    expect(
      refusal(room, ALEX, {
        type: 'rollDuality',
        visibility: 'public',
        characterId: ALEX.id,
        request: {
          label: 'Bogus',
          modifiers: 0,
          difficulty: 10,
          advantage: 0,
          disadvantage: 0,
          helpDice: 0,
          reaction: false,
          experiences: ['Dragon Rider'],
        },
      }),
    ).toBe('rejected');
  });

  it('rolls damage with the character’s own Proficiency', () => {
    const result = applyRoomEvent(
      room,
      ALEX,
      {
        type: 'rollDamage',
        visibility: 'public',
        characterId: ALEX.id,
        label: 'Longsword',
        dice: { count: 1, die: 8 },
        modifier: 0,
        critical: false,
      },
      rng,
      NOW,
    );
    if (!result.ok) throw new Error('damage roll was rejected');
    const entry = result.entries[0];
    if (entry === undefined || entry.kind !== 'damage') throw new Error('no damage entry');
    // A level-1 character has Proficiency 1, so one die is rolled.
    expect(entry.roll.rolls).toHaveLength(room.characters[ALEX.id]?.character.proficiency ?? 0);
  });
});

describe('what a player is allowed to see', () => {
  it('hides how hurt an adversary is', () => {
    const base = roomWithPlayers();
    const adversary = srd().adversaries[0];
    if (adversary === undefined) throw new Error('no adversaries in the SRD data');

    let room = apply(base, GM, {
      type: 'addAdversary',
      instanceId: 'a-1',
      adversaryId: adversary.id,
      name: 'Guard A',
    });
    room = apply(room, GM, { type: 'updateAdversary', instanceId: 'a-1', hpMarked: 3, stressMarked: 1 });

    expect(roomForRole(room, 'gm').adversaryInstances[0]?.hpMarked).toBe(3);

    const forPlayer = roomForRole(room, 'player');
    expect(forPlayer.adversaryInstances[0]?.name).toBe('Guard A');
    expect(forPlayer.adversaryInstances[0]?.hpMarked).toBe(0);
    expect(forPlayer.adversaryInstances[0]?.stressMarked).toBe(0);
  });

  it('clamps adversary damage to its stat block', () => {
    const adversary = srd().adversaries[0];
    if (adversary === undefined) throw new Error('no adversaries in the SRD data');

    let room = apply(roomWithPlayers(), GM, {
      type: 'addAdversary',
      instanceId: 'a-1',
      adversaryId: adversary.id,
      name: 'Guard A',
    });
    room = apply(room, GM, { type: 'updateAdversary', instanceId: 'a-1', hpMarked: 99, stressMarked: 99 });

    expect(room.adversaryInstances[0]?.hpMarked).toBe(adversary.hp);
    expect(room.adversaryInstances[0]?.stressMarked).toBe(adversary.stress);
  });
});

describe('conditions', () => {
  let room: RoomState;
  beforeEach(() => {
    room = roomWithPlayers();
  });

  it('applies the standard conditions to a character', () => {
    const next = apply(room, ALEX, {
      type: 'setConditions',
      characterId: ALEX.id,
      conditions: ['hidden', 'restrained'],
    });
    expect(next.characters[ALEX.id]?.conditions).toEqual(['hidden', 'restrained']);
  });

  it('never applies the same condition twice', () => {
    const next = apply(room, ALEX, {
      type: 'setConditions',
      characterId: ALEX.id,
      conditions: ['hidden', 'hidden', ' hidden '],
    });
    expect(next.characters[ALEX.id]?.conditions).toEqual(['hidden']);
  });

  it('keeps a condition a feature invented, as the text it printed', () => {
    const next = apply(room, GM, {
      type: 'setConditions',
      characterId: SAM.id,
      conditions: ['Ablaze'],
    });
    expect(next.characters[SAM.id]?.conditions).toEqual(['Ablaze']);
  });

  it('refuses a player setting conditions on somebody else', () => {
    expect(
      refusal(room, ALEX, { type: 'setConditions', characterId: SAM.id, conditions: ['hidden'] }),
    ).toBe('notYourCharacter');
  });
});

describe('Hope features and inventory', () => {
  let room: RoomState;
  beforeEach(() => {
    room = roomWithPlayers();
  });

  it('spends three Hope on a class Hope feature', () => {
    // Characters start with 2 Hope, so one has to be earned first.
    const ready = apply(room, ALEX, { type: 'gainHope', characterId: ALEX.id, amount: 1 });
    const before = ready.characters[ALEX.id]?.hope ?? 0;
    const next = apply(ready, ALEX, { type: 'useHopeFeature', characterId: ALEX.id });
    expect(next.characters[ALEX.id]?.hope).toBe(before - 3);
  });

  it('refuses one the character cannot afford', () => {
    expect(refusal(room, ALEX, { type: 'useHopeFeature', characterId: ALEX.id })).toBe('rejected');
  });

  it('lets a player keep their own inventory after creation', () => {
    const next = apply(room, ALEX, {
      type: 'setInventory',
      characterId: ALEX.id,
      inventory: ['A rope', '  ', 'A lantern'],
    });
    // Blank lines are dropped rather than stored.
    expect(next.characters[ALEX.id]?.character.inventory).toEqual(['A rope', 'A lantern']);
  });

  it('refuses inventory edits made for somebody else', () => {
    expect(
      refusal(room, ALEX, { type: 'setInventory', characterId: SAM.id, inventory: [] }),
    ).toBe('notYourCharacter');
  });
});

describe('changing equipment in play', () => {
  let room: RoomState;
  beforeEach(() => {
    room = roomWithPlayers();
  });

  it('rebuilds the Armor Score and thresholds from the piece worn', () => {
    const armor = srd().armor.find((a) => a.tier === 2);
    if (armor === undefined) throw new Error('no tier 2 armor in the SRD data');

    const next = apply(room, ALEX, {
      type: 'equipArmor',
      characterId: ALEX.id,
      armorId: armor.id,
    });
    const character = next.characters[ALEX.id]?.character;
    expect(character?.armorScore).toBe(armor.baseScore);
    expect(character?.thresholds.major).toBe(armor.baseThresholds.major + (character?.level ?? 1));
    // The two copies the schema insists agree.
    expect(character?.major).toBe(character?.thresholds.major);
  });

  it('leaves no Armor Slots marked, since the slots belong to the piece', () => {
    let next = apply(room, GM, { type: 'markArmorSlot', characterId: ALEX.id, amount: 2 });
    expect(next.characters[ALEX.id]?.armorSlotsMarked).toBe(2);

    const armor = srd().armor[1];
    if (armor === undefined) throw new Error('no second armor in the SRD data');
    next = apply(next, ALEX, { type: 'equipArmor', characterId: ALEX.id, armorId: armor.id });
    expect(next.characters[ALEX.id]?.armorSlotsMarked).toBe(0);
  });

  it('takes armor off, leaving level-based thresholds and no slots', () => {
    const next = apply(room, ALEX, { type: 'equipArmor', characterId: ALEX.id, armorId: null });
    const character = next.characters[ALEX.id]?.character;
    expect(character?.armorScore).toBe(0);
    expect(character?.thresholds).toEqual({
      major: character?.level,
      severe: (character?.level ?? 1) * 2,
    });
  });

  it('charges a Stress for a weapon swap outside a rest, and nothing during one', () => {
    const weapon = srd().weapons.find((w) => w.category === 'primary' && w.burden === 'oneHanded');
    if (weapon === undefined) throw new Error('no one-handed primary weapon');

    const swapped = apply(room, ALEX, {
      type: 'equipWeapon',
      characterId: ALEX.id,
      slot: 'primary',
      weaponId: weapon.id,
    });
    expect(swapped.characters[ALEX.id]?.stressMarked).toBe(1);
    expect(swapped.characters[ALEX.id]?.character.equipment.primaryWeaponId).toBe(weapon.id);

    const resting = apply(room, GM, { type: 'beginRest', kind: 'short' });
    const free = apply(resting, ALEX, {
      type: 'equipWeapon',
      characterId: ALEX.id,
      slot: 'primary',
      weaponId: weapon.id,
    });
    expect(free.characters[ALEX.id]?.stressMarked).toBe(0);
  });

  it('refuses a second weapon alongside a two-handed one', () => {
    const twoHanded = srd().weapons.find(
      (w) => w.category === 'primary' && w.burden === 'twoHanded',
    );
    const secondary = srd().weapons.find((w) => w.category === 'secondary');
    if (twoHanded === undefined || secondary === undefined) throw new Error('missing weapons');

    const armed = apply(room, GM, { type: 'beginRest', kind: 'short' });
    const withBig = apply(armed, ALEX, {
      type: 'equipWeapon',
      characterId: ALEX.id,
      slot: 'primary',
      weaponId: twoHanded.id,
    });
    expect(
      refusal(withBig, ALEX, {
        type: 'equipWeapon',
        characterId: ALEX.id,
        slot: 'secondary',
        weaponId: secondary.id,
      }),
    ).toBe('rejected');
  });

  it('refuses equipment that is not in the SRD, and changes made for somebody else', () => {
    expect(
      refusal(room, ALEX, { type: 'equipArmor', characterId: ALEX.id, armorId: 'plot-armor' }),
    ).toBe('rejected');

    expect(
      refusal(room, ALEX, { type: 'equipArmor', characterId: SAM.id, armorId: null }),
    ).toBe('notYourCharacter');
  });
});

describe('transformations', () => {
  let room: RoomState;
  beforeEach(() => {
    room = roomWithPlayers();
  });

  it('carries one transformation, and puts it down again', () => {
    const transformation = srd().transformations[0];
    if (transformation === undefined) throw new Error('no transformations in the SRD data');

    let next = apply(room, ALEX, {
      type: 'setTransformation',
      characterId: ALEX.id,
      transformation: transformation.id,
    });
    expect(next.characters[ALEX.id]?.transformation).toBe(transformation.id);

    next = apply(next, ALEX, {
      type: 'setTransformation',
      characterId: ALEX.id,
      transformation: null,
    });
    expect(next.characters[ALEX.id]?.transformation).toBeNull();
  });

  it('refuses one that is not in the SRD, and one set for somebody else', () => {
    expect(
      refusal(room, ALEX, {
        type: 'setTransformation',
        characterId: ALEX.id,
        transformation: 'lich-king',
      }),
    ).toBe('unknownTransformation');

    expect(
      refusal(room, ALEX, {
        type: 'setTransformation',
        characterId: SAM.id,
        transformation: 'ghost',
      }),
    ).toBe('notYourCharacter');
  });
});

describe('the GM rolling for an adversary', () => {
  let room: RoomState;
  let adversaryId: string;

  beforeEach(() => {
    const adversary = srd().adversaries.find((a) => a.attackModifier.flat !== null);
    if (adversary === undefined) throw new Error('no adversary with a flat attack modifier');
    adversaryId = adversary.id;
    room = apply(roomWithPlayers(), GM, {
      type: 'addAdversary',
      instanceId: 'a-1',
      adversaryId: adversary.id,
      name: 'Guard A',
    });
  });

  it('rolls a d20 against the target Evasion and logs it for the table', () => {
    const result = applyRoomEvent(
      room,
      GM,
      {
        type: 'rollAdversaryAttack',
        visibility: 'public',
        instanceId: 'a-1',
        targetId: ALEX.id,
        advantage: false,
        disadvantage: false,
      },
      rng,
      NOW,
    );
    if (!result.ok) throw new Error('the attack was rejected');
    const entry = result.entries[0];
    if (entry === undefined || entry.kind !== 'attack') throw new Error('no attack entry');

    const block = srd().adversaries.find((a) => a.id === adversaryId);
    expect(entry.roll.modifier).toBe(block?.attackModifier.flat);
    expect(entry.evasion).toBe(room.characters[ALEX.id]?.character.evasion);
    expect(typeof entry.roll.success).toBe('boolean');
    expect(result.state.rollLog).toHaveLength(1);
  });

  it('leaves the outcome open when no target is named', () => {
    const result = applyRoomEvent(
      room,
      GM,
      { type: 'rollAdversaryAttack', instanceId: 'a-1', advantage: false, disadvantage: false, visibility: 'public' },
      rng,
      NOW,
    );
    if (!result.ok) throw new Error('the attack was rejected');
    const entry = result.entries[0];
    if (entry === undefined || entry.kind !== 'attack') throw new Error('no attack entry');
    expect(entry.roll.success).toBeNull();
    expect(entry.evasion).toBeNull();
  });

  it('spends a Fear to add an Experience, and refuses one the adversary lacks', () => {
    const block = srd().adversaries.find((a) => a.id === adversaryId);
    const experience = block?.experiences[0];
    if (experience === undefined) throw new Error('that adversary has no Experience');

    const withFear = apply(room, GM, { type: 'gainFear', amount: 2 });
    const spent = apply(withFear, GM, {
      type: 'rollAdversaryAttack',
      visibility: 'public',
      instanceId: 'a-1',
      advantage: false,
      disadvantage: false,
      experience: experience.name,
    });
    expect(spent.fear).toBe(withFear.fear - 1);

    expect(
      refusal(withFear, GM, {
        type: 'rollAdversaryAttack',
        visibility: 'public',
        instanceId: 'a-1',
        advantage: false,
        disadvantage: false,
        experience: 'Not A Real Experience',
      }),
    ).toBe('unknownExperience');
  });

  it('refuses to spend a Fear that is not there', () => {
    expect(
      refusal(room, GM, {
        type: 'rollAdversaryAttack',
        visibility: 'public',
        instanceId: 'a-1',
        advantage: false,
        disadvantage: false,
        experience: srd().adversaries.find((a) => a.id === adversaryId)?.experiences[0]?.name,
      }),
    ).toBe('notEnoughFear');
  });

  it('rolls the stat block damage, and refuses both rolls from a player', () => {
    const result = applyRoomEvent(
      room,
      GM,
      { type: 'rollAdversaryDamage', instanceId: 'a-1', critical: false, visibility: 'public' },
      rng,
      NOW,
    );
    if (!result.ok) throw new Error('the damage roll was rejected');
    const entry = result.entries[0];
    if (entry === undefined || entry.kind !== 'damage') throw new Error('no damage entry');
    expect(entry.roll.total).toBeGreaterThan(0);

    expect(
      refusal(room, ALEX, {
        type: 'rollAdversaryDamage',
        visibility: 'public',
        instanceId: 'a-1',
        critical: false,
      }),
    ).toBe('notGameMaster');
  });

  it('spends the Fear a feature costs, and refuses more than the pool holds', () => {
    const block = srd().adversaries.find((a) => a.id === adversaryId);
    const feature = block?.features[0];
    if (feature === undefined) throw new Error('that adversary has no features');

    const withFear = apply(room, GM, { type: 'gainFear', amount: 3 });
    const used = apply(withFear, GM, {
      type: 'useAdversaryFeature',
      instanceId: 'a-1',
      featureName: feature.name,
      fearCost: 2,
    });
    expect(used.fear).toBe(withFear.fear - 2);

    expect(
      refusal(room, GM, {
        type: 'useAdversaryFeature',
        instanceId: 'a-1',
        featureName: feature.name,
        fearCost: 5,
      }),
    ).toBe('notEnoughFear');
  });

  it('lets an Evolution be used once, and refuses it after that', () => {
    const evolving = srd().adversaries.find((a) =>
      a.features.some((f) => f.type === 'evolution'),
    );
    const evolution = evolving?.features.find((f) => f.type === 'evolution');
    if (evolving === undefined || evolution === undefined) {
      throw new Error('no adversary with an Evolution feature');
    }

    let next = apply(roomWithPlayers(), GM, {
      type: 'addAdversary',
      instanceId: 'a-2',
      adversaryId: evolving.id,
      name: 'It',
    });
    next = apply(next, GM, {
      type: 'useAdversaryFeature',
      instanceId: 'a-2',
      featureName: evolution.name,
      fearCost: 0,
    });
    expect(next.adversaryInstances[0]?.usedFeatures).toEqual([evolution.name]);

    expect(
      refusal(next, GM, {
        type: 'useAdversaryFeature',
        instanceId: 'a-2',
        featureName: evolution.name,
        fearCost: 0,
      }),
    ).toBe('featureSpent');
  });

  it('sets a countdown outright, which is how a miscount is corrected', () => {
    const room = roomWithPlayers();
    const added = apply(room, GM, {
      type: 'addCountdown',
      id: 'cd-1',
      name: 'Reinforcements',
      startingValue: 4,
      kind: 'standard',
      loop: 'none',
    });

    const backedOff = apply(added, GM, { type: 'setCountdownValue', id: 'cd-1', value: 6 });
    expect(backedOff.countdowns[0]?.value).toBe(6);
    expect(backedOff.countdowns[0]?.triggered).toBe(false);

    // Set to zero and the countdown reads as triggered, the same as running out.
    const spent = apply(added, GM, { type: 'setCountdownValue', id: 'cd-1', value: 0 });
    expect(spent.countdowns[0]?.triggered).toBe(true);

    expect(refusal(added, ALEX, { type: 'setCountdownValue', id: 'cd-1', value: 1 })).toBe(
      'notGameMaster',
    );
    expect(refusal(added, GM, { type: 'setCountdownValue', id: 'nope', value: 1 })).toBe(
      'unknownCountdown',
    );
  });

  it('rolls fate and hazards into the log, and only for the GM', () => {
    const room = roomWithPlayers();
    expect(refusal(room, ALEX, { type: 'rollFate', kind: 'fate', label: 'Fire', visibility: 'public' })).toBe(
      'notGameMaster',
    );

    const rolled = applyRoomEvent(
      room,
      GM,
      { type: 'rollFate', kind: 'fallClose', label: 'Off the wall', visibility: 'public' },
      rng,
      NOW,
    );
    if (!rolled.ok) throw new Error('the hazard roll was rejected');
    const entry = rolled.entries[0];
    if (entry === undefined || entry.kind !== 'fate') throw new Error('no fate entry');
    // A Close fall is 1d20+5.
    expect(entry.value).toBeGreaterThanOrEqual(6);
    expect(entry.value).toBeLessThanOrEqual(25);
    expect(entry.label).toBe('Off the wall');
  });

  it('keeps named adversary pools, and clears them all when a scene ends', () => {
    const room = roomWithPlayers();
    expect(refusal(room, ALEX, { type: 'setAdversaryPool', name: 'Swarm', tokens: 1 })).toBe(
      'notGameMaster',
    );

    const added = apply(room, GM, { type: 'setAdversaryPool', name: 'Swarm', tokens: 0 });
    const filled = apply(added, GM, { type: 'setAdversaryPool', name: 'Swarm', tokens: 3 });
    expect(filled.adversaryPools).toEqual([{ name: 'Swarm', tokens: 3 }]);

    const removed = apply(filled, GM, { type: 'setAdversaryPool', name: 'Swarm', tokens: null });
    expect(removed.adversaryPools).toEqual([]);

    const two = apply(apply(filled, GM, { type: 'setAdversaryPool', name: 'Hive', tokens: 1 }), GM, {
      type: 'clearAdversaryPools',
    });
    expect(two.adversaryPools).toEqual([]);
  });

  it('spends a spotlight token per action roll and refills when everyone is out', () => {
    const room = roomWithPlayers();
    expect(
      refusal(room, ALEX, { type: 'setSpotlightTracker', tokensPerPlayer: 3 }),
    ).toBe('notGameMaster');

    const on = apply(room, GM, { type: 'setSpotlightTracker', tokensPerPlayer: 1 });
    expect(on.spotlightTokens?.left).toEqual({ [ALEX.id]: 1, [SAM.id]: 1 });

    const request = {
      label: 'Act',
      modifiers: 0,
      difficulty: 10,
      advantage: 0,
      disadvantage: 0,
      experiences: [],
      helpDice: 0,
      reaction: false,
    };

    const acted = apply(on, ALEX, { type: 'rollDuality', characterId: ALEX.id, request, visibility: 'public' });
    expect(acted.spotlightTokens?.left[ALEX.id]).toBe(0);

    // The spotlight cannot swing to a player who is out of tokens.
    expect(refusal(acted, GM, { type: 'setSpotlight', spotlight: ALEX.id })).toBe(
      'noSpotlightTokens',
    );

    // The last token spent refills everybody.
    const refilled = apply(acted, SAM, { type: 'rollDuality', characterId: SAM.id, request, visibility: 'public' });
    expect(refilled.spotlightTokens?.left).toEqual({ [ALEX.id]: 1, [SAM.id]: 1 });

    // A reaction roll is not taking an action, so it costs no token.
    const reacted = apply(refilled, ALEX, {
      type: 'rollDuality',
      visibility: 'public',
      characterId: ALEX.id,
      request: { ...request, reaction: true },
    });
    expect(reacted.spotlightTokens?.left[ALEX.id]).toBe(1);

    expect(apply(on, GM, { type: 'setSpotlightTracker', tokensPerPlayer: null }).spotlightTokens)
      .toBeNull();
  });

  it('carries the group action bonus into the lead roll and then closes it', () => {
    const room = roomWithPlayers();
    const opened = apply(room, GM, { type: 'startGroupAction', leadCharacterId: ALEX.id });
    expect(refusal(room, ALEX, { type: 'startGroupAction', leadCharacterId: ALEX.id })).toBe(
      'notGameMaster',
    );

    const request = {
      label: 'Push the door',
      modifiers: 0,
      difficulty: 10,
      advantage: 0,
      disadvantage: 0,
      experiences: [],
      helpDice: 0,
      reaction: false,
    };

    // Sam collaborates: the roll is forced to be a reaction, and its outcome is kept.
    const helped = apply(opened, SAM, { type: 'rollDuality', characterId: SAM.id, request, visibility: 'public' });
    const recorded = helped.groupAction?.reactions[SAM.id];
    expect(typeof recorded).toBe('boolean');
    // The log is newest-first.
    const helpEntry = helped.rollLog[0];
    if (helpEntry === undefined || helpEntry.kind !== 'duality') throw new Error('no entry');
    expect(helpEntry.reaction).toBe(true);

    // Alex leads: the bonus lands in the roll's modifiers and the group action closes.
    const led = apply(helped, ALEX, { type: 'rollDuality', characterId: ALEX.id, request, visibility: 'public' });
    const leadEntry = led.rollLog[0];
    if (leadEntry === undefined || leadEntry.kind !== 'duality') throw new Error('no lead entry');
    expect(leadEntry.roll.modifiers).toBe(recorded === true ? 1 : -1);
    expect(leadEntry.reaction).toBe(false);
    expect(led.groupAction).toBeNull();

    expect(apply(opened, GM, { type: 'cancelGroupAction' }).groupAction).toBeNull();
  });

  it('holds both Tag Team rolls until the initiator picks one', () => {
    const room = roomWithPlayers();
    // A Tag Team Roll costs 3 Hope, and a character starts with 2.
    expect(
      refusal(room, ALEX, {
        type: 'startTagTeam',
        characterId: ALEX.id,
        partnerCharacterId: SAM.id,
      }),
    ).toBe('rejected');

    const funded = apply(room, ALEX, { type: 'gainHope', characterId: ALEX.id, amount: 2 });
    const opened = apply(funded, ALEX, {
      type: 'startTagTeam',
      characterId: ALEX.id,
      partnerCharacterId: SAM.id,
    });
    expect(opened.characters[ALEX.id]?.hope).toBe(1);
    expect(opened.tagTeam?.partnerId).toBe(SAM.id);

    const request = {
      label: 'Together',
      modifiers: 0,
      difficulty: 10,
      advantage: 0,
      disadvantage: 0,
      experiences: [],
      helpDice: 0,
      reaction: false,
    };

    // Neither roll pays out on its own.
    const first = apply(opened, ALEX, { type: 'rollDuality', characterId: ALEX.id, request, visibility: 'public' });
    expect(
      refusal(first, ALEX, { type: 'chooseTagTeam', characterId: ALEX.id, rollOf: ALEX.id }),
    ).toBe('rejected');
    const both = apply(first, SAM, { type: 'rollDuality', characterId: SAM.id, request, visibility: 'public' });
    expect(Object.keys(both.tagTeam?.rolls ?? {})).toHaveLength(2);
    expect(both.fear).toBe(opened.fear);

    expect(
      refusal(both, SAM, { type: 'chooseTagTeam', characterId: SAM.id, rollOf: SAM.id }),
    ).toBe('rejected');

    const outcome = both.tagTeam?.rolls[ALEX.id]?.outcome;
    if (outcome === undefined) throw new Error('no roll to choose');
    const chosen = apply(both, ALEX, {
      type: 'chooseTagTeam',
      characterId: ALEX.id,
      rollOf: ALEX.id,
    });
    expect(chosen.tagTeam).toBeNull();

    const hopeful = outcome === 'successFear' || outcome === 'failureFear' ? false : true;
    if (hopeful) {
      // Every PC involved gains a Hope.
      expect(chosen.characters[ALEX.id]?.hope).toBe((both.characters[ALEX.id]?.hope ?? 0) + 1);
      expect(chosen.characters[SAM.id]?.hope).toBe((both.characters[SAM.id]?.hope ?? 0) + 1);
    } else {
      // The GM gains a Fear per PC involved.
      expect(chosen.fear).toBe(both.fear + 2);
    }
  });

  it('takes a Beastform for a Stress, refuses one above the tier, and drops on the last HP', () => {
    const claimed = claimCharacterInRoom(
      roomWithPlayers(),
      ALEX.id,
      createSheet(makeCharacter('druid')),
    );
    const characterId = Object.keys(claimed.characters)[0];
    if (characterId === undefined) throw new Error('no character');

    const low = srd().beastforms.find((b) => b.tier === 1);
    const high = srd().beastforms.find((b) => b.tier === 4);
    if (low === undefined || high === undefined) throw new Error('no beastforms to test');

    const taken = apply(claimed, ALEX, {
      type: 'setBeastform',
      characterId,
      beastformId: low.id,
    });
    const sheet = taken.characters[characterId];
    expect(sheet?.beastform).toBe(low.id);
    expect(sheet?.stressMarked).toBe(1);

    expect(
      refusal(claimed, ALEX, { type: 'setBeastform', characterId, beastformId: high.id }),
    ).toBe('rejected');

    const dropped = apply(taken, ALEX, {
      type: 'setBeastform',
      characterId,
      beastformId: null,
    });
    expect(dropped.characters[characterId]?.beastform).toBeNull();

    // Marking the last Hit Point drops the character out of the form on its own.
    const hpSlots = sheet?.character.hpSlots ?? 0;
    const downed = apply(taken, ALEX, {
      type: 'markHP',
      characterId,
      amount: hpSlots,
    });
    expect(downed.characters[characterId]?.beastform).toBeNull();
  });

  it('spends Fear on an environment feature, and refuses one that is not there', () => {
    const environment = srd().environments.find((e) => e.features.length > 0);
    const feature = environment?.features[0];
    if (environment === undefined || feature === undefined) {
      throw new Error('no environment with features');
    }

    let next = apply(room, GM, { type: 'setEnvironment', environmentId: environment.id });
    next = apply(next, GM, { type: 'gainFear', amount: 3 });
    const before = next.fear;
    next = apply(next, GM, {
      type: 'useEnvironmentFeature',
      featureName: feature.name,
      fearCost: 2,
    });
    expect(next.fear).toBe(before - 2);

    expect(
      refusal(next, GM, {
        type: 'useEnvironmentFeature',
        featureName: 'Not A Real Feature',
        fearCost: 0,
      }),
    ).toBe('unknownFeature');

    expect(
      refusal(next, ALEX, {
        type: 'useEnvironmentFeature',
        featureName: feature.name,
        fearCost: 0,
      }),
    ).toBe('notGameMaster');

    // With no environment on the table there is nothing to use.
    expect(
      refusal(room, GM, {
        type: 'useEnvironmentFeature',
        featureName: feature.name,
        fearCost: 0,
      }),
    ).toBe('noEnvironment');
  });

  it('refuses a feature the adversary does not have, and any of this from a player', () => {
    expect(
      refusal(room, GM, {
        type: 'useAdversaryFeature',
        instanceId: 'a-1',
        featureName: 'Not A Real Feature',
        fearCost: 0,
      }),
    ).toBe('unknownFeature');

    expect(
      refusal(room, ALEX, {
        type: 'useAdversaryFeature',
        instanceId: 'a-1',
        featureName: 'Anything',
        fearCost: 0,
      }),
    ).toBe('notGameMaster');
  });

  it('refuses a roll for an adversary that is not in play', () => {
    expect(
      refusal(room, GM, {
        type: 'rollAdversaryAttack',
        visibility: 'public',
        instanceId: 'nope',
        advantage: false,
        disadvantage: false,
      }),
    ).toBe('unknownAdversary');
  });
});

describe('death moves', () => {
  let room: RoomState;
  beforeEach(() => {
    room = roomWithPlayers();
  });

  /** Marks every Hit Point, which is what forces the move. */
  function downed(state: RoomState, who: Actor): RoomState {
    const slots = state.characters[who.id]?.character.hpSlots ?? 6;
    return apply(state, GM, { type: 'markHP', characterId: who.id, amount: slots });
  }

  it('ends the character on a blaze of glory', () => {
    const next = apply(downed(room, ALEX), ALEX, {
      type: 'deathMove',
      characterId: ALEX.id,
      choice: 'blazeOfGlory',
      prefer: 'hp',
    });
    expect(next.characters[ALEX.id]?.dead).toBe(true);
  });

  it('drops the character unconscious when they avoid death', () => {
    const next = apply(downed(room, ALEX), ALEX, {
      type: 'deathMove',
      characterId: ALEX.id,
      choice: 'avoidDeath',
      prefer: 'hp',
    });
    const sheet = next.characters[ALEX.id];
    // A level-1 character is scarred only on a 1, so this may go either way; what
    // is certain is that they are down but not gone.
    expect(sheet?.dead).toBe(false);
    expect(sheet?.unconscious).toBe(true);
    expect(sheet?.scars).toBeLessThanOrEqual(1);
  });

  it('wakes an unconscious character when an ally clears a Hit Point', () => {
    let next = apply(downed(room, ALEX), ALEX, {
      type: 'deathMove',
      characterId: ALEX.id,
      choice: 'avoidDeath',
      prefer: 'hp',
    });
    expect(next.characters[ALEX.id]?.unconscious).toBe(true);

    next = apply(next, GM, { type: 'clearHP', characterId: ALEX.id, amount: 1 });
    expect(next.characters[ALEX.id]?.unconscious).toBe(false);
  });

  it('wakes everyone when the party takes a long rest', () => {
    let next = apply(downed(room, ALEX), ALEX, {
      type: 'deathMove',
      characterId: ALEX.id,
      choice: 'avoidDeath',
      prefer: 'hp',
    });
    next = apply(next, GM, { type: 'beginRest', kind: 'long' });
    expect(next.characters[ALEX.id]?.unconscious).toBe(false);
  });

  it('logs a Risk It All, since the whole table watches that roll', () => {
    const result = applyRoomEvent(
      downed(room, ALEX),
      ALEX,
      { type: 'deathMove', characterId: ALEX.id, choice: 'riskItAll', prefer: 'hp' },
      rng,
      NOW,
    );
    if (!result.ok) throw new Error('the death move was rejected');
    expect(result.entries).toHaveLength(1);
    expect(result.state.rollLog[0]).toMatchObject({ label: 'Risk It All' });
  });

  it('refuses a death move for a character who is already gone', () => {
    const gone = apply(downed(room, ALEX), ALEX, {
      type: 'deathMove',
      characterId: ALEX.id,
      choice: 'blazeOfGlory',
      prefer: 'hp',
    });
    expect(
      refusal(gone, ALEX, {
        type: 'deathMove',
        characterId: ALEX.id,
        choice: 'riskItAll',
        prefer: 'hp',
      }),
    ).toBe('characterIsGone');
  });

  it('refuses a death move a player makes for somebody else', () => {
    expect(
      refusal(downed(room, SAM), ALEX, {
        type: 'deathMove',
        characterId: SAM.id,
        choice: 'avoidDeath',
        prefer: 'hp',
      }),
    ).toBe('notYourCharacter');
  });
});

describe('downtime', () => {
  let room: RoomState;
  beforeEach(() => {
    room = roomWithPlayers();
  });

  it('opens a rest, pays the GM in Fear, and gives every PC two moves', () => {
    const next = apply(room, GM, { type: 'beginRest', kind: 'short' });
    expect(next.rest?.kind).toBe('short');
    expect(next.rest?.movesLeft).toEqual({ [ALEX.id]: 2, [SAM.id]: 2 });
    // 1d4 on a short rest, so somewhere between one and four.
    expect(next.fear).toBeGreaterThanOrEqual(room.fear + 1);
    expect(next.fear).toBeLessThanOrEqual(room.fear + 4);
    expect(next.consecutiveShortRests).toBe(1);
  });

  it('pays more Fear for a long rest, and resets the short-rest run', () => {
    let next = apply(room, GM, { type: 'beginRest', kind: 'short' });
    next = apply(next, GM, { type: 'endRest' });
    expect(next.consecutiveShortRests).toBe(1);

    const before = next.fear;
    next = apply(next, GM, { type: 'beginRest', kind: 'long' });
    // 1d4 plus one per PC, and there are two.
    expect(next.fear).toBeGreaterThanOrEqual(before + 3);
    expect(next.consecutiveShortRests).toBe(0);
  });

  it('refuses a fourth short rest in a row', () => {
    let next = room;
    for (let i = 0; i < 3; i += 1) {
      next = apply(next, GM, { type: 'beginRest', kind: 'short' });
      next = apply(next, GM, { type: 'endRest' });
    }
    expect(refusal(next, GM, { type: 'beginRest', kind: 'short' })).toBe('mustRestLong');
    // A long rest is still allowed, and clears the run.
    expect(apply(next, GM, { type: 'beginRest', kind: 'long' }).consecutiveShortRests).toBe(0);
  });

  it('refuses a rest from a player, and a second rest from the GM', () => {
    expect(refusal(room, ALEX, { type: 'beginRest', kind: 'short' })).toBe('notGameMaster');
    const resting = apply(room, GM, { type: 'beginRest', kind: 'short' });
    expect(refusal(resting, GM, { type: 'beginRest', kind: 'short' })).toBe('alreadyResting');
    expect(refusal(room, GM, { type: 'endRest' })).toBe('notResting');
  });

  it('spends a move to clear Hit Points, and runs out after two', () => {
    let next = apply(room, GM, { type: 'markHP', characterId: ALEX.id, amount: 4 });
    next = apply(next, GM, { type: 'beginRest', kind: 'short' });
    const hurt = next.characters[ALEX.id]?.hpMarked ?? 0;

    next = apply(next, ALEX, { type: 'downtimeMove', characterId: ALEX.id, move: 'tendToWounds', withParty: false });
    expect(next.characters[ALEX.id]?.hpMarked).toBeLessThan(hurt);
    expect(next.rest?.movesLeft[ALEX.id]).toBe(1);

    next = apply(next, ALEX, { type: 'downtimeMove', characterId: ALEX.id, move: 'prepare', withParty: false });
    expect(next.rest?.movesLeft[ALEX.id]).toBe(0);
    expect(
      refusal(next, ALEX, { type: 'downtimeMove', characterId: ALEX.id, move: 'prepare', withParty: false }),
    ).toBe('noMovesLeft');
    // Sam has not spent theirs.
    expect(next.rest?.movesLeft[SAM.id]).toBe(2);
  });

  it('clears the whole track on a long rest', () => {
    let next = apply(room, GM, { type: 'markHP', characterId: ALEX.id, amount: 5 });
    next = apply(next, GM, { type: 'markStress', characterId: ALEX.id, amount: 5 });
    next = apply(next, GM, { type: 'beginRest', kind: 'long' });
    next = apply(next, ALEX, { type: 'downtimeMove', characterId: ALEX.id, move: 'tendToWounds', withParty: false });
    next = apply(next, ALEX, { type: 'downtimeMove', characterId: ALEX.id, move: 'clearStress', withParty: false });
    expect(next.characters[ALEX.id]?.hpMarked).toBe(0);
    expect(next.characters[ALEX.id]?.stressMarked).toBe(0);
  });

  it('lets a character spend their move on an ally', () => {
    let next = apply(room, GM, { type: 'markHP', characterId: SAM.id, amount: 4 });
    next = apply(next, GM, { type: 'beginRest', kind: 'long' });
    next = apply(next, ALEX, {
      type: 'downtimeMove',
      characterId: ALEX.id,
      move: 'tendToWounds',
      targetId: SAM.id,
      withParty: false,
    });
    expect(next.characters[SAM.id]?.hpMarked).toBe(0);
    // The move came out of Alex's budget, not Sam's.
    expect(next.rest?.movesLeft[ALEX.id]).toBe(1);
    expect(next.rest?.movesLeft[SAM.id]).toBe(2);
  });

  it('refuses a downtime move outside a rest, and a project on a short one', () => {
    expect(
      refusal(room, ALEX, { type: 'downtimeMove', characterId: ALEX.id, move: 'prepare', withParty: false }),
    ).toBe('notResting');

    const short = apply(room, GM, { type: 'beginRest', kind: 'short' });
    expect(
      refusal(short, ALEX, {
        type: 'downtimeMove',
        characterId: ALEX.id,
        move: 'workOnProject',
        withParty: false,
      }),
    ).toBe('moveNotAvailable');
  });

  it('refuses a downtime move a player makes for somebody else', () => {
    const resting = apply(room, GM, { type: 'beginRest', kind: 'short' });
    expect(
      refusal(resting, ALEX, {
        type: 'downtimeMove',
        characterId: SAM.id,
        move: 'prepare',
        withParty: false,
      }),
    ).toBe('notYourCharacter');
  });
});

describe('a party assembling', () => {
  it('hands the GM one Fear for each new PC, and none for a replacement', () => {
    const base = createRoomState('c-1', { id: GM.id, name: 'GM', connected: true });
    const room = {
      ...base,
      players: [
        { id: ALEX.id, name: 'Alex', connected: true, characterId: null },
        { id: SAM.id, name: 'Sam', connected: true, characterId: null },
      ],
    };
    expect(room.fear).toBe(0);

    // "You start a campaign with 1 Fear per PC in the party" (SRD 2.0 p.87), and a
    // party fills up over several sessions.
    const withAlex = claimCharacterInRoom(room, ALEX.id, createSheet(makeCharacter()));
    expect(withAlex.fear).toBe(1);
    expect(withAlex.players.find((p) => p.id === ALEX.id)?.characterId).toBe(ALEX.id);

    const withSam = claimCharacterInRoom(withAlex, SAM.id, createSheet(makeCharacter()));
    expect(withSam.fear).toBe(2);

    // Replacing a character is not a new PC at the table.
    const rebuilt = claimCharacterInRoom(withSam, ALEX.id, createSheet(makeCharacter('bard')));
    expect(rebuilt.fear).toBe(2);
  });
});

describe('countdowns', () => {
  const countdown = {
    type: 'addCountdown',
    id: 'cd-1',
    name: 'The bridge collapses',
    kind: 'standard',
    startingValue: 2,
    loop: 'none',
  } as const;

  it('does not advance a countdown that has already triggered', () => {
    let room = apply(roomWithPlayers(), GM, countdown);
    room = apply(room, GM, { type: 'advanceCountdown', id: 'cd-1', amount: 2 });
    expect(room.countdowns[0]?.triggered).toBe(true);
    const at = room.countdowns[0]?.value;

    room = apply(room, GM, { type: 'advanceCountdown', id: 'cd-1', amount: 2 });
    expect(room.countdowns[0]?.value).toBe(at);
  });

  it('refuses to advance a countdown that is not there', () => {
    expect(refusal(roomWithPlayers(), GM, { type: 'advanceCountdown', id: 'nope', amount: 1 })).toBe(
      'unknownCountdown',
    );
  });
});

describe('map events', () => {
  const pcToken = (over: Partial<Token> = {}): Token => ({
    id: 'tok-1',
    kind: 'pc',
    refId: ALEX.id,
    name: 'Alex',
    x: 100,
    y: 100,
    width: 50,
    height: 50,
    rotation: 0,
    color: '#fff',
    image: null,
    colorFrame: false,
    hidden: false,
    showRings: false,
    ownerId: ALEX.id,
    conditions: [],
    visionRadius: 300,
    ...over,
  });

  /** A room with one active scene the players can see. */
  function roomWithScene(): RoomState {
    let room = apply(roomWithPlayers(), GM, { type: 'addScene', id: 's-1', name: 'The bridge' });
    room = apply(room, GM, { type: 'setActiveScene', id: 's-1' });
    return room;
  }

  it('lets a player place their own token once, and only once', () => {
    let room = apply(roomWithScene(), ALEX, { type: 'addToken', sceneId: 's-1', token: pcToken() });
    expect(room.map.scenes[0]?.tokens).toHaveLength(1);

    expect(
      refusal(room, ALEX, { type: 'addToken', sceneId: 's-1', token: pcToken({ id: 'tok-2' }) }),
    ).toBe('tokenExists');

    // A duplicate id is refused even for the GM, who may add any token.
    room = apply(room, GM, { type: 'addToken', sceneId: 's-1', token: pcToken({ id: 'tok-9', refId: SAM.id, ownerId: SAM.id }) });
    expect(refusal(room, GM, { type: 'addToken', sceneId: 's-1', token: pcToken({ id: 'tok-9' }) })).toBe(
      'tokenExists',
    );
  });

  it('fills a polygon of fog, and hides it again', () => {
    // A 100x100 square over the top-left corner of a 50px fog grid: four cells.
    const square = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    // The fog grid only has cells once it has been fitted to an image.
    let room = apply(roomWithScene(), GM, {
      type: 'setSceneImage',
      sceneId: 's-1',
      image: { url: '/uploads/a.png', width: 1000, height: 1000 },
    });
    room = apply(room, GM, { type: 'setFogEnabled', sceneId: 's-1', enabled: true });
    room = apply(room, GM, { type: 'fillFog', sceneId: 's-1', points: square, reveal: true });
    // 50px cells over a 1000px image: the square covers the first two of each of
    // the first two rows.
    expect(room.map.scenes[0]?.fog.revealed).toEqual([0, 1, 20, 21]);

    room = apply(room, GM, { type: 'fillFog', sceneId: 's-1', points: square, reveal: false });
    expect(room.map.scenes[0]?.fog.revealed).toEqual([]);
  });

  it('refuses a player filling fog', () => {
    expect(
      refusal(roomWithScene(), ALEX, {
        type: 'fillFog',
        sceneId: 's-1',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
        reveal: true,
      }),
    ).toBe('notGameMaster');
  });

  it('refuses a player placing a token they would not own', () => {
    const room = roomWithScene();
    expect(
      refusal(room, ALEX, { type: 'addToken', sceneId: 's-1', token: pcToken({ ownerId: SAM.id }) }),
    ).toBe('notGameMaster');
  });

  it('refuses a player moving somebody else’s token', () => {
    const room = apply(roomWithScene(), GM, {
      type: 'addToken',
      sceneId: 's-1',
      token: pcToken({ refId: SAM.id, ownerId: SAM.id }),
    });
    expect(
      refusal(room, ALEX, { type: 'moveToken', sceneId: 's-1', tokenId: 'tok-1', x: 5, y: 5, commit: true }),
    ).toBe('notYourToken');
  });

  it('refuses every wall event from a player', () => {
    const room = roomWithScene();
    const wall = { id: 'w-1', kind: 'wall', x1: 0, y1: 0, x2: 100, y2: 0, open: false } as const;
    expect(refusal(room, ALEX, { type: 'addWall', sceneId: 's-1', wall })).toBe('notGameMaster');
    expect(refusal(room, ALEX, { type: 'removeWall', sceneId: 's-1', wallId: 'w-1' })).toBe(
      'notGameMaster',
    );
    expect(refusal(room, ALEX, { type: 'setSceneVisionMode', sceneId: 's-1', visionMode: 'auto' })).toBe(
      'notGameMaster',
    );
  });

  it('reveals what a door was hiding as soon as it is opened', () => {
    let room = roomWithScene();
    const scene = createScene('s-2', 'Vault');
    room = {
      ...room,
      map: {
        ...room.map,
        activeSceneId: 's-2',
        scenes: [
          {
            ...scene,
            visionMode: 'auto',
            fog: { enabled: true, cellSize: 50, cols: 20, rows: 20, revealed: [] },
            walls: [{ id: 'w-1', kind: 'door', x1: 200, y1: 0, x2: 200, y2: 1000, open: false }],
          },
        ],
      },
    };

    room = apply(room, GM, {
      type: 'addToken',
      sceneId: 's-2',
      token: pcToken({ id: 'tok-v', x: 50, y: 400 }),
    });
    const behindClosedDoor = room.map.scenes[0]?.fog.revealed.length ?? 0;
    expect(behindClosedDoor).toBeGreaterThan(0);

    room = apply(room, GM, {
      type: 'updateWall',
      sceneId: 's-2',
      wall: { id: 'w-1', kind: 'door', x1: 200, y1: 0, x2: 200, y2: 1000, open: true },
    });
    // Opening the door exposes the far side without anybody taking a step.
    expect(room.map.scenes[0]?.fog.revealed.length).toBeGreaterThan(behindClosedDoor);
  });
});

describe('chat and private rolls', () => {
  let room: RoomState;
  beforeEach(() => {
    room = roomWithPlayers();
  });

  const request = {
    label: 'Agility Roll',
    modifiers: 0,
    difficulty: 10,
    advantage: 0,
    disadvantage: 0,
    helpDice: 0,
    reaction: false,
    experiences: [],
  };

  it('posts a public message to the log, signed by the actor', () => {
    const r = applyRoomEvent(room, ALEX, { type: 'sendMessage', text: 'hola', whisperTo: [] }, rng, NOW);
    if (!r.ok) throw new Error('message was rejected');
    expect(r.state.rollLog[0]).toMatchObject({ kind: 'message', text: 'hola', by: 'Alex', byId: ALEX.id });
    expect(r.entries).toHaveLength(1);
    expect(r.privateEntries).toEqual([]);
  });

  it('keeps a whisper out of the public log', () => {
    const r = applyRoomEvent(
      room,
      ALEX,
      { type: 'sendMessage', text: 'psst', whisperTo: [SAM.id] },
      rng,
      NOW,
    );
    if (!r.ok) throw new Error('whisper was rejected');
    expect(r.state.rollLog).toHaveLength(0);
    expect(r.entries).toHaveLength(0);
    expect([...(r.state.privateLog[0]?.audience ?? [])].sort()).toEqual([ALEX.id, SAM.id].sort());
    expect(r.privateEntries[0]?.entry).toMatchObject({ kind: 'message', text: 'psst' });
  });

  it('leaves the GM out of a whisper audience, since the GM sees every whisper', () => {
    const toGm = applyRoomEvent(
      room,
      ALEX,
      { type: 'sendMessage', text: 'only you', whisperTo: [GM.id] },
      rng,
      NOW,
    );
    if (!toGm.ok) throw new Error('whisper was rejected');
    expect(toGm.state.rollLog).toHaveLength(0);
    expect(toGm.state.privateLog[0]?.audience).toEqual([ALEX.id]);

    const fromGm = applyRoomEvent(
      room,
      GM,
      { type: 'sendMessage', text: 'a word', whisperTo: [SAM.id, SAM.id] },
      rng,
      NOW,
    );
    if (!fromGm.ok) throw new Error('whisper was rejected');
    expect(fromGm.state.privateLog[0]?.audience).toEqual([SAM.id]);
    expect(fromGm.state.privateLog[0]?.entry).toMatchObject({ by: 'GM', byId: GM.id });
  });

  it('refuses a whisper whose audience would not fit in the private log', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `acc-${i}`);
    expect(refusal(room, ALEX, { type: 'sendMessage', text: 'all of you', whisperTo: twelve })).toBe(
      'rejected',
    );
  });

  it('routes a private duality roll to privateLog with the roller as audience', () => {
    const r = applyRoomEvent(
      room,
      ALEX,
      { type: 'rollDuality', characterId: ALEX.id, request, visibility: 'private' },
      rng,
      NOW,
    );
    if (!r.ok) throw new Error('roll was rejected');
    expect(r.state.rollLog).toHaveLength(0);
    expect(r.entries).toHaveLength(0);
    expect(r.privateEntries[0]?.audience).toEqual([ALEX.id]);
    expect(r.state.privateLog[0]?.entry.kind).toBe('duality');
  });

  it('routes a private damage roll the same way', () => {
    const r = applyRoomEvent(
      room,
      ALEX,
      {
        type: 'rollDamage',
        characterId: ALEX.id,
        label: 'Sword',
        dice: { count: 1, die: 8 },
        modifier: 0,
        critical: false,
        visibility: 'private',
      },
      rng,
      NOW,
    );
    if (!r.ok) throw new Error('roll was rejected');
    expect(r.state.rollLog).toHaveLength(0);
    expect(r.privateEntries[0]?.audience).toEqual([ALEX.id]);
  });

  it('a private GM roll has an empty audience: GM only', () => {
    const r = applyRoomEvent(
      room,
      GM,
      { type: 'rollFate', kind: 'fate', label: 'Fire', visibility: 'private' },
      rng,
      NOW,
    );
    if (!r.ok) throw new Error('roll was rejected');
    expect(r.state.rollLog).toHaveLength(0);
    expect(r.privateEntries[0]?.audience).toEqual([]);
    expect(r.state.privateLog[0]?.entry.kind).toBe('fate');
  });

  it('a public roll still goes to the shared log and nowhere else', () => {
    const r = applyRoomEvent(
      room,
      GM,
      { type: 'rollFate', kind: 'fate', label: 'Fire', visibility: 'public' },
      rng,
      NOW,
    );
    if (!r.ok) throw new Error('roll was rejected');
    expect(r.state.rollLog).toHaveLength(1);
    expect(r.state.privateLog).toEqual([]);
    expect(r.privateEntries).toEqual([]);
  });

  it('loads a snapshot saved before privateLog existed', () => {
    const { privateLog: _dropped, ...old } = createRoomState('c', {
      id: GM.id,
      name: 'GM',
      connected: true,
    });
    expect(RoomStateSchema.parse(old).privateLog).toEqual([]);
  });
});
