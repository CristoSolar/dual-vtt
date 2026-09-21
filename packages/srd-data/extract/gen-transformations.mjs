import fs from 'node:fs';
import { readPages } from './geo.mjs';

/**
 * Transformations (SRD 2.0 pp.42-45), new in 2.0.
 *
 * Each is a name in caps, a paragraph of description, a "TRANSFORMATION FEATURES"
 * block written as "Name: text", and a list of questions the player answers. A
 * transformation card does not count against the loadout maximum, and a character
 * can only carry one.
 */

const PAGES = [42, 45];

const lines = readPages(new URL('./srd-bbox.xml', import.meta.url).pathname)
  .slice(PAGES[0] - 1, PAGES[1])
  .flatMap((columns) => columns.flat())
  .map((l) => l.trim())
  .filter((l) => l !== '' && l !== 'Daggerheart SRD' && !/^\d{1,3}$/.test(l));

const NAMES = ['DEMIGOD', 'GHOST', 'REANIMATED', 'SHAPESHIFTER', 'VAMPIRE', 'WEREWOLF'];
const FEATURES = 'TRANSFORMATION FEATURES';
const QUESTIONS = 'TRANSFORMATION QUESTIONS';

const problems = [];

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const titleCase = (s) => s.charAt(0) + s.slice(1).toLowerCase();

const FEATURE = /^([^:]{1,40}):\s*(.+)$/;
const isHeading = (line) => /^[A-Z][A-Z’' -]{3,}$/.test(line);

const transformations = [];

NAMES.forEach((name) => {
  const start = lines.indexOf(name);
  if (start === -1) {
    problems.push(`${name}: no heading`);
    return;
  }

  const featuresAt = lines.indexOf(FEATURES, start);
  const questionsAt = lines.indexOf(QUESTIONS, featuresAt);
  if (featuresAt === -1 || questionsAt === -1) {
    problems.push(`${name}: no features or questions block`);
    return;
  }

  // Description: the prose between the name and its features.
  const description = lines
    .slice(start + 1, featuresAt)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Features: "Name: text", wrapping onto the lines beneath.
  const features = [];
  for (const line of lines.slice(featuresAt + 1, questionsAt)) {
    const match = FEATURE.exec(line);
    const startsFeature = match !== null && !/[.!?]/.test(match[1]) && /^[A-Z]/.test(match[1]);
    if (startsFeature) {
      features.push({ name: match[1].trim(), text: match[2].trim() });
      continue;
    }
    const current = features[features.length - 1];
    if (current === undefined) {
      problems.push(`${name}: text before any feature`);
      continue;
    }
    current.text = `${current.text} ${line}`.replace(/ {2,}/g, ' ').trim();
  }

  // Questions: the bullets under the heading, up to the next transformation.
  const questions = [];
  for (let i = questionsAt + 1; i < lines.length; i++) {
    const line = lines[i];
    if (isHeading(line)) break;
    if (line.startsWith('•')) questions.push(line.replace(/^•\s*/, ''));
    else if (questions.length > 0) {
      questions[questions.length - 1] = `${questions[questions.length - 1]} ${line}`
        .replace(/ {2,}/g, ' ')
        .trim();
    }
  }

  if (description === '') problems.push(`${name}: empty description`);
  if (features.length === 0) problems.push(`${name}: no features`);
  if (questions.length === 0) problems.push(`${name}: no questions`);

  transformations.push({ id: slug(name), name: titleCase(name), description, features, questions });
});

console.log('transformations:', transformations.length);
console.log('problems:', problems.length);
problems.slice(0, 20).forEach((p) => console.log('  !', p));

fs.writeFileSync(
  new URL('../data/en/transformations.json', import.meta.url),
  JSON.stringify([...transformations].sort((a, b) => a.id.localeCompare(b.id)), null, 2) + '\n',
);
