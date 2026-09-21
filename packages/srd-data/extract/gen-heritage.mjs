import fs from 'node:fs';
import { readPages } from './geo.mjs';

/**
 * Ancestries and communities (SRD 2.0 pp.32-41).
 *
 * Both chapters are laid out the same way: a name in caps, some prose, then a
 * "ANCESTRY FEATURES" or "COMMUNITY FEATURE" heading and the features beneath it,
 * each written as "Name: text". An ancestry always has exactly two, in the order
 * Mixed Ancestry draws them in; a community has one.
 */

// The two chapters share page 38, which is why the ranges overlap: each reader
// looks only for its own features heading.
const PAGES = { ancestries: [32, 38], communities: [38, 42] };

const pages = readPages(new URL('./srd-bbox.xml', import.meta.url).pathname);

const problems = [];

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const titleCase = (s) =>
  s
    .toLowerCase()
    .replace(/(^|[\s-])([a-z])/g, (_, before, c) => before + c.toUpperCase());

/** A heading is a line in capitals; anything else is prose or a feature. */
const isHeading = (line) => /^[A-Z][A-Z’' -]{2,}$/.test(line);

const FEATURE = /^([^:]{1,40}):\s*(.+)$/;

function linesFor([from, to]) {
  return pages
    .slice(from - 1, to)
    .flatMap((columns) => columns.flat())
    .map((l) => l.trim())
    .filter((l) => l !== '' && l !== 'Daggerheart SRD' && !/^\d{1,3}$/.test(l));
}

/**
 * Reads every entry in a chapter: the heading closest above each features block is
 * the entry's name, and the block runs to the next heading.
 */
function readEntries(range, featuresHeading, featureCount, label) {
  const lines = linesFor(range);
  const entries = [];

  lines.forEach((line, i) => {
    // Singular as well as plural: the SRD heads the Faerie's two features
    // "ANCESTRY FEATURE".
    if (line !== featuresHeading && line !== featuresHeading.replace(/S$/, '')) return;

    // Name: the nearest heading above, skipping the group headings that introduce
    // a family of ancestries (e.g. "ELEMENTAL KIN" over the four kin).
    let name = null;
    for (let j = i - 1; j >= 0; j--) {
      if (isHeading(lines[j])) {
        name = lines[j];
        break;
      }
    }
    if (name === null) {
      problems.push(`${label}: no heading above a features block`);
      return;
    }
    // The chapter opens by explaining what an ancestry feature is, under the
    // chapter's own heading. That block describes no entry.
    if (name === 'ANCESTRIES' || name === 'COMMUNITIES') return;

    const features = [];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (isHeading(line)) break;
      const match = FEATURE.exec(line);
      // A feature name is Title Case and short; a colon inside prose is not one.
      const startsFeature =
        match !== null && !/[.!?]/.test(match[1]) && /^[A-Z]/.test(match[1]) &&
        match[1].split(' ').length <= 4;
      if (startsFeature) {
        features.push({ name: match[1].trim(), text: match[2].trim() });
      } else if (features.length > 0) {
        const last = features[features.length - 1];
        last.text = `${last.text} ${line}`.replace(/ {2,}/g, ' ').trim();
      }
      if (features.length === featureCount && j + 1 < lines.length && isHeading(lines[j + 1])) break;
    }

    if (features.length !== featureCount) {
      problems.push(`${label} ${name}: ${features.length} features, expected ${featureCount}`);
      return;
    }
    entries.push({ id: slug(name), name: titleCase(name), features });
  });

  return entries;
}

const ancestries = readEntries(PAGES.ancestries, 'ANCESTRY FEATURES', 2, 'ancestry').map((a) => ({
  id: a.id,
  name: a.name,
  // Mixed Ancestry takes the first-listed feature from one ancestry and the
  // second-listed from another, so the order the SRD prints them in is load-bearing.
  features: a.features.map((f, i) => ({ slot: i === 0 ? 'first' : 'second', ...f })),
}));

const communities = readEntries(PAGES.communities, 'COMMUNITY FEATURE', 1, 'community').map((c) => ({
  id: c.id,
  name: c.name,
  feature: c.features[0],
}));

for (const [label, entries] of [['ancestries', ancestries], ['communities', communities]]) {
  const ids = entries.map((e) => e.id);
  const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  if (dupes.length > 0) problems.push(`${label}: duplicate ids ${dupes.join(', ')}`);
}

console.log('ancestries:', ancestries.length);
console.log('communities:', communities.length);
console.log('problems:', problems.length);
problems.slice(0, 20).forEach((p) => console.log('  !', p));

const byId = (a, b) => a.id.localeCompare(b.id);
fs.writeFileSync(
  new URL('../data/en/ancestries.json', import.meta.url),
  JSON.stringify([...ancestries].sort(byId), null, 2) + '\n',
);
fs.writeFileSync(
  new URL('../data/en/communities.json', import.meta.url),
  JSON.stringify([...communities].sort(byId), null, 2) + '\n',
);
