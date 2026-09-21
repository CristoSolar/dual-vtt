import fs from 'node:fs';
import { readBlocks } from './geo.mjs';

/**
 * Loot and consumables are ROLL | name | description tables. Each cell is its own
 * positioned block, so rows are rebuilt geometrically: find the roll numbers, then
 * take the name and description blocks sitting to their right at the same height.
 */

const pages = readBlocks(new URL('./srd-bbox.xml', import.meta.url).pathname);

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const problems = [];

// Pages are two-up spreads: the left page (x < 612) is read before the right one.
const HALF = 612;
const readingKey = (pageIndex, block) => [pageIndex, block.xMin >= HALF ? 1 : 0, block.yMin];
const before = (a, b) =>
  a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2];

/** Where a single-line heading sits, in reading order, or null if it is not there. */
function findHeading(text) {
  for (let p = 0; p < pages.length; p++) {
    for (const block of pages[p].flat()) {
      if (block.lines.length === 1 && block.lines[0].trim() === text) {
        return readingKey(p, block);
      }
    }
  }
  return null;
}

/**
 * SRD 2.0 gives each of loot and consumables two tables — the core set's and an
 * additional one. The core table's last rows share a page with the additional
 * table's heading, so membership is decided by whether a row falls before or after
 * that heading, not by which page it is on.
 */
function readTable(pageRange, table, label, splitAt) {
  const rows = [];

  for (const pageIndex of pageRange) {
    const blocks = (pages[pageIndex] ?? []).flat();
    // Page numbers in the footer look just like roll numbers, so drop the bottom
    // of the page (the footer sits below every table row).
    const footerYs = blocks
      .filter((b) => b.lines.some((l) => l.includes('Daggerheart SRD')))
      .map((b) => b.yMin);
    const footerY = footerYs.length > 0 ? Math.min(...footerYs) : Infinity;
    const rollBlocks = blocks.filter(
      (b) =>
        b.lines.length === 1 &&
        /^\d{1,2}$/.test(b.lines[0]) &&
        b.yMin < footerY - 5,
    );

    for (const rollBlock of rollBlocks) {
      const roll = Number(rollBlock.lines[0]);
      if (roll < 1 || roll > 60) continue;

      if (splitAt !== null) {
        const isAdditional = !before(readingKey(pageIndex, rollBlock), splitAt);
        if (isAdditional !== (table === 'additional')) continue;
      }

      // The name sits just right of the roll; the description further right again.
      const sameRow = blocks
        .filter((b) => b !== rollBlock && Math.abs(b.yMin - rollBlock.yMin) <= 8)
        .sort((a, b) => a.xMin - b.xMin);

      const nameBlock = sameRow.find(
        (b) => b.xMin > rollBlock.xMin && b.xMin < rollBlock.xMin + 60,
      );
      if (!nameBlock) {
        problems.push(`${label} roll ${roll} (page ${pageIndex + 1}): no name block`);
        continue;
      }
      const textBlock = sameRow.find((b) => b.xMin > nameBlock.xMin + 40);
      if (!textBlock) {
        problems.push(`${label} roll ${roll} (page ${pageIndex + 1}): no description block`);
        continue;
      }

      const name = nameBlock.lines.join(' ').replace(/\s+/g, ' ').trim();
      const text = textBlock.lines.join(' ').replace(/\s+/g, ' ').trim();
      if (name === '' || text === '') {
        problems.push(`${label} roll ${roll}: empty name or description`);
        continue;
      }
      rows.push({ table, roll, id: slug(name), name, text });
    }
  }

  rows.sort((a, b) => a.roll - b.roll);
  return rows;
}

// SRD 2.0: items on pages 75-79, consumables on 80-84, each split into the core
// set's table and an additional one.
const additionalItemsAt = findHeading('Additional Items');
const additionalConsumablesAt = findHeading('Additional Consumables');
if (additionalItemsAt === null) problems.push('could not locate the "Additional Items" heading');
if (additionalConsumablesAt === null) {
  problems.push('could not locate the "Additional Consumables" heading');
}

const ITEM_PAGES = [74, 75, 76, 77, 78];
const CONSUMABLE_PAGES = [79, 80, 81, 82, 83];

const loot = [
  ...readTable(ITEM_PAGES, 'core', 'loot (core)', additionalItemsAt),
  ...readTable(ITEM_PAGES, 'additional', 'loot (additional)', additionalItemsAt),
];
const consumables = [
  ...readTable(CONSUMABLE_PAGES, 'core', 'consumables (core)', additionalConsumablesAt),
  ...readTable(CONSUMABLE_PAGES, 'additional', 'consumables (additional)', additionalConsumablesAt),
];

for (const [label, rows] of [
  ['loot', loot],
  ['consumables', consumables],
]) {
  for (const table of ['core', 'additional']) {
    const rolls = rows.filter((r) => r.table === table).map((r) => r.roll);
    const dupes = [...new Set(rolls.filter((r, i) => rolls.indexOf(r) !== i))];
    if (dupes.length > 0) problems.push(`${label}/${table}: duplicate rolls ${dupes.join(',')}`);
    const missing = [];
    for (let i = 1; i <= 60; i++) if (!rolls.includes(i)) missing.push(i);
    if (missing.length > 0) problems.push(`${label}/${table}: missing rolls ${missing.join(',')}`);
  }
  const ids = rows.map((r) => r.id);
  const dupeIds = [...new Set(ids.filter((r, i) => ids.indexOf(r) !== i))];
  if (dupeIds.length > 0) problems.push(`${label}: duplicate ids ${dupeIds.join(',')}`);
}

console.log('loot:', loot.length, '| consumables:', consumables.length);
console.log('problems:', problems.length);
problems.slice(0, 20).forEach((p) => console.log('  !', p));

const out = new URL('../data/en/', import.meta.url);
fs.writeFileSync(new URL('loot.json', out), JSON.stringify(loot, null, 2) + '\n');
fs.writeFileSync(new URL('consumables.json', out), JSON.stringify(consumables, null, 2) + '\n');
