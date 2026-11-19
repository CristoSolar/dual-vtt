import { srd } from '@daggerheart/srd-data';
import { afterEach, describe, expect, it } from 'vitest';

import { getLocale, setLocale } from '../src/i18n/index.js';
import { domainIconUrl } from '../src/state/art.js';
import {
  cardTypeLabel,
  domainName,
  domainSummary,
  firstSentence,
  groupCardsByDomain,
} from '../src/state/domains.js';

const card = (domain: string, level: number, name: string) => ({ domain, level, name });

describe('groupCardsByDomain', () => {
  it('puts the given domains first, in that order, and drops the empty ones', () => {
    const groups = groupCardsByDomain(
      [card('grace', 1, 'A'), card('midnight', 1, 'B'), card('codex', 1, 'C')],
      ['midnight', 'grace', 'sage'],
    );
    expect(groups.map((g) => g.domain)).toEqual(['midnight', 'grace', 'codex']);
  });

  it('sorts each group by level, then by name', () => {
    const [group] = groupCardsByDomain([
      card('blade', 2, 'Alpha'),
      card('blade', 1, 'Zeta'),
      card('blade', 1, 'Beta'),
    ]);
    expect(group?.cards.map((c) => `${c.level}${c.name}`)).toEqual(['1Beta', '1Zeta', '2Alpha']);
  });

  it('does not reorder the input array', () => {
    const input = [card('bone', 2, 'B'), card('bone', 1, 'A')];
    groupCardsByDomain(input);
    expect(input.map((c) => c.name)).toEqual(['B', 'A']);
  });

  it("covers every level-1 card of a class's two domains", () => {
    const rogue = srd().classes.find((c) => c.id === 'rogue');
    const cards = srd().domainCards.filter((c) => c.level === 1 && rogue?.domains.includes(c.domain));
    const groups = groupCardsByDomain(cards, rogue?.domains ?? []);
    expect(groups.map((g) => g.domain)).toEqual(rogue?.domains);
    expect(groups.flatMap((g) => g.cards)).toHaveLength(cards.length);
  });
});

describe('domain labels', () => {
  const initial = getLocale();
  afterEach(() => setLocale(initial));

  it('names domains and card types in the current locale', () => {
    setLocale('es');
    expect(domainName('midnight')).toBe('Medianoche');
    expect(cardTypeLabel('spell')).toBe('Hechizo');
    expect(cardTypeLabel('ability')).toBe('Habilidad');
    setLocale('en');
    expect(domainName('midnight')).toBe('Midnight');
    expect(cardTypeLabel('grimoire')).toBe('Grimoire');
  });

  it('falls back to the id for an unknown domain', () => {
    expect(domainName('nowhere')).toBe('nowhere');
    expect(domainSummary('nowhere')).toBe('');
  });

  it('summarises a domain with its first sentence', () => {
    expect(firstSentence('One thing. Another thing.')).toBe('One thing.');
    expect(firstSentence('No full stop')).toBe('No full stop');
    expect(domainSummary('blade').endsWith('.')).toBe(true);
  });

  it('versions the icon URL like the rest of the art', () => {
    expect(domainIconUrl('sage')).toMatch(/^\/images\/domains\/sage\.svg\?v=\w+$/);
  });
});
