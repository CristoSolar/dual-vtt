import fs from 'node:fs';
import { readPages } from './geo.mjs';

// The Domain Card Reference appendix, read column by column so cards stay intact.
const lines = readPages(new URL('./srd-bbox.xml', import.meta.url).pathname)
  .slice(59, 68)
  .flatMap((columns) => columns.flat());

const DOMAINS = [
  'Arcana',
  'Blade',
  'Bone',
  'Codex',
  'Grace',
  'Midnight',
  'Sage',
  'Splendor',
  'Valor',
];
const HEADER = new RegExp(`^Level (\\d+) (${DOMAINS.join('|')}) (Ability|Spell|Grimoire)$`);

const isNoise = (l) =>
  l === '' ||
  l === 'Daggerheart SRD' ||
  /^\d{1,3}$/.test(l) ||
  /^[A-Z][A-Z’' &-]+ DOMAIN$/.test(l) ||
  l === 'APPENDIX' ||
  l === 'DOMAIN CARD REFERENCE';

const isNameLine = (l) => !isNoise(l) && !/[a-z]/.test(l);

const headerIdx = [];
lines.forEach((l, i) => {
  if (HEADER.test(l)) headerIdx.push(i);
});

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const cards = [];
const problems = [];

headerIdx.forEach((hi, n) => {
  const [, level, domain, type] = HEADER.exec(lines[hi]);

  // Name: the all-caps line(s) directly above the header.
  const nameParts = [];
  for (let i = hi - 1; i >= 0; i--) {
    if (isNameLine(lines[i])) nameParts.unshift(lines[i]);
    else if (isNoise(lines[i]) && nameParts.length === 0) continue;
    else break;
  }
  const name = nameParts.join(' ').replace(/\s+/g, ' ').trim();
  if (name === '') problems.push(`card ${n}: no name above "${lines[hi]}"`);

  const recallLine = lines[hi + 1] ?? '';
  const rc = /^Recall Cost:\s*(\d+)$/.exec(recallLine);
  if (!rc) {
    problems.push(`${name}: expected "Recall Cost: N", got "${recallLine}"`);
    return;
  }

  // Body runs to the start of the next card's name block.
  const nextHeader = headerIdx[n + 1];
  let end = nextHeader === undefined ? lines.length : nextHeader;
  if (nextHeader !== undefined) {
    for (let i = nextHeader - 1; i >= 0; i--) {
      if (isNameLine(lines[i]) || isNoise(lines[i])) end = i;
      else break;
    }
  }

  const bodyLines = lines.slice(hi + 2, end).filter((l) => !isNoise(l));
  // Rewrap: hard-wrapped prose rejoins with a space; bullets start a new line.
  let body = '';
  for (const line of bodyLines) {
    if (body === '') {
      body = line;
      continue;
    }
    const lastLine = body.slice(body.lastIndexOf('\n') + 1);
    const inBullet = lastLine.startsWith('•');
    if (line.startsWith('•')) {
      body += `\n${line}`;
    } else if (inBullet && /[.!?]$/.test(lastLine) && /^[A-Z“"]/.test(line)) {
      // A finished bullet followed by a new sentence: prose resuming after the list.
      body += `\n${line}`;
    } else {
      body += ` ${line}`;
    }
  }
  body = body.replace(/ {2,}/g, ' ').trim();

  if (body === '') problems.push(`${name}: empty text`);

  cards.push({
    id: slug(name),
    name,
    level: Number(level),
    domain: domain.toLowerCase(),
    type: type.toLowerCase(),
    recallCost: Number(rc[1]),
    text: body,
  });
});

const seen = new Set();
for (const c of cards) {
  if (seen.has(c.id)) problems.push(`duplicate id: ${c.id} (${c.name})`);
  seen.add(c.id);
}

console.log('cards:', cards.length);
for (const d of DOMAINS) {
  const inDomain = cards.filter((c) => c.domain === d.toLowerCase());
  console.log(`  ${d}: ${inDomain.length} (levels ${[...new Set(inDomain.map((c) => c.level))].sort((a, b) => a - b).join(',')})`);
}
console.log('problems:', problems.length);
problems.slice(0, 40).forEach((p) => console.log('  !', p));

fs.writeFileSync(
  new URL('../data/domain-cards.json', import.meta.url),
  JSON.stringify(cards, null, 2) + '\n',
);
