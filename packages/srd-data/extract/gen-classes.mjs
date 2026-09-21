import fs from 'node:fs';
import { readBlocks } from './geo.mjs';

/**
 * Classes and subclasses, from the Classes chapter (SRD 2.0 pp.8-31).
 *
 * The chapter is laid out to one rhythm: a class opens with a name in caps and a
 * paragraph, then four dashed stat lines, then its Hope feature, its class features,
 * and two subclasses — each with a Spellcast trait and Foundation, Specialization
 * and Mastery features. `readPages` rebuilds the columns geometrically, so the text
 * arrives in reading order and a heading is simply a line on its own.
 *
 * Writes both `classes.json` and `subclasses.json`, since one pass over the pages
 * produces both and they have to agree on ids.
 */

const PAGES = [8, 31]; // printed pages, inclusive; the PDF's numbering matches.

/**
 * Blocks rather than bare lines, because a block boundary is a paragraph boundary:
 * a feature's text can run to two paragraphs, and joining them with a space would
 * lose a break the SRD put there.
 */
const PARAGRAPH = '\u0000';

const lines = readBlocks(new URL('./srd-bbox.xml', import.meta.url).pathname)
  .slice(PAGES[0] - 1, PAGES[1])
  .flatMap((columns) => columns.flat())
  .flatMap((block) => [PARAGRAPH, ...block.lines])
  .map((l) => (l === PARAGRAPH ? l : l.trim()))
  .filter((l) => l !== '' && l !== 'Daggerheart SRD' && !/^\d{1,3}$/.test(l));

const CLASS_NAMES = [
  'ASSASSIN',
  'BARD',
  'BRAWLER',
  'DRUID',
  'GUARDIAN',
  'RANGER',
  'ROGUE',
  'SERAPH',
  'SORCERER',
  'WARLOCK',
  'WARRIOR',
  'WITCH',
  'WIZARD',
];

const TRAITS = ['Agility', 'Strength', 'Finesse', 'Instinct', 'Presence', 'Knowledge'];

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const problems = [];

/**
 * The SRD sets one feature's text as a two-column table, and a column reader emits
 * a table's cells in an order that does not read back as prose: each row's label
 * lands after the text it labels. There is exactly one such feature, so rather than
 * teach the reader about tables, its text is written out here — and the extraction
 * it replaces is checked below, so a later SRD edit cannot leave this silently stale.
 */
const TABLE_FEATURES = [
  {
    // The Moon's chart is split across two page columns, so the roll and phase
    // land in one and the effect in the other. Read off p.30.
    subclassId: 'moon',
    tier: 'mastery',
    feature: 'Lunar Phases',
    extractedEndsWith: 'If you increase the value of a 6, it becomes a 1.',
    text:
      'At the beginning of each session, roll a d6 and place it on this card. You ' +
      'gain the matching effect until the end of session.\n' +
      '1 · New: Spend a Hope to negate Minor damage.\n' +
      '2–3 · Waxing: +2 to damage rolls\n' +
      '4 · Full: +3 to damage thresholds\n' +
      '5–6 · Waning: +1 to Evasion\n' +
      'Once per rest, you can spend a Hope to increase the value of this die by one. ' +
      'If you increase the value of a 6, it becomes a 1.',
  },
  {
    classId: 'witch',
    feature: 'Commune',
    // Read off the printed chart on p.29: the label belongs to the row beneath it.
    extractedEndsWith: 'You psychically experience a scene relevant to the answer as if you were there.',
    text:
      'Once per long rest during a moment of calm, you can commune with an ancestor, ' +
      'a deity, a spirit, or an otherworldly being. Ask them a question, then roll a ' +
      'number of d6s equal to your Spellcast trait. Choose one of the results and ' +
      'reference the chart below for the effect.\n' +
      '1–3: You taste a flavor, smell a scent, or feel a sensation relevant to the answer.\n' +
      '4–5: You hear sounds or see a vision relevant to the answer.\n' +
      '6: You psychically experience a scene relevant to the answer as if you were there.',
  },
];

/**
 * A feature is its name, in bold, then its text. The SRD separates the two with a
 * colon in most places and a full stop in others (compare the Bard's "Rousing
 * Speech:" with its "Maestro."), and bold does not survive text extraction, so a
 * name is recognised by its shape: a short run of Title Case words at the start of
 * a line, followed by one of those two separators.
 */
const FEATURE_START = /^([^:.]{1,48})([:.])\s+(\S.*)$/;

/**
 * Editorial labels, not feature names: the SRD sets rules clarifications in the
 * same shape as a feature, and "Tip" is not something a character has.
 */
const EDITORIAL = new Set(['Tip', 'Note', 'Notes', 'Example', 'Remember']);

/** Connectives that stay lowercase inside a title. */
const MINOR_WORDS = new Set([
  'of', 'the', 'a', 'an', 'and', 'or', 'to', 'for', 'in', 'with', 'by', 'at', 'on',
  'from', 'your', 'my', 'thy', '&',
]);

/** True when every word reads as part of a title rather than a sentence. */
function isTitleCase(candidate) {
  const words = candidate.trim().split(/\s+/);
  if (words.length === 0 || words.length > 6) return false;
  return words.every((word, i) => /^[A-Z0-9“"'(]/.test(word) || (i > 0 && MINOR_WORDS.has(word)));
}

function parseFeatures(block, where) {
  const features = [];
  let previous = null;
  let paragraphBreak = false;

  for (const line of block) {
    if (line === PARAGRAPH) {
      paragraphBreak = true;
      continue;
    }
    const match = FEATURE_START.exec(line);
    // A feature starts a paragraph, so the line before it has to have finished a
    // sentence. Without this, prose that wraps onto a capitalised word ("clear all
    // unspent Rally / Dice. At level 5...") reads as a new feature called "Dice".
    const afterSentenceEnd = previous === null || /[.!?:”"]$/.test(previous);
    const looksLikeName =
      match !== null && isTitleCase(match[1]) && afterSentenceEnd && !EDITORIAL.has(match[1].trim());
    const wasBreak = paragraphBreak;
    paragraphBreak = false;
    previous = line;

    if (looksLikeName) {
      features.push({ name: match[1].trim(), text: match[3].trim() });
      continue;
    }
    const current = features[features.length - 1];
    if (current === undefined) {
      problems.push(`${where}: text before any feature name: "${line}"`);
      continue;
    }
    // Bullets and new paragraphs start a line; a dash that ends a line is
    // hyphenation or an interruption, and closes up against what follows. A block
    // boundary that falls mid-sentence is poppler splitting a paragraph, not the
    // SRD starting one, so it only counts once a sentence has finished.
    if (/^[•◦]/.test(line) || (wasBreak && /[.!?:”"]$/.test(current.text))) current.text += `\n${line}`;
    else if (/[—–-]$/.test(current.text)) current.text += line;
    else current.text += ` ${line}`;
  }

  // Only runs of spaces collapse: the newlines above are meant.
  return features.map((f) => ({
    ...f,
    text: f.text
      .replace(/[^\S\n]+/g, ' ')
      .replace(/ ?\n ?/g, '\n')
      .trim(),
  }));
}

/** Indices of each class's opening heading, in page order. */
const starts = [];
lines.forEach((line, i) => {
  if (CLASS_NAMES.includes(line)) {
    // The name also appears inside "ASSASSIN SUBCLASSES" and the like, which the
    // exact match already excludes, and as a heading only once per class.
    if (!starts.some((s) => s.name === line)) starts.push({ name: line, index: i });
  }
});

if (starts.length !== CLASS_NAMES.length) {
  problems.push(`found ${starts.length} class headings, expected ${CLASS_NAMES.length}`);
}

/** The lines belonging to one class, up to the next class's heading. */
function sectionFor(n) {
  const from = starts[n].index;
  const to = n + 1 < starts.length ? starts[n + 1].index : lines.length;
  return lines.slice(from, to);
}

/** Everything between two headings inside a class section. */
function between(section, startRe, endRes, where) {
  const from = section.findIndex((l) => startRe.test(l));
  if (from === -1) return null;
  let to = section.length;
  for (let i = from + 1; i < section.length; i++) {
    if (endRes.some((re) => re.test(section[i]))) {
      to = i;
      break;
    }
  }
  const block = section.slice(from + 1, to);
  if (block.length === 0) problems.push(`${where}: empty block after ${startRe}`);
  return block;
}

const classes = [];
const subclasses = [];

const SECTION_HEADS = [
  // Any run of capitals on its own line is a heading, which covers the section
  // names below and also the sidebars the SRD sets between features — the
  // Warlock's "SPHERE OF INFLUENCE EXAMPLES" was being read as part of a feature.
  /^[A-Z][A-Z0-9’' &–-]{3,}$/,
  /^(FOUNDATION|SPECIALIZATION|MASTERY) FEATURES?$/,
  /^SPELLCAST TRAIT$/,
  /^TIER \d$/,
];

starts.forEach((start, n) => {
  const section = sectionFor(n);
  const name = start.name.charAt(0) + start.name.slice(1).toLowerCase();
  const id = slug(start.name);

  const line = (re) => section.find((l) => l !== PARAGRAPH && re.test(l)) ?? '';

  const domainsLine = /^DOMAINS\s*[–-]\s*(.+)$/.exec(line(/^DOMAINS\s*[–-]/));
  const evasionLine = /^STARTING EVASION\s*[–-]\s*(\d+)$/.exec(line(/^STARTING EVASION/));
  const hpLine = /^STARTING HIT POINTS\s*[–-]\s*(\d+)$/.exec(line(/^STARTING HIT POINTS/));

  if (!domainsLine || !evasionLine || !hpLine) {
    problems.push(`${name}: missing a DOMAINS / STARTING EVASION / STARTING HIT POINTS line`);
    return;
  }

  // Class items wrap onto the following lines, up to the next heading.
  const itemsAt = section.findIndex((l) => /^CLASS ITEMS\s*[–-]/.test(l));
  let classItems = section[itemsAt].replace(/^CLASS ITEMS\s*[–-]\s*/, '');
  for (let i = itemsAt + 1; i < section.length; i++) {
    if (section[i] === PARAGRAPH) continue;
    if (SECTION_HEADS.some((re) => re.test(section[i]))) break;
    classItems += ` ${section[i]}`;
  }
  classItems = classItems.replace(/\s+/g, ' ').trim();

  const hopeBlock = between(section, /HOPE FEATURE$/, SECTION_HEADS, `${name} hope feature`) ?? [];
  const hopeFeatures = parseFeatures(hopeBlock, `${name} hope feature`);
  if (hopeFeatures.length !== 1) problems.push(`${name}: ${hopeFeatures.length} hope features`);

  const featureBlock = between(section, /^CLASS FEATURES?$/, SECTION_HEADS, `${name} features`) ?? [];
  const features = parseFeatures(featureBlock, `${name} features`);
  if (features.length === 0) problems.push(`${name}: no class features`);

  // --- subclasses ---------------------------------------------------------
  const subAt = section.findIndex((l) => /^[A-Z].* SUBCLASSES$/.test(l));
  if (subAt === -1) {
    problems.push(`${name}: no subclasses heading`);
    return;
  }
  // The sentence wraps onto the next line for the longer subclass names.
  let chooseLine = '';
  for (let i = subAt + 1; i < section.length && i <= subAt + 4; i++) {
    if (section[i] === PARAGRAPH) continue;
    chooseLine = `${chooseLine} ${section[i]}`.trim();
    if (/subclass\.?$/.test(chooseLine)) break;
  }
  const choose = /^Choose either the (.+?) or (?:the )?(.+?) subclass\.?$/.exec(chooseLine);
  if (!choose) {
    problems.push(`${name}: cannot read the subclass choice line "${chooseLine}"`);
    return;
  }
  const subNames = [choose[1].trim(), choose[2].trim()];

  const subIds = subNames.map((subName) => {
    const heading = subName.toUpperCase();
    const at = section.findIndex((l, i) => i > subAt && l === heading);
    if (at === -1) {
      problems.push(`${name}: no heading for subclass ${subName}`);
      return null;
    }
    const nextHeading = section.findIndex(
      (l, i) => i > at && (l === subNames[1].toUpperCase() || /^(BACKGROUND QUESTIONS|CONNECTIONS)$/.test(l)),
    );
    const sub = section.slice(at, nextHeading === -1 ? section.length : nextHeading);

    const traitBlock = between(sub, /^SPELLCAST TRAIT$/, SECTION_HEADS, `${subName} trait`) ?? [];
    const traitName = traitBlock.find((l) => TRAITS.includes(l)) ?? null;
    const noTrait = traitBlock.some((l) => /^None$/i.test(l));
    if (traitName === null && !noTrait && traitBlock.length > 0) {
      problems.push(`${subName}: unreadable Spellcast trait "${traitBlock.join(' | ')}"`);
    }

    const tiers = ['FOUNDATION', 'SPECIALIZATION', 'MASTERY'].map((tier) => {
      const block = between(sub, new RegExp(`^${tier} FEATURES?$`), SECTION_HEADS, `${subName} ${tier}`);
      if (block === null) {
        problems.push(`${subName}: no ${tier} block`);
        return [];
      }
      return parseFeatures(block, `${subName} ${tier}`);
    });

    const subId = slug(subName);
    subclasses.push({
      id: subId,
      name: subName,
      classId: id,
      spellcastTrait: traitName === null ? null : traitName.toLowerCase(),
      foundation: tiers[0],
      specialization: tiers[1],
      mastery: tiers[2],
    });
    return subId;
  });

  if (subIds.some((s) => s === null)) return;

  classes.push({
    id,
    name,
    domains: domainsLine[1].split('&').map((d) => slug(d.trim())),
    startingEvasion: Number(evasionLine[1]),
    startingHP: Number(hpLine[1]),
    classItems,
    hopeFeature: hopeFeatures[0] ?? { name: '?', text: '?' },
    features,
    subclasses: subIds,
  });
});

for (const table of TABLE_FEATURES) {
  const feature =
    table.subclassId === undefined
      ? classes.find((c) => c.id === table.classId)?.features.find((f) => f.name === table.feature)
      : subclasses
          .find((s) => s.id === table.subclassId)?.[table.tier]
          .find((f) => f.name === table.feature);
  const where = table.subclassId ?? table.classId;
  if (feature === undefined) {
    problems.push(`${where}: no feature named ${table.feature} to replace`);
    continue;
  }
  if (!feature.text.endsWith(table.extractedEndsWith)) {
    problems.push(`${where}/${table.feature}: the printed table changed; re-read it`);
    continue;
  }
  feature.text = table.text;
}

for (const c of classes) {
  if (c.domains.length !== 2) problems.push(`${c.name}: ${c.domains.length} domains`);
  for (const f of [c.hopeFeature, ...c.features]) {
    if (!f || f.text === '') problems.push(`${c.name}: empty feature text`);
  }
}
for (const s of subclasses) {
  for (const tier of ['foundation', 'specialization', 'mastery']) {
    if (s[tier].length === 0) problems.push(`${s.name}: no ${tier} features`);
  }
}

console.log('classes:', classes.length);
console.log('subclasses:', subclasses.length);
console.log('problems:', problems.length);
problems.slice(0, 40).forEach((p) => console.log('  !', p));

const byId = (a, b) => a.id.localeCompare(b.id);
fs.writeFileSync(
  new URL('../data/en/classes.json', import.meta.url),
  JSON.stringify([...classes].sort(byId), null, 2) + '\n',
);
fs.writeFileSync(
  new URL('../data/en/subclasses.json', import.meta.url),
  JSON.stringify([...subclasses].sort(byId), null, 2) + '\n',
);
