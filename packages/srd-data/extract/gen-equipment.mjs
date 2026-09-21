import fs from 'node:fs';
import { readBlocks } from './geo.mjs';

/**
 * Weapons and armor, from the equipment tables (SRD 2.0 pp.56-74).
 *
 * These are true grid tables: every cell is its own positioned block, laid out under
 * a header row of "Name", "Trait", "Range" and so on. Rows are rebuilt by matching
 * cells to the header column above them and to each other by height, which is the
 * same approach `gen-loot.mjs` takes and the only one that survives a name or a
 * feature wrapping onto a second line.
 *
 * SRD 1.0's tables were transcribed inline because they were short. 2.0's are not:
 * 303 weapons and 69 armors, so they are read off the page like everything else.
 */

const pages = readBlocks(new URL('./srd-bbox.xml', import.meta.url).pathname);

const problems = [];

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const RANGES = {
  Melee: 'melee',
  'Very Close': 'veryClose',
  Close: 'close',
  Far: 'far',
  'Very Far': 'veryFar',
};

// "Spellcast" stands in for whichever trait the wielder's subclass uses.
const TRAITS = [
  'Agility', 'Strength', 'Finesse', 'Instinct', 'Presence', 'Knowledge', 'Spellcast',
];

/** A row's cells sit within this many points of the row's own top edge. */
const ROW_TOLERANCE = 9;
/**
 * Header cells are allowed to sit further apart than body cells: the armor table
 * sets "Base Thresholds" over two lines, which lifts its top edge above the
 * single-line headers beside it.
 */
const HEADER_TOLERANCE = 16;

/**
 * Reads every grid table on a page.
 *
 * A header row is a run of known header cells at the same height; the rows beneath
 * belong to it until the next header row or the bottom of the page. A cell belongs
 * to the column whose header it sits closest under, so a wrapped cell that starts
 * slightly left of its header still lands in the right column.
 */
function readTables(pageIndex, headerNames, carried = null) {
  const blocks = (pages[pageIndex] ?? []).flat().sort((a, b) => a.yMin - b.yMin);
  const headerText = (b) => b.lines.join(' ').replace(/\s+/g, ' ').trim();
  const headerCells = blocks.filter((b) => headerNames.includes(headerText(b)));

  // Group the header cells into rows: one group per table on the page.
  const headerRows = [];
  for (const cell of headerCells) {
    const row = headerRows.find((r) => Math.abs(r.y - cell.yMin) <= HEADER_TOLERANCE);
    if (row === undefined) headerRows.push({ y: cell.yMin, cells: [cell] });
    else row.cells.push(cell);
  }
  // A two-line header starts higher than its neighbours, so the row's own top edge
  // is the lowest of its cells: that is where the body begins.
  for (const row of headerRows) row.y = Math.max(...row.cells.map((c) => c.yMin));
  headerRows.sort((a, b) => a.y - b.y);

  const tables = [];

  /** Turns a column layout and a slice of the page into rows. */
  const rowsIn = (columns, from, to) => {
    // A cell whose whole text is a header name is a header, never data: on a page
    // where a table continues, its own header row sits inside the carried slice.
    const body = blocks.filter(
      (b) => b.yMin > from && b.yMin < to && !headerNames.includes(headerText(b)),
    );

    // The first column's cells define the rows; everything else joins them by height.
    const first = columns[0];
    const nextX = columns[1] === undefined ? Infinity : columns[1].x;
    const anchors = body.filter((b) => b.xMin >= first.x - 6 && b.xMin < nextX - 6);

    return anchors.map((anchor) => {
      const cells = { [first.name]: anchor.lines.join(' ').replace(/\s+/g, ' ').trim() };
      for (const block of body) {
        if (block === anchor) continue;
        if (Math.abs(block.yMin - anchor.yMin) > ROW_TOLERANCE) continue;
        // Nearest header at or left of this cell's own left edge.
        const column = [...columns].reverse().find((c) => block.xMin >= c.x - 6);
        if (column === undefined || column.name === first.name) continue;
        const text = block.lines.join(' ').replace(/\s+/g, ' ').trim();
        cells[column.name] = cells[column.name] === undefined ? text : `${cells[column.name]} ${text}`;
      }
      return cells;
    });
  };

  // A table can run onto the next page without repeating its header row. Those rows
  // sit above this page's first header and belong to the layout carried over.
  if (carried !== null) {
    const firstHeaderY = headerRows[0] === undefined ? Infinity : headerRows[0].y - ROW_TOLERANCE;
    const rows = rowsIn(carried, 0, firstHeaderY);
    if (rows.length > 0) tables.push({ y: 0, rows, columns: carried, continued: true });
  }

  headerRows.forEach((header, n) => {
    const columns = header.cells
      .map((c) => ({ name: headerText(c), x: c.xMin }))
      .sort((a, b) => a.x - b.x);
    const from = header.y + ROW_TOLERANCE;
    const to = headerRows[n + 1] === undefined ? Infinity : headerRows[n + 1].y - ROW_TOLERANCE;
    tables.push({ y: header.y, rows: rowsIn(columns, from, to), columns });
  });

  return tables;
}

/** The section headings above a table, used to label its rows. */
function headingsOn(pageIndex) {
  return (pages[pageIndex] ?? [])
    .flat()
    .filter((b) => b.lines.length === 1)
    .map((b) => ({ y: b.yMin, text: b.lines[0].trim() }))
    .sort((a, b) => a.y - b.y);
}

/** The most recent heading above `y` that matches `pattern`. */
function headingAbove(headings, y, pattern) {
  let found = null;
  for (const heading of headings) {
    if (heading.y >= y) break;
    if (pattern.test(heading.text)) found = heading.text;
  }
  return found;
}

// --- weapons ---------------------------------------------------------------

const WEAPON_HEADERS = ['Name', 'Tier', 'Trait', 'Range', 'Damage', 'Burden', 'Feature'];

/** Printed page ranges, inclusive. The PDF's numbering matches the printed one. */
const WEAPON_PAGES = [56, 69];
const WHEELCHAIR_PAGES = [70, 71];
const ARMOR_PAGES = [72, 74];

const weapons = [];

/**
 * `tierFromPage` carries the current tier across pages: a table can continue onto a
 * page with no heading of its own.
 */
let currentTier = null;

/**
 * Primary and secondary weapons are one continuous run of tables, and the primary
 * run spills onto the page that opens the secondary one, so the category switches at
 * the "SECONDARY WEAPON TABLES" heading rather than at a page boundary.
 */
let currentCategory = 'primary';

function readWeaponPages([from, to], fixedCategory) {
  for (let page = from; page <= to; page++) {
    const index = page - 1;
    const headings = headingsOn(index);
    for (const table of readTables(index, WEAPON_HEADERS)) {
      if (headingAbove(headings, table.y, /^SECONDARY WEAPON TABLES$/) !== null) {
        currentCategory = 'secondary';
      }
      const category = fixedCategory ?? currentCategory;
      const tierText = headingAbove(headings, table.y, /^TIER \d /);
      if (tierText !== null) currentTier = Number(/^TIER (\d) /.exec(tierText)[1]);
      // The wheelchair tables carry their tier in a column instead of a heading.
      const perRowTier = table.rows.some((r) => r.Tier !== undefined);

      for (const row of table.rows) {
        let name = row.Name;
        if (name === undefined || name === '') continue;
        // On a few rows the name sits close enough to the trait that they come back
        // as one block. The trait is a fixed vocabulary, so it can be lifted back
        // out of the name rather than guessed at.
        if (row.Trait === undefined) {
          const words = name.split(' ');
          const at = words.findIndex((w) => TRAITS.includes(w));
          if (at !== -1) {
            row.Trait = words[at];
            name = [...words.slice(0, at), ...words.slice(at + 1)].join(' ');
          }
        }
        // Section headings and the page footer sit in the Name column's x range but
        // have no row beside them, which is what tells them apart from a weapon.
        if (row.Damage === undefined) continue;
        const tier = perRowTier ? Number(row.Tier) : currentTier;
        if (!Number.isInteger(tier) || tier < 1 || tier > 4) {
          problems.push(`${category} "${name}" (p.${page}): no tier`);
          continue;
        }

        const damage = row.Damage ?? '';
        // "phy/mag" is a weapon whose feature lets the wielder pick each hit's type.
        const parsed = /^(?:(\d*)d(\d+))?\s*(?:\+\s*(\d+))?\s*(phy\/mag|phy|mag)$/.exec(
          damage.trim(),
        );
        if (parsed === null) {
          problems.push(`${category} "${name}" (p.${page}): unparsed damage "${damage}"`);
          continue;
        }
        const range = RANGES[row.Range ?? ''];
        if (range === undefined) {
          problems.push(`${category} "${name}" (p.${page}): unknown range "${row.Range}"`);
          continue;
        }
        const trait = (row.Trait ?? '').trim();
        if (!TRAITS.includes(trait)) {
          problems.push(`${category} "${name}" (p.${page}): unknown trait "${trait}"`);
          continue;
        }
        const BURDENS = { 'One-Handed': 'oneHanded', 'Two-Handed': 'twoHanded' };
        const burden = BURDENS[(row.Burden ?? '').trim()];
        if (burden === undefined) {
          problems.push(`${category} "${name}" (p.${page}): burden "${row.Burden}"`);
          continue;
        }

        const featureText = (row.Feature ?? '').trim();
        const feature =
          featureText === '' || featureText === '-' || featureText === '—'
            ? null
            : (() => {
                const m = /^(.+?):\s*(.+)$/.exec(featureText);
                return m === null
                  ? { name: featureText, text: featureText }
                  : { name: m[1].trim(), text: m[2].trim() };
              })();

        weapons.push({
          id: slug(name),
          name,
          tier,
          category,
          trait: trait.toLowerCase(),
          range,
          damage: {
            count: parsed[1] === undefined || parsed[1] === '' ? 1 : Number(parsed[1]),
            die: Number(parsed[2]),
            modifier: parsed[3] === undefined ? 0 : Number(parsed[3]),
          },
          damageType:
            parsed[4] === 'phy' ? 'physical' : parsed[4] === 'mag' ? 'magic' : 'physicalOrMagic',
          burden,
          feature,
        });
      }
    }
  }
}

readWeaponPages(WEAPON_PAGES, null);
currentTier = null;
// A combat wheelchair is equipped in the primary slot (SRD 2.0 p.70), so it is a
// primary weapon that happens to be printed in a table of its own.
readWeaponPages(WHEELCHAIR_PAGES, 'primary');

// --- armor -----------------------------------------------------------------

const ARMOR_HEADERS = ['Name', 'Base Thresholds', 'Base Score', 'Feature'];
const armor = [];

let armorColumns = null;
let armorTier = null;

for (let page = ARMOR_PAGES[0]; page <= ARMOR_PAGES[1]; page++) {
  const index = page - 1;
  const headings = headingsOn(index);
  for (const table of readTables(index, ARMOR_HEADERS, armorColumns)) {
    if (table.columns !== undefined) armorColumns = table.columns;
    const tierText = table.continued === true
      ? null
      : headingAbove(headings, table.y, /^TIER \d /);
    if (tierText !== null) armorTier = Number(/^TIER (\d) /.exec(tierText)[1]);
    const tier = armorTier;

    for (const row of table.rows) {
      const name = row.Name;
      if (name === undefined || name === '') continue;
      if (row['Base Thresholds'] === undefined) continue;
      if (tier === null) {
        problems.push(`armor "${name}" (p.${page}): no tier heading above the table`);
        continue;
      }
      const thresholds = /^(\d+)\s*\/\s*(\d+)$/.exec((row['Base Thresholds'] ?? '').trim());
      if (thresholds === null) {
        problems.push(`armor "${name}" (p.${page}): unparsed thresholds "${row['Base Thresholds']}"`);
        continue;
      }
      const score = Number(row['Base Score']);
      if (!Number.isInteger(score)) {
        problems.push(`armor "${name}" (p.${page}): unparsed base score "${row['Base Score']}"`);
        continue;
      }

      const featureText = (row.Feature ?? '').trim();
      const feature =
        featureText === '' || featureText === '-' || featureText === '—'
          ? null
          : (() => {
              const m = /^(.+?):\s*(.+)$/.exec(featureText);
              return m === null
                ? { name: featureText, text: featureText }
                : { name: m[1].trim(), text: m[2].trim() };
            })();

      armor.push({
        id: slug(name),
        name,
        tier,
        baseThresholds: { major: Number(thresholds[1]), severe: Number(thresholds[2]) },
        baseScore: score,
        feature,
      });
    }
  }
}

// --- checks and output -----------------------------------------------------

for (const [label, rows] of [['weapons', weapons], ['armor', armor]]) {
  const ids = rows.map((r) => r.id);
  const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  if (dupes.length > 0) problems.push(`${label}: duplicate ids ${dupes.join(', ')}`);
}

const byCategory = (category) => weapons.filter((w) => w.category === category).length;
console.log('weapons:', weapons.length);
console.log('  primary:', byCategory('primary'), '(combat wheelchairs included)');
console.log('  secondary:', byCategory('secondary'));
console.log('armor:', armor.length);
console.log('problems:', problems.length);
problems.slice(0, 40).forEach((p) => console.log('  !', p));

fs.writeFileSync(
  new URL('../data/en/weapons.json', import.meta.url),
  JSON.stringify(weapons, null, 2) + '\n',
);
fs.writeFileSync(
  new URL('../data/en/armor.json', import.meta.url),
  JSON.stringify(armor, null, 2) + '\n',
);
