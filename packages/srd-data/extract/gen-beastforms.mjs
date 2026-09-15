import fs from 'node:fs';
import { readPages } from './geo.mjs';

/**
 * Beastform options (SRD "Beastform Options"). Each entry is:
 *   NAME / (examples) / Trait +N | Evasion +N / Range Trait dX+N type /
 *   Gain advantage on: ... / one or more named features.
 */

const pages = readPages(new URL('./srd-bbox.xml', import.meta.url).pathname);
const lines = pages.slice(6, 9).flatMap((columns) => columns.flat());

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const TRAITS = 'Agility|Strength|Finesse|Instinct|Presence|Knowledge';
const STATS = new RegExp(`^(${TRAITS})\\s*([+\\-−])\\s*(\\d+)\\s*\\|\\s*Evasion\\s*([+\\-−])\\s*(\\d+)$`);
const ATTACK = new RegExp(
  `^(Melee|Very Close|Close|Far|Very Far)\\s+(${TRAITS})\\s+d(\\d+)(?:\\+(\\d+))?\\s+(phy|mag)$`,
);
const ATTACK_ALT = new RegExp(
  `^(${TRAITS})\\s+(Melee|Very Close|Close|Far|Very Far)\\s+d(\\d+)(?:\\+(\\d+))?\\s+(phy|mag)$`,
);
const ADVANTAGE = /^Gain advantage on:\s*(.+)$/;
const FEATURE = /^([A-Z][A-Za-z'’\- ]+):\s*(.+)$/;
const TIER_HEADER = /^TIER (\d)$/;

const RANGES = {
  Melee: 'melee',
  'Very Close': 'veryClose',
  Close: 'close',
  Far: 'far',
  'Very Far': 'veryFar',
};

const MINOR_WORDS = new Set(['of', 'the', 'and', 'in', 'a', 'an', 'or']);
const titleCase = (s) =>
  s
    .toLowerCase()
    .split(' ')
    .map((w, i) =>
      i > 0 && MINOR_WORDS.has(w) ? w : w.replace(/^[a-z]/, (c) => c.toUpperCase()),
    )
    .join(' ');

const problems = [];
const beastforms = [];

// Anchor on the stats line; the name and examples sit directly above it.
const anchors = [];
let tier = 1;
const tierAt = new Map();
lines.forEach((l, i) => {
  if (TIER_HEADER.test(l.trim())) tierAt.set(i, Number(TIER_HEADER.exec(l.trim())[1]));
  if (STATS.test(l.trim())) anchors.push(i);
});

const tierFor = (index) => {
  let current = 1;
  for (const [at, t] of tierAt) if (at < index) current = t;
  return current;
};

anchors.forEach((si, n) => {
  const statsMatch = STATS.exec(lines[si].trim());
  const [, traitName, traitSign, traitVal, evaSign, evaVal] = statsMatch;

  // Examples line, then the all-caps name above it.
  let nameIdx = si - 1;
  let examples = '';
  if (nameIdx >= 0 && /^\(.*\)$/.test(lines[nameIdx].trim())) {
    examples = lines[nameIdx].trim().replace(/^\(|\)$/g, '');
    nameIdx--;
  }

  const nameParts = [];
  for (let j = nameIdx; j >= 0; j--) {
    const t = lines[j].trim();
    if (t === '' || /^\d{1,3}$/.test(t) || t === 'Daggerheart SRD' || TIER_HEADER.test(t)) {
      if (nameParts.length > 0) break;
      continue;
    }
    if (!/[a-z]/.test(t)) {
      nameParts.unshift(t);
      continue;
    }
    break;
  }
  const name = nameParts.join(' ').replace(/\s+/g, ' ').trim();
  if (name === '') {
    problems.push(`line ${si}: no name above "${lines[si]}"`);
    return;
  }

  const end = anchors[n + 1] === undefined ? lines.length : anchors[n + 1] - 2;
  const body = lines
    .slice(si + 1, end)
    .map((l) => l.trim())
    .filter(
      (l) =>
        l !== '' &&
        l !== 'Daggerheart SRD' &&
        !/^\d{1,3}$/.test(l) &&
        !TIER_HEADER.test(l) &&
        !/^BEASTFORM OPTIONS$/.test(l) &&
        // The next entry's all-caps name and its examples line.
        !(!/[a-z]/.test(l) && l.length > 2) &&
        !/^\(.*\)$/.test(l),
    );

  const attackLine = body.find((l) => ATTACK.test(l) || ATTACK_ALT.test(l));
  if (!attackLine) {
    problems.push(`${name}: no attack line`);
    return;
  }
  const am = ATTACK.exec(attackLine) ?? ATTACK_ALT.exec(attackLine);
  const [rangeRaw, attackTrait] = ATTACK.test(attackLine)
    ? [am[1], am[2]]
    : [am[2], am[1]];

  const advantageLine = body.find((l) => ADVANTAGE.test(l));
  const advantages = advantageLine
    ? ADVANTAGE.exec(advantageLine)[1]
        .split(',')
        .map((a) => a.trim().replace(/\.$/, ''))
        .filter((a) => a !== '')
    : [];

  // Features come after the advantage line, each "Name: text" with wrapped lines.
  const startIdx = advantageLine ? body.indexOf(advantageLine) + 1 : body.indexOf(attackLine) + 1;
  const features = [];
  for (const line of body.slice(startIdx)) {
    const m = FEATURE.exec(line);
    if (m) features.push({ name: m[1].trim(), text: m[2].trim() });
    else if (features.length > 0) {
      const last = features[features.length - 1];
      last.text = `${last.text} ${line}`.replace(/ {2,}/g, ' ').trim();
    }
  }
  if (features.length === 0) problems.push(`${name}: no features`);

  beastforms.push({
    id: slug(name),
    name: titleCase(name),
    tier: tierFor(si),
    examples,
    trait: traitName.toLowerCase(),
    traitBonus: (traitSign === '+' ? 1 : -1) * Number(traitVal),
    evasionBonus: (evaSign === '+' ? 1 : -1) * Number(evaVal),
    attack: {
      trait: attackTrait.toLowerCase(),
      range: RANGES[rangeRaw],
      damage: { count: 1, die: Number(am[3]), modifier: am[4] ? Number(am[4]) : 0 },
      damageType: am[5] === 'mag' ? 'magic' : 'physical',
    },
    advantages,
    features,
  });
});

// "Legendary Beast" / "Mythic Beast" are upgrade options: they print no stat line,
// only an "Evolved" feature that improves a lower-tier form.
lines.forEach((line, i) => {
  if (!/^\(Upgraded .*\)$/.test(line.trim())) return;

  const nameParts = [];
  for (let j = i - 1; j >= 0; j--) {
    const t = lines[j].trim();
    if (t === '' || t === 'Daggerheart SRD' || /^\d{1,3}$/.test(t) || TIER_HEADER.test(t)) {
      if (nameParts.length > 0) break;
      continue;
    }
    if (!/[a-z]/.test(t)) nameParts.unshift(t);
    else break;
  }
  const name = nameParts.join(' ').replace(/\s+/g, ' ').trim();
  if (name === '') {
    problems.push(`line ${i}: no name above "${line}"`);
    return;
  }

  const text = [];
  for (let j = i + 1; j < lines.length; j++) {
    const t = lines[j].trim();
    if (t === '' || t === 'Daggerheart SRD' || /^\d{1,3}$/.test(t)) continue;
    if (TIER_HEADER.test(t) || (!/[a-z]/.test(t) && t.length > 2)) break;
    text.push(t);
  }

  const joined = text.join(' ').replace(/ {2,}/g, ' ').trim();
  const m = FEATURE.exec(joined);
  beastforms.push({
    id: slug(name),
    name: titleCase(name),
    tier: tierFor(i),
    examples: line.trim().replace(/^\(|\)$/g, ''),
    trait: null,
    traitBonus: null,
    evasionBonus: null,
    attack: null,
    advantages: [],
    features: m ? [{ name: m[1].trim(), text: m[2].trim() }] : [{ name: 'Evolved', text: joined }],
  });
});

beastforms.sort((a, b) => a.tier - b.tier);

const seen = new Set();
for (const b of beastforms) {
  if (seen.has(b.id)) problems.push(`duplicate id: ${b.id}`);
  seen.add(b.id);
}

console.log('beastforms:', beastforms.length);
for (const t of [1, 2, 3, 4]) {
  console.log(`  tier ${t}: ${beastforms.filter((b) => b.tier === t).length}`);
}
console.log('problems:', problems.length);
problems.slice(0, 20).forEach((p) => console.log('  !', p));

fs.writeFileSync(
  new URL('../data/en/beastforms.json', import.meta.url),
  JSON.stringify(beastforms, null, 2) + '\n',
);
