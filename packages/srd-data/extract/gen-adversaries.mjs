import fs from 'node:fs';
import { readPages } from './geo.mjs';

// Read from the bbox extraction so side-by-side columns never interleave.
const pages = readPages(new URL('./srd-bbox.xml', import.meta.url).pathname);

// Adversary stat blocks run from the Tier 1 section through the end of Tier 4.
const lines = pages
  .slice(37, 51)
  .flatMap((columns) => columns.flat());

// Stat-block headings are set in all caps; restore normal casing for display.
const MINOR_WORDS = new Set(['of', 'the', 'and', 'in', 'a', 'an']);
const titleCase = (s) =>
  s
    .toLowerCase()
    .split(' ')
    .map((word, i) =>
      i > 0 && MINOR_WORDS.has(word)
        ? word
        : word.replace(/^[a-z]/, (c) => c.toUpperCase()).replace(/-([a-z])/g, (_, c) => '-' + c.toUpperCase()),
    )
    .join(' ');

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const STATS =
  /^Difficulty:\s*(\d+)\s*\|\s*Thresholds:\s*(None|\d+\s*\/\s*(?:\d+|None))\s*\|\s*HP:\s*(\d+)\s*\|\s*Stress:\s*(\d+)/;
// The attack modifier is usually flat, but a few adversaries roll for it (e.g. the
// Outer Realms Abomination's "ATK: +2d4").
const ATK = /^ATK:\s*([+\-−])\s*(\d+(?:d\d+)?)\s*\|\s*(.+?):\s*(.+?)\s*\|\s*(.+)$/;
const TIER_HEADER = /^TIER (\d) ADVERSARIES/;
const TYPE_LINE = /^Tier\s+(\d)\s+([A-Za-z]+)(?:\s*\((\d+)\/HP\))?$/;
const FEATURE = /^(.+?)\s[-–]\s(Action|Reaction|Passive):\s*(.*)$/;

const RANGES = {
  Melee: 'melee',
  'Very Close': 'veryClose',
  Close: 'close',
  Far: 'far',
  'Very Far': 'veryFar',
};

const problems = [];
const adversaries = [];
let tier = null;

const isNoise = (l) =>
  l.trim() === '' ||
  l.trim() === 'Daggerheart SRD' ||
  /^\s*\d{1,3}\s*$/.test(l) ||
  // Section headings wrap, so "(LEVELS 5-7)" can sit on its own line above a name.
  /^TIER \d ADVERSARIES/.test(l.trim()) ||
  /^\(LEVELS?\s/i.test(l.trim());

// Locate every stat block: a "Tier <Type>" line is the anchor.
const anchors = [];
lines.forEach((l, i) => {
  const t = l.trim();
  if (TIER_HEADER.test(t)) anchors.push({ kind: 'tier', i, tier: Number(TIER_HEADER.exec(t)[1]) });
  else if (TYPE_LINE.test(t)) {
    const m = TYPE_LINE.exec(t);
    anchors.push({
      kind: 'block',
      i,
      tier: Number(m[1]),
      type: m[2],
      hordeThreshold: m[3] === undefined ? null : Number(m[3]),
    });
  }
});

const blockAnchors = anchors.filter((a) => a.kind === 'block');

for (const anchor of anchors) {
  if (anchor.kind === 'tier') {
    tier = anchor.tier;
    continue;
  }

  const { i, type, hordeThreshold } = anchor;
  // Each block prints its own tier, which is authoritative: a tier's last blocks can
  // share a two-page spread with the next tier's heading (e.g. Zombie Pack, p.43).
  const blockTier = anchor.tier;

  // Name: the all-caps line(s) immediately above the "Tier <Type>" line.
  const nameParts = [];
  for (let j = i - 1; j >= 0; j--) {
    const t = lines[j].trim();
    if (isNoise(t)) {
      if (nameParts.length > 0) break;
      continue;
    }
    if (!/[a-z]/.test(t)) {
      nameParts.unshift(t.replace(/:$/, ''));
      continue;
    }
    break;
  }
  const name = nameParts.join(' ').replace(/\s+/g, ' ').trim();
  if (name === '') {
    problems.push(`line ${i}: no name above "Tier ${type}"`);
    continue;
  }

  // The block ends where the next block's name begins.
  const nextBlock = blockAnchors.find((b) => b.i > i);
  let end = nextBlock === undefined ? lines.length : nextBlock.i;
  if (nextBlock !== undefined) {
    for (let j = nextBlock.i - 1; j >= 0; j--) {
      const t = lines[j].trim();
      if (isNoise(t) || !/[a-z]/.test(t)) end = j;
      else break;
    }
  }

  const body = lines.slice(i + 1, end).map((l) => l.trim()).filter((l) => !isNoise(l));

  const statsLine = body.find((l) => STATS.test(l));
  if (!statsLine) {
    problems.push(`${name}: no stats line`);
    continue;
  }
  const [, difficulty, thresholdsRaw, hp, stress] = STATS.exec(statsLine);

  // Minions print "None"; a few adversaries have a Major but no Severe ("4/None").
  let thresholds = null;
  if (thresholdsRaw !== 'None') {
    const [majorRaw, severeRaw] = thresholdsRaw.split('/').map((n) => n.trim());
    thresholds = {
      major: Number(majorRaw),
      severe: severeRaw === 'None' ? null : Number(severeRaw),
    };
  }

  const atkLine = body.find((l) => ATK.test(l));
  if (!atkLine) {
    problems.push(`${name}: no ATK line`);
    continue;
  }
  const [, sign, mod, atkName, atkRange, atkDamage] = ATK.exec(atkLine);
  const negative = sign !== '+';
  const rolledMod = /^(\d+)d(\d+)$/.exec(mod);
  const attackModifier = rolledMod
    ? { roll: { count: Number(rolledMod[1]), die: Number(rolledMod[2]) }, flat: null }
    : { roll: null, flat: (negative ? -1 : 1) * Number(mod) };

  const range = RANGES[atkRange.trim()];
  if (!range) problems.push(`${name}: unknown attack range "${atkRange}"`);

  // Minions deal flat damage with no dice (e.g. "1 phy"); everyone else rolls.
  const dmgText = atkDamage.trim();
  const dmg = /^(\d+)d(\d+)(?:\s*\+\s*(\d+))?\s*(direct\s+)?(phy|mag)/.exec(dmgText);
  const flatDmg = dmg ? null : /^(\d+)\s*(direct\s+)?(phy|mag)/.exec(dmgText);
  if (!dmg && !flatDmg) problems.push(`${name}: unparsed damage "${dmgText}"`);

  const experienceLine = body.find((l) => /^Experience:/.test(l));
  const experiences = experienceLine
    ? experienceLine
        .replace(/^Experience:\s*/, '')
        .split(',')
        .map((e) => e.trim())
        .filter((e) => e !== '')
        .map((e) => {
          const m = /^(.*?)\s*([+\-−])\s*(\d+)$/.exec(e);
          if (!m) {
            problems.push(`${name}: unparsed experience "${e}"`);
            return null;
          }
          return { name: m[1].trim(), modifier: (m[2] === '+' ? 1 : -1) * Number(m[3]) };
        })
        .filter((e) => e !== null)
    : [];

  const motivesLine = body.find((l) => /^Motives & Tactics:/.test(l));
  const motivesAndTactics = motivesLine
    ? motivesLine.replace(/^Motives & Tactics:\s*/, '').trim()
    : '';

  // Description: the prose above "Motives & Tactics".
  const motivesIdx = motivesLine ? body.indexOf(motivesLine) : -1;
  const description = (motivesIdx > 0 ? body.slice(0, motivesIdx) : [])
    .join(' ')
    .replace(/ {2,}/g, ' ')
    .trim();

  // Features: everything from FEATURES onward, rejoining wrapped lines.
  const featuresIdx = body.findIndex((l) => l === 'FEATURES');
  const features = [];
  if (featuresIdx !== -1) {
    for (const line of body.slice(featuresIdx + 1)) {
      const m = FEATURE.exec(line);
      if (m) {
        features.push({ name: m[1].trim(), type: m[2].toLowerCase(), text: m[3].trim() });
      } else if (features.length > 0) {
        const last = features[features.length - 1];
        last.text = `${last.text} ${line}`.replace(/ {2,}/g, ' ').trim();
      } else {
        problems.push(`${name}: feature text before any feature header: "${line}"`);
      }
    }
  }
  if (features.length === 0) problems.push(`${name}: no features`);

  adversaries.push({
    id: slug(name),
    name: titleCase(name),
    tier: blockTier,
    type: type.toLowerCase(),
    hordeThreshold,
    description,
    motivesAndTactics,
    difficulty: Number(difficulty),
    thresholds,
    hp: Number(hp),
    stress: Number(stress),
    attackModifier,
    standardAttack: {
      name: atkName.trim(),
      range: range ?? 'melee',
      damage: dmg
        ? { count: Number(dmg[1]), die: Number(dmg[2]), modifier: dmg[3] ? Number(dmg[3]) : 0 }
        : { count: 0, die: null, modifier: flatDmg ? Number(flatDmg[1]) : 0 },
      damageType: (dmg ? dmg[5] : flatDmg?.[3]) === 'mag' ? 'magic' : 'physical',
      direct: Boolean(dmg ? dmg[4] : flatDmg?.[2]),
    },
    experiences,
    features: features.map((f) => ({
      ...f,
      // The SRD prints no "Fear" feature type; Fear features are Actions/Reactions
      // whose text spends Fear (SRD p.37).
      costsFear: /\bspend(?:s|ing)? (?:a|\d+) Fear\b/i.test(f.text),
    })),
  });
}

const seen = new Set();
for (const a of adversaries) {
  if (seen.has(a.id)) problems.push(`duplicate id: ${a.id}`);
  seen.add(a.id);
}

console.log('adversaries:', adversaries.length);
for (const t of [1, 2, 3, 4]) {
  console.log(`  tier ${t}: ${adversaries.filter((a) => a.tier === t).length}`);
}
console.log('types:', [...new Set(adversaries.map((a) => a.type))].sort().join(', '));
console.log('fear features:', adversaries.flatMap((a) => a.features).filter((f) => f.costsFear).length);
console.log('problems:', problems.length);
problems.slice(0, 40).forEach((p) => console.log('  !', p));

fs.writeFileSync(
  new URL('../data/en/adversaries.json', import.meta.url),
  JSON.stringify(adversaries, null, 2) + '\n',
);
