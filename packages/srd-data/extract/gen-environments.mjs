import fs from 'node:fs';
import { readPages } from './geo.mjs';

// Read from the bbox extraction so side-by-side columns never interleave.
const pages = readPages(new URL('./srd-bbox.xml', import.meta.url).pathname);

// Environment stat blocks, Tier 1 through Tier 4.
const lines = pages
  .slice(51, 57)
  .flatMap((columns) => columns.flat());

const MINOR_WORDS = new Set(['of', 'the', 'and', 'in', 'a', 'an']);
const titleCase = (s) =>
  s
    .toLowerCase()
    .split(' ')
    .map((word, i) =>
      i > 0 && MINOR_WORDS.has(word)
        ? word
        : word
            .replace(/^[a-z]/, (c) => c.toUpperCase())
            .replace(/-([a-z])/g, (_, c) => '-' + c.toUpperCase()),
    )
    .join(' ');

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const TYPE_LINE = /^Tier\s+(\d)\s+([A-Za-z]+)$/;
const FEATURE = /^(.+?)\s[-–]\s(Action|Reaction|Passive):\s*(.*)$/;

const isNoise = (l) => {
  const t = l.trim();
  return (
    t === '' ||
    t === 'Daggerheart SRD' ||
    /^\d{1,3}$/.test(t) ||
    /^TIER \d ENVIRONMENTS/.test(t) ||
    /^\(LEVELS?\s/i.test(t)
  );
};

const anchors = [];
lines.forEach((l, i) => {
  if (TYPE_LINE.test(l.trim())) {
    const m = TYPE_LINE.exec(l.trim());
    anchors.push({ i, tier: Number(m[1]), type: m[2] });
  }
});

const problems = [];
const environments = [];

anchors.forEach((anchor, n) => {
  const { i, tier, type } = anchor;

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
    problems.push(`line ${i}: no name above "Tier ${tier} ${type}"`);
    return;
  }

  const next = anchors[n + 1];
  let end = next === undefined ? lines.length : next.i;
  if (next !== undefined) {
    for (let j = next.i - 1; j >= 0; j--) {
      const t = lines[j].trim();
      if (isNoise(t) || !/[a-z]/.test(t)) end = j;
      else break;
    }
  }

  const body = lines.slice(i + 1, end).map((l) => l.trim()).filter((l) => !isNoise(l));

  const find = (re) => body.findIndex((l) => re.test(l));
  const impulsesIdx = find(/^Impulses:/);
  const difficultyIdx = find(/^Difficulty:/);
  const adversariesIdx = find(/^Potential Adversaries:/);
  const featuresIdx = body.findIndex((l) => l === 'FEATURES');

  if (difficultyIdx === -1) {
    problems.push(`${name}: no Difficulty`);
    return;
  }
  // A couple of environments print "Difficulty: Special" and derive it from a feature.
  const difficultyRaw = body[difficultyIdx].replace(/^Difficulty:\s*/, '').trim();
  const difficultyNum = /^(\d+)$/.exec(difficultyRaw);
  if (!difficultyNum && !/^Special/i.test(difficultyRaw)) {
    problems.push(`${name}: unparsed Difficulty "${difficultyRaw}"`);
    return;
  }
  const difficulty = difficultyNum ? Number(difficultyNum[1]) : 'special';

  // Multi-line fields run until the next labelled line.
  const gather = (from, ...stops) => {
    if (from === -1) return '';
    const out = [body[from]];
    for (let j = from + 1; j < body.length; j++) {
      if (stops.some((s) => s.test(body[j])) || body[j] === 'FEATURES') break;
      out.push(body[j]);
    }
    return out.join(' ').replace(/ {2,}/g, ' ').trim();
  };

  const LABEL = /^(Impulses|Difficulty|Potential Adversaries):/;
  const impulses = gather(impulsesIdx, LABEL).replace(/^Impulses:\s*/, '');
  const potentialAdversaries = gather(adversariesIdx, LABEL).replace(
    /^Potential Adversaries:\s*/,
    '',
  );

  const description = (impulsesIdx > 0 ? body.slice(0, impulsesIdx) : [])
    .join(' ')
    .replace(/ {2,}/g, ' ')
    .trim();

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

  environments.push({
    id: slug(name),
    name: titleCase(name),
    tier,
    type: type.toLowerCase(),
    description,
    impulses,
    difficulty,
    potentialAdversaries,
    features: features.map((f) => ({
      ...f,
      costsFear: /\bspend(?:s|ing)? (?:a|\d+) Fear\b/i.test(f.text),
    })),
  });
});

const seen = new Set();
for (const e of environments) {
  if (seen.has(e.id)) problems.push(`duplicate id: ${e.id}`);
  seen.add(e.id);
}

console.log('environments:', environments.length);
for (const t of [1, 2, 3, 4]) {
  console.log(`  tier ${t}: ${environments.filter((e) => e.tier === t).length}`);
}
console.log('types:', [...new Set(environments.map((e) => e.type))].sort().join(', '));
console.log('problems:', problems.length);
problems.slice(0, 30).forEach((p) => console.log('  !', p));

fs.writeFileSync(
  new URL('../data/en/environments.json', import.meta.url),
  JSON.stringify(environments, null, 2) + '\n',
);
