import { describe, expect, it } from 'vitest';

import {
  datasets,
  formatDice,
  formatModifier,
  LOCALES,
  srd,
  srdByLocale,
  setLocale,
  getLocale,
} from '../src/index.js';

describe('schema validation', () => {
  it('parses every dataset against its schema', () => {
    expect(datasets).toHaveLength(26);
    for (const { name, schema, raw } of datasets) {
      const result = schema.safeParse(raw);
      expect(result.success, `${name}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });
});

describe('locale switch', () => {
  it('defaults to es and switches', () => {
    expect(getLocale()).toBe('es');
    expect(srd().classes.find((c) => c.id === 'bard')?.name).toBe('Bardo');
    setLocale('en');
    expect(getLocale()).toBe('en');
    expect(srd().classes.find((c) => c.id === 'bard')?.name).toBe('Bard');
    setLocale('es');
  });

  it('keeps the same ordered ids in every file across locales', () => {
    const keys = Object.keys(srdByLocale.en) as (keyof typeof srdByLocale.en)[];
    for (const key of keys) {
      const en = (srdByLocale.en[key] as readonly { id: string }[]).map((entry) => entry.id);
      const es = (srdByLocale.es[key] as readonly { id: string }[]).map((entry) => entry.id);
      expect(es, key).toEqual(en);
    }
  });
});

describe.each(LOCALES)('completeness (%s)', (locale) => {
  const data = srdByLocale[locale];

  it('has 9 classes', () => {
    expect(data.classes).toHaveLength(9);
  });

  it('has 18 subclasses, two per class', () => {
    expect(data.subclasses).toHaveLength(18);
    for (const characterClass of data.classes) {
      const pair = data.subclasses.filter((s) => s.classId === characterClass.id);
      expect(pair, characterClass.id).toHaveLength(2);
    }
  });

  it('has 18 ancestries', () => {
    expect(data.ancestries).toHaveLength(18);
  });

  it('has 9 communities', () => {
    expect(data.communities).toHaveLength(9);
  });

  it('has 9 domains', () => {
    expect(data.domains).toHaveLength(9);
  });
});

describe.each(LOCALES)('referential integrity (%s)', (locale) => {
  const { domains, classes, subclasses, domainCards, ancestries } = srdByLocale[locale];

  it('maps every class to exactly 2 existing domains', () => {
    const domainIds = new Set(domains.map((d) => d.id));
    for (const characterClass of classes) {
      expect(characterClass.domains, characterClass.id).toHaveLength(2);
      expect(new Set(characterClass.domains).size, `${characterClass.id} duplicate`).toBe(2);
      for (const domain of characterClass.domains) {
        expect(domainIds.has(domain), `${characterClass.id} -> ${domain}`).toBe(true);
      }
    }
  });

  it('keeps class.domains and domain.classes in agreement', () => {
    for (const domain of domains) {
      for (const classId of domain.classes) {
        const characterClass = classes.find((c) => c.id === classId);
        expect(characterClass, `${domain.id} -> ${classId}`).toBeDefined();
        expect(characterClass?.domains, `${classId} should access ${domain.id}`).toContain(domain.id);
      }
    }
    for (const characterClass of classes) {
      for (const domainId of characterClass.domains) {
        expect(domains.find((d) => d.id === domainId)?.classes).toContain(characterClass.id);
      }
    }
  });

  it("resolves every class's subclass ids", () => {
    const subclassIds = new Set(subclasses.map((s) => s.id));
    for (const characterClass of classes) {
      for (const id of characterClass.subclasses) {
        expect(subclassIds.has(id), `${characterClass.id} -> ${id}`).toBe(true);
      }
    }
  });

  it("resolves every subclass's classId", () => {
    const classIds = new Set(classes.map((c) => c.id));
    for (const subclass of subclasses) {
      expect(classIds.has(subclass.classId), subclass.id).toBe(true);
    }
  });

  it("has every domain card's domain present in domains.json", () => {
    const domainIds = new Set(domains.map((d) => d.id));
    for (const card of domainCards) {
      expect(domainIds.has(card.domain), `${card.id} -> ${card.domain}`).toBe(true);
    }
  });

  it('gives every ancestry one first-slot and one second-slot feature', () => {
    for (const ancestry of ancestries) {
      expect(ancestry.features.map((f) => f.slot), ancestry.id).toEqual(['first', 'second']);
    }
  });

  it('uses unique ids within every dataset', () => {
    const data = srdByLocale[locale];
    for (const key of Object.keys(data) as (keyof typeof data)[]) {
      const ids = data[key].map((entry) => entry.id);
      expect(new Set(ids).size, key).toBe(ids.length);
    }
  });
});

describe('formatting', () => {
  it('formats dice', () => {
    expect(formatDice({ count: 1, die: 8, modifier: 3 })).toBe('1d8+3');
    expect(formatDice({ count: 2, die: 8, modifier: 3 })).toBe('2d8+3');
    expect(formatDice({ count: 2, die: 6, modifier: 0 })).toBe('2d6');
    expect(formatDice({ count: 1, die: 10, modifier: -1 })).toBe('1d10−1');
  });
  it('formats modifiers', () => {
    expect(formatModifier(2)).toBe('+2');
    expect(formatModifier(0)).toBe('+0');
    expect(formatModifier(-1)).toBe('−1');
  });
});
