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

    next = apply(next, ALEX, {
      type: 'recallCard',
      characterId: ALEX.id,
      cardId,
      duringRest: false,
    });
    // The cost is read from the SRD, never from the intent.
    expect(next.characters[ALEX.id]?.stressMarked).toBe(recallCostOf(cardId));
    expect(next.characters[ALEX.id]?.loadout).toContain(cardId);
  });

  it('recalls for free during a rest', () => {
    const cardId = room.characters[ALEX.id]?.loadout[0];
    if (cardId === undefined) throw new Error('no card in the starting loadout');
    let next = apply(room, ALEX, { type: 'vaultCard', characterId: ALEX.id, cardId });
    next = apply(next, ALEX, { type: 'recallCard', characterId: ALEX.id, cardId, duringRest: true });
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
        characterId: ALEX.id,
        request: {
          label: 'Agility Roll',
          modifiers: 0,
          difficulty: 10,
          advantage: 0,
          disadvantage: 0,
          helpDice: 0,
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

  it('refuses a roll naming an Experience the character does not have', () => {
    expect(
      refusal(room, ALEX, {
        type: 'rollDuality',
        characterId: ALEX.id,
        request: {
          label: 'Bogus',
          modifiers: 0,
          difficulty: 10,
          advantage: 0,
          disadvantage: 0,
          helpDice: 0,
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
