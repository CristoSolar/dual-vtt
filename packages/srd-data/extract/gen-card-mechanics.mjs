import fs from 'node:fs';

// Structured mechanics for every domain card: what "Use" rolls, against what
// Difficulty, what damage it deals and what it costs the caster. Unlike the other
// scripts this one reads the extracted card text, not the PDF: the text is the
// source of truth and these fields are a reading of it.
//
// A pass of patterns reads the English text; `OVERRIDES` then corrects the cards
// the patterns misread, each one checked by hand against the card. The output is
// the same in both locales except for sub-ability names, which are read off each
// locale's own text so the Spanish file names "Llama Salvaje", not "Wild Flame".
//
// `cost` is paid when the card is used. `successCost` is paid only after the roll
// succeeds ("On a success, spend a Hope to…"), so a failed cast costs nothing.
// Variable costs ("mark any number of Stress") are left to the player.

const read = (locale) =>
  JSON.parse(fs.readFileSync(new URL(`../data/${locale}/domain-cards.json`, import.meta.url)));
const en = read('en');
const es = read('es');

const TRAITS = ['agility', 'strength', 'finesse', 'instinct', 'presence', 'knowledge'];
const NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };

/**
 * Cards whose text is several named abilities: every grimoire, plus Conjure Swarm
 * (two named spells) and Tempest (three named options). Names are matched at the
 * start of the text, after a sentence, or after a list bullet.
 */
const MULTI = new Set([
  ...en.filter((c) => c.type === 'grimoire').map((c) => c.id),
  'conjure-swarm',
  'tempest',
]);
const NAME_AT = /(?:^|(?<=[.!?]\s)|(?<=[◦•]\s))([A-ZÁÉÍÓÚÑ][\p{L}’' ]{1,40}?):\s/gu;

/** Splits a multi-ability card into `[name, text]` pairs; the preamble goes first. */
function segments(text) {
  const hits = [...text.matchAll(NAME_AT)];
  return hits.map((m, i) => {
    const end = hits[i + 1]?.index ?? text.length;
    return [m[1].trim(), text.slice(m.index + m[0].length, end).trim()];
  });
}

const count = (word) => NUMBER_WORDS[word.toLowerCase()] ?? Number(word);

/** Reads one ability's text. Everything not found is left out. */
function readAbility(text) {
  const ability = { roll: null };

  // The caster's own roll. A successful Spellcast Roll "to cast a different spell"
  // or one made "without" rolling is not this card's roll.
  const spell =
    /\bmak(?:e|ing) (?:a|an additional) Spellcast Roll(?: \((\d+)\))?/i.exec(text) ??
    /\bSpellcast Roll \((\d+)\)/.exec(text) ??
    /\breaction roll using your Spellcast trait()/i.exec(text);
  const trait = /\bmake an? (Agility|Strength|Finesse|Instinct|Presence|Knowledge) Roll(?: \((\d+)\))?/i.exec(text);
  if (spell !== null && (trait === null || spell.index <= trait.index)) {
    ability.roll = 'spellcast';
    if (spell[1]) ability.difficulty = Number(spell[1]);
  } else if (trait !== null) {
    ability.roll = trait[1].toLowerCase();
    if (trait[2]) ability.difficulty = Number(trait[2]);
  }

  // "2d6 magic damage", "d10+2 magic damage using your Proficiency".
  const dmg = /\b(\d*)d(\d+)(?:\s*\+\s*(\d+))? (magic|physical) damage([^.]*)/.exec(text);
  if (dmg !== null) {
    const rest = dmg[5];
    ability.damage = {
      count: dmg[1] === '' ? 1 : Number(dmg[1]),
      die: Number(dmg[2]),
      modifier: dmg[3] === undefined ? 0 : Number(dmg[3]),
      type: dmg[4],
      scale: /using your Proficiency/.test(rest)
        ? 'proficiency'
        : /using your Spellcast trait/.test(rest)
          ? 'spellcast'
          : null,
    };
  }

  // What the caster pays: "Mark a Stress to…", "Spend 2 Hope to…", "mark an Armor
  // Slot". Someone else marking ("the target must mark a Stress") is not a cost.
  const cost = {};
  const successCost = {};
  const PAY = /\b(mark|spend) (a|an|one|two|three|four|five|\d+) (Stress|Hope|Armor Slot)s?\b/gi;
  for (const m of text.matchAll(PAY)) {
    const before = text.slice(Math.max(0, m.index - 40), m.index);
    if (/\b(must|they|targets?|adversar(y|ies)|allies|ally|creature|them|who)\s+(can\s+)?$/i.test(before)) continue;
    if (/\b(additional|another)\s*$/i.test(before)) continue;
    const sentenceStart = Math.max(text.lastIndexOf('. ', m.index), 0);
    const sentence = text.slice(sentenceStart, m.index);
    const onSuccess = /On a success|success/i.test(sentence) && !/On a failure/i.test(sentence);
    const key = m[3] === 'Armor Slot' ? 'armor' : m[3].toLowerCase();
    const target = onSuccess ? successCost : cost;
    if (target[key] !== undefined) continue;
    target[key] = count(m[2]);
  }
  if (Object.keys(cost).length > 0) ability.cost = cost;
  if (Object.keys(successCost).length > 0) ability.successCost = successCost;
  return ability;
}

/**
 * Hand corrections, each checked against the card. A function receives the
 * pattern reading and returns the abilities to keep; abilities are listed in card
 * order and keep their locale names from the text.
 */
const OVERRIDES = {
  // "Spend a Hope to reduce incoming damage by 1d8" — the holder's Hope; a ward die,
  // not damage.
  'rune-ward': () => [{ roll: null, cost: { hope: 1 } }],
  // Damage is a d10 per token spent: variable, left to the player. The Stress
  // replenishes tokens and is not the cast's cost.
  'unleash-chaos': () => [{ roll: 'spellcast' }],
  // The extra 2d6 is the On Fire condition's, not the cast's.
  'cinder-grasp': () => [
    { roll: 'spellcast', damage: { count: 1, die: 20, modifier: 3, type: 'magic', scale: null } },
  ],
  // The Hope is spent on a success; extra Hope per passenger is variable.
  'blink-out': () => [{ roll: 'spellcast', difficulty: 12, successCost: { hope: 1 } }],
  'chain-lightning': () => [
    {
      roll: 'spellcast',
      cost: { stress: 2 },
      damage: { count: 2, die: 8, modifier: 4, type: 'magic', scale: null },
    },
  ],
  // "Spend a Hope to become Cloaked" after another spell's success: no roll of its own.
  'cloaking-blast': () => [{ roll: null, cost: { hope: 1 } }],
  // Any number of Hope: variable.
  'arcane-reflection': () => [{ roll: null }],
  // Extra layers cost any number of Stress: variable.
  'confusing-aura': () => [{ roll: 'spellcast', difficulty: 14 }],
  'earthquake': () => [
    { roll: 'spellcast', difficulty: 16, damage: { count: 3, die: 10, modifier: 8, type: 'physical', scale: null } },
  ],
  'adjust-reality': () => [{ roll: null, cost: { hope: 5 } }],
  // 1d20+2 per Stress marked, any number: variable.
  'falling-sky': () => [{ roll: 'spellcast' }],
  // Reroll, not damage.
  'not-good-enough': () => [{ roll: null }],
  'whirlwind': () => [{ roll: null, cost: { hope: 1 } }],
  'champions-edge': () => [{ roll: null }],
  'battle-hardened': () => [{ roll: null, cost: { hope: 1 } }],
  // A Stress per Rage Up; the card allows two per attack, each its own use.
  'rage-up': () => [{ roll: null, cost: { stress: 1 } }],
  'glancing-blow': () => [{ roll: null, cost: { stress: 1 } }],
  // An attack roll with the weapon: rolled from the weapon, not the card.
  'reapers-strike': () => [{ roll: null, cost: { hope: 1 } }],
  'battle-monster': () => [{ roll: null, cost: { stress: 4 } }],
  // The Reaction Roll is the attacker's, not the user's.
  'onslaught': () => [{ roll: null, cost: { stress: 1 } }],
  // A d4 to Evasion, not a duality roll.
  'i-see-it-coming': () => [{ roll: null, cost: { stress: 1 } }],
  'ferocity': () => [{ roll: null, cost: { hope: 2 } }],
  'deft-maneuvers': () => [{ roll: null, cost: { stress: 1 } }],
  'brace': () => [{ roll: null, cost: { stress: 1 } }],
  // The ally spends the Hope, not the user.
  'tactician': () => [{ roll: null }],
  'boost': () => [{ roll: null, cost: { stress: 1 } }],
  'redirect': () => [{ roll: null, cost: { stress: 1 } }],
  // Hope on a success; the Stress for removing a Fear is a second, optional spend.
  'know-thy-enemy': () => [{ roll: 'instinct', successCost: { hope: 1 } }],
  'rapid-riposte': () => [{ roll: null, cost: { stress: 1 } }],
  // Spending a Hope lets an ally do the same: optional.
  'recovery': () => [{ roll: null }],
  'bone-touched': () => [{ roll: null }],
  'breaking-blow': () => [{ roll: null, cost: { stress: 1 } }],
  'wrangle': () => [{ roll: 'agility', successCost: { hope: 1 } }],
  // An attack with the weapon; its damage is the weapon's.
  'splintering-strike': () => [{ roll: null, cost: { hope: 1 } }],
  'deathrun': () => [{ roll: null, cost: { hope: 3 } }],
  'book-of-ava': () => [
    { roll: 'spellcast', damage: { count: 1, die: 10, modifier: 2, type: 'magic', scale: 'proficiency' } },
    { roll: null, cost: { hope: 1 } },
    { roll: 'spellcast', difficulty: 12, damage: { count: 1, die: 6, modifier: 0, type: 'physical', scale: 'proficiency' } },
  ],
  // Arcane Barrage: any number of Hope, a d6 each — variable.
  'book-of-illiat': () => [{ roll: 'spellcast' }, { roll: null }, { roll: null, cost: { hope: 1 } }],
  // The targets mark the Stress, not the caster.
  'book-of-tyfar': () => [
    { roll: 'spellcast', damage: { count: 2, die: 6, modifier: 0, type: 'magic', scale: null } },
    { roll: null },
    { roll: 'spellcast', difficulty: 13 },
  ],
  'book-of-sitil': () => [{ roll: null }, { roll: null, cost: { hope: 2 } }, { roll: 'spellcast', difficulty: 14 }],
  'book-of-vagras': () => [
    { roll: 'spellcast', difficulty: 15 },
    { roll: 'spellcast', difficulty: 13, successCost: { hope: 1 } },
    { roll: 'spellcast' },
  ],
  'book-of-korvax': () => [
    { roll: 'spellcast' },
    { roll: null, cost: { hope: 1 } },
    { roll: null, cost: { stress: 1 }, damage: { count: 2, die: 12, modifier: 4, type: 'magic', scale: null } },
  ],
  'book-of-norai': () => [
    { roll: 'spellcast' },
    { roll: 'spellcast', damage: { count: 1, die: 20, modifier: 5, type: 'magic', scale: 'proficiency' } },
  ],
  // The construct's 2d10+3 is its own attack, commanded with a Spellcast Roll.
  'book-of-exota': () => [
    { roll: 'spellcast' },
    { roll: 'spellcast', cost: { hope: 1 }, damage: { count: 2, die: 10, modifier: 3, type: 'physical', scale: null } },
  ],
  'book-of-grynn': () => [
    { roll: null, cost: { hope: 1 } },
    { roll: 'spellcast' },
    { roll: 'spellcast', difficulty: 15, damage: { count: 4, die: 10, modifier: 3, type: 'magic', scale: null } },
  ],
  'manifest-wall': () => [{ roll: 'spellcast', difficulty: 15, successCost: { hope: 1 } }],
  // The +3 / +1 / −2 depends on how well you know the place: the player adds it.
  'teleport': () => [{ roll: 'spellcast', difficulty: 16 }],
  // The d20s set the target's Difficulty; not damage.
  'banish': () => [{ roll: 'spellcast' }],
  'sigil-of-retribution': () => [{ roll: null }],
  'codex-touched': () => [{ roll: null }],
  'book-of-vyola': () => [{ roll: 'spellcast' }, { roll: null, cost: { hope: 1 } }],
  'safe-haven': () => [{ roll: null, cost: { hope: 2 } }],
  // A Stress per adversary hit: variable.
  'disintegration-wave': () => [{ roll: 'spellcast', difficulty: 18 }],
  // d6+1 with Hope, d10+1 with Fear: the dice depend on the roll, so none is fixed.
  // On a failure the caster pays a Hope or a Stress, their choice.
  'blighting-strike': () => [{ roll: 'spellcast' }],
  'umbral-veil': () => [{ roll: null, cost: { stress: 1 } }],
  'voice-of-dread': () => [{ roll: 'spellcast' }],
  'hideous-retribution': () => [
    { roll: 'spellcast', successCost: { stress: 1 }, damage: { count: 1, die: 6, modifier: 0, type: 'magic', scale: 'proficiency' } },
  ],
  'book-of-yarrow': () => [{ roll: 'spellcast', difficulty: 18 }, { roll: null, cost: { hope: 5 } }],
  'transcendent-union': () => [{ roll: null, cost: { hope: 5 } }],
  // Marks Hit Points on a willing creature, not on the caster as a cost.
  'shared-trauma': () => [{ roll: null }],
  // The target marks 1d4 Stress; not damage.
  'terrify': () => [{ roll: 'spellcast' }],
  'summon-horror': () => [
    { roll: null, cost: { stress: 1 }, damage: { count: 1, die: 8, modifier: 1, type: 'magic', scale: 'spellcast' } },
  ],
  'dire-strike': () => [{ roll: null, cost: { hope: 1 } }],
  'spectral-mist': () => [{ roll: null, cost: { hope: 2 } }],
  // Any number of Hope, one per target: variable.
  'darkfire': () => [{ roll: null, damage: { count: 1, die: 8, modifier: 6, type: 'magic', scale: 'spellcast' } }],
  'jump-scare': () => [{ roll: null, cost: { stress: 1 } }],
  'dread-touched': () => [{ roll: null }],
  // Creatures in the wall mark the Stress.
  'wall-of-hunger': () => [{ roll: 'spellcast', difficulty: 10, successCost: { hope: 1 } }],
  'dark-army': () => [{ roll: 'spellcast', difficulty: 14 }],
  'eldritch-flesh': () => [{ roll: null, cost: { hope: 2 } }],
  // Any number of Stress, a d20 each: variable.
  'damnation': () => [{ roll: 'spellcast' }],
  // The Hope before each action roll is upkeep, not the cast.
  'avatar-of-terror': () => [{ roll: null, cost: { stress: 1 } }],
  // The Stress to force the target to mark one is a second, optional spend.
  'enrapture': () => [{ roll: 'spellcast' }],
  'inspirational-words': () => [{ roll: null }],
  // The target marks Stress if they refuse.
  'tell-no-lies': () => [{ roll: 'spellcast' }],
  // d4s equal to Proficiency are Stress the target marks, not damage.
  'troublemaker': () => [{ roll: 'presence' }],
  'hypnotic-shimmer': () => [{ roll: 'spellcast' }],
  'invisibility': () => [{ roll: 'spellcast', difficulty: 10, successCost: { stress: 1 } }],
  'thought-delver': () => [{ roll: 'spellcast', cost: { hope: 1 } }],
  'words-of-discord': () => [{ roll: 'spellcast', difficulty: 13 }],
  'never-upstaged': () => [{ roll: null, cost: { stress: 1 } }],
  'share-the-burden': () => [{ roll: null }],
  'endless-charisma': () => [{ roll: null, cost: { hope: 1 } }],
  'grace-touched': () => [{ roll: null }],
  'astral-projection': () => [{ roll: null, cost: { stress: 1 } }],
  'rain-of-blades': () => [
    { roll: 'spellcast', cost: { hope: 1 }, damage: { count: 1, die: 8, modifier: 2, type: 'magic', scale: 'proficiency' } },
  ],
  // The Stress to force every Enraptured target to mark one ends the spell: optional.
  'mass-enrapture': () => [{ roll: 'spellcast' }],
  // Hope equal to half the mimicked card's level: variable.
  'copycat': () => [{ roll: null }],
  'encore': () => [{ roll: 'spellcast' }],
  'notorious': () => [{ roll: null, cost: { stress: 1 } }],
  'uncanny-disguise': () => [{ roll: null, cost: { stress: 1 } }],
  // d6s equal to the Spellcast trait: one d6 scaled by the trait.
  'midnight-spirit': () => [
    { roll: 'spellcast', cost: { hope: 1 }, damage: { count: 1, die: 6, modifier: 0, type: 'magic', scale: 'spellcast' } },
  ],
  'shadowbind': () => [{ roll: 'spellcast' }],
  'chokehold': () => [{ roll: null, cost: { stress: 1 } }],
  'veil-of-night': () => [{ roll: 'spellcast', difficulty: 13 }],
  'stealth-expertise': () => [{ roll: null, cost: { stress: 1 } }],
  'glyph-of-nightfall': () => [{ roll: 'spellcast', successCost: { hope: 1 } }],
  'hush': () => [{ roll: 'spellcast', successCost: { hope: 1 } }],
  // The second Hope is spent later, to come back.
  'phantom-retreat': () => [{ roll: null, cost: { hope: 1 } }],
  'dark-whispers': () => [{ roll: 'spellcast', cost: { stress: 1 } }],
  'mass-disguise': () => [{ roll: null, cost: { stress: 1 } }],
  'midnight-touched': () => [{ roll: null }],
  'vanishing-dodge': () => [{ roll: null, cost: { hope: 1 } }],
  'spellcharge': () => [{ roll: null }],
  // Damage is a d6 per stolen Fear: variable.
  'night-terror': () => [{ roll: null }],
  // Any number of Hope: variable.
  'gifted-tracker': () => [{ roll: null }],
  'twilight-toll': () => [{ roll: null }],
  // Targets mark the Stress.
  'eclipse': () => [{ roll: 'spellcast', difficulty: 16 }],
  'specter-of-the-dark': () => [{ roll: null, cost: { stress: 1 } }],
  // The Hope for a +2 to a Spellcast Roll is a separate, optional use.
  'natures-tongue': () => [{ roll: 'instinct', difficulty: 12 }],
  // The Hope to Restrain a second adversary is optional.
  'vicious-entangle': () => [
    { roll: 'spellcast', damage: { count: 1, die: 8, modifier: 1, type: 'physical', scale: null } },
  ],
  'conjure-swarm': () => [
    { roll: null, cost: { stress: 1 } },
    { roll: 'spellcast', successCost: { hope: 1 }, damage: { count: 2, die: 8, modifier: 3, type: 'magic', scale: null } },
  ],
  'natural-familiar': () => [{ roll: null, cost: { hope: 1 } }],
  // Marking 2 or more Stress to Corrode is optional and variable.
  'corrosive-projectile': () => [
    { roll: 'spellcast', damage: { count: 1, die: 6, modifier: 4, type: 'magic', scale: 'proficiency' } },
  ],
  // Used as an attack it costs a Stress and rolls; climbing needs neither.
  'towering-stalk': () => [
    { roll: 'spellcast', cost: { stress: 1 }, damage: { count: 1, die: 8, modifier: 0, type: 'physical', scale: 'proficiency' } },
  ],
  // The 3d6+2 is the third option's, dealt to those who fail a Reaction Roll.
  'death-grip': () => [
    { roll: 'spellcast', damage: { count: 3, die: 6, modifier: 2, type: 'physical', scale: null } },
  ],
  // 2 Hope upgrades the heal: optional.
  'healing-field': () => [{ roll: null }],
  'thorn-skin': () => [{ roll: null, cost: { hope: 1 } }],
  'wild-fortress': () => [{ roll: 'spellcast', difficulty: 13, successCost: { hope: 2 } }],
  // Any number of Hope: variable.
  'conjured-steeds': () => [{ roll: null }],
  'forager': () => [{ roll: null }],
  'sage-touched': () => [{ roll: null }],
  'wild-surge': () => [{ roll: null, cost: { stress: 1 } }],
  // Any number of Hope: variable.
  'forest-sprites': () => [{ roll: 'spellcast', difficulty: 13 }],
  'rejuvenation-barrier': () => [{ roll: 'spellcast', difficulty: 15 }],
  'fane-of-the-wilds': () => [{ roll: null }],
  'plant-dominion': () => [{ roll: 'spellcast', difficulty: 18 }],
  'force-of-nature': () => [{ roll: null, cost: { stress: 1 } }],
  'tempest': () => [
    { roll: 'spellcast', damage: { count: 2, die: 20, modifier: 8, type: 'magic', scale: null } },
    { roll: 'spellcast', damage: { count: 3, die: 10, modifier: 10, type: 'magic', scale: null } },
    { roll: 'spellcast', damage: { count: 5, die: 6, modifier: 9, type: 'magic', scale: null } },
  ],
  'bolt-beacon': () => [
    { roll: 'spellcast', successCost: { hope: 1 }, damage: { count: 1, die: 8, modifier: 2, type: 'magic', scale: 'proficiency' } },
  ],
  'mending-touch': () => [{ roll: null, cost: { hope: 2 } }],
  // On a success or a failure the caster marks a Stress, so it is paid either way.
  'healing-hands': () => [{ roll: 'spellcast', difficulty: 13, cost: { stress: 1 } }],
  'divination': () => [{ roll: null, cost: { hope: 3 } }],
  'life-ward': () => [{ roll: null, cost: { hope: 3 } }],
  'shape-material': () => [{ roll: null, cost: { hope: 1 } }],
  'smite': () => [{ roll: null, cost: { hope: 3 } }],
  'restoration': () => [{ roll: null }],
  'zone-of-protection': () => [{ roll: 'spellcast', difficulty: 16 }],
  'healing-strike': () => [{ roll: null, cost: { hope: 2 } }],
  'splendor-touched': () => [{ roll: null }],
  'shield-aura': () => [{ roll: null, cost: { stress: 1 } }],
  // Which of the two damages applies is the target's Reaction Roll; the Hope is
  // any number. The heavier roll is offered; the GM halves nothing here.
  'stunning-sunlight': () => [{ roll: 'spellcast' }],
  // An adversary marks the Stress.
  'overwhelming-aura': () => [{ roll: 'spellcast', difficulty: 15, successCost: { hope: 2 } }],
  // Any number of Stress: variable.
  'salvation-beam': () => [{ roll: 'spellcast', difficulty: 16 }],
  'invigoration': () => [{ roll: null }],
  'resurrection': () => [{ roll: 'spellcast', difficulty: 20 }],
  // An attack with the primary weapon; the Hope for Vulnerable is optional.
  'forceful-push': () => [{ roll: null }],
  'i-am-your-shield': () => [{ roll: null, cost: { stress: 1 } }],
  'bold-presence': () => [{ roll: null, cost: { hope: 1 } }],
  'goad-them-on': () => [{ roll: 'presence' }],
  'support-tank': () => [{ roll: null, cost: { hope: 2 } }],
  'shrug-it-off': () => [{ roll: null, cost: { stress: 1 } }],
  'full-surge': () => [{ roll: null, cost: { stress: 3 } }],
  // The SRD prints no damage type for this one.
  'ground-pound': () => [
    { roll: 'strength', cost: { hope: 2 }, damage: { count: 4, die: 10, modifier: 8, type: null, scale: null } },
  ],
  'hold-the-line': () => [{ roll: null, cost: { hope: 1 } }],
  'lead-by-example': () => [{ roll: null, cost: { stress: 1 } }],
  // "When you would mark an Armor Slot" is the trigger; it saves one, costs none.
  'unyielding-armor': () => [{ roll: null }],
};

/** The sub-ability names of a multi-ability card, read from one locale's text. */
function names(card) {
  return MULTI.has(card.id) ? segments(card.text).map(([name]) => name) : [null];
}

const problems = [];
const out = { en: [], es: [] };
const esById = new Map(es.map((c) => [c.id, c]));

for (const card of en) {
  const parts = MULTI.has(card.id) ? segments(card.text).map(([, text]) => text) : [card.text];
  const read = parts.map(readAbility);
  const override = OVERRIDES[card.id];
  const abilities = override === undefined ? read : override(read);

  const enNames = names(card);
  const esCard = esById.get(card.id);
  const esNames = esCard === undefined ? [] : names(esCard);
  if (esCard === undefined) problems.push(`${card.id}: missing in es`);
  if (enNames.length !== abilities.length) {
    problems.push(`${card.id}: ${enNames.length} en names for ${abilities.length} abilities`);
  }
  if (esNames.length !== abilities.length) {
    problems.push(`${card.id}: ${esNames.length} es names for ${abilities.length} abilities`);
  }
  for (const ability of abilities) {
    if (ability.roll !== null && ability.roll !== 'spellcast' && !TRAITS.includes(ability.roll)) {
      problems.push(`${card.id}: unknown roll ${ability.roll}`);
    }
  }

  // Keys in a fixed order so the JSON diffs cleanly.
  const shape = (ability, name) => ({
    name,
    roll: ability.roll,
    ...(ability.difficulty === undefined ? {} : { difficulty: ability.difficulty }),
    ...(ability.damage === undefined ? {} : { damage: ability.damage }),
    ...(ability.cost === undefined ? {} : { cost: { hope: 0, stress: 0, armor: 0, ...ability.cost } }),
    ...(ability.successCost === undefined
      ? {}
      : { successCost: { hope: 0, stress: 0, armor: 0, ...ability.successCost } }),
  });
  out.en.push({ id: card.id, abilities: abilities.map((a, i) => shape(a, enNames[i] ?? null)) });
  out.es.push({ id: card.id, abilities: abilities.map((a, i) => shape(a, esNames[i] ?? null)) });
}

for (const id of Object.keys(OVERRIDES)) {
  if (!en.some((c) => c.id === id)) problems.push(`override for unknown card ${id}`);
}

for (const locale of ['en', 'es']) {
  fs.writeFileSync(
    new URL(`../data/${locale}/card-mechanics.json`, import.meta.url),
    JSON.stringify(out[locale], null, 2) + '\n',
  );
}

// A summary, so a re-run shows what the reading covers.
const all = out.en.flatMap((c) => c.abilities);
const tally = (pred) => all.filter(pred).length;
console.log(`cards: ${out.en.length}, abilities: ${all.length}`);
console.log(`  roll: ${tally((a) => a.roll !== null)} (spellcast ${tally((a) => a.roll === 'spellcast')})`);
console.log(`  difficulty: ${tally((a) => a.difficulty !== undefined)}`);
console.log(`  damage: ${tally((a) => a.damage !== undefined)}`);
console.log(`  cost: ${tally((a) => a.cost !== undefined)}, successCost: ${tally((a) => a.successCost !== undefined)}`);
console.log(`  nothing mechanical: ${tally((a) => a.roll === null && !a.damage && !a.cost && !a.successCost)}`);
console.log(`overrides: ${Object.keys(OVERRIDES).length}`);
console.log(`problems: ${problems.length}`);
for (const p of problems) console.log(`  ${p}`);
