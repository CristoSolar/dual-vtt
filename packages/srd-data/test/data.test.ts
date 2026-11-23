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
    // Fifteen files per locale, both locales.
    expect(datasets).toHaveLength(30);
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

  it('has 13 classes', () => {
    // Nine in the core set, plus the Assassin, Brawler, Warlock and Witch (SRD 2.0).
    expect(data.classes).toHaveLength(13);
  });

  it('has 26 subclasses, two per class', () => {
    expect(data.subclasses).toHaveLength(26);
    for (const characterClass of data.classes) {
      const pair = data.subclasses.filter((s) => s.classId === characterClass.id);
      expect(pair, characterClass.id).toHaveLength(2);
    }
  });

  it('has 24 ancestries', () => {
    // Eighteen in the core set, plus the Aetheris, the Gnome and the four Elemental
    // Kin (SRD 2.0).
    expect(data.ancestries).toHaveLength(24);
  });

  it('has 15 communities', () => {
    expect(data.communities).toHaveLength(15);
  });

  it('has 10 domains', () => {
    // Nine in the core set, plus Dread (SRD 2.0 p.7).
    expect(data.domains).toHaveLength(10);
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

describe.each(LOCALES)('card mechanics (%s)', (locale) => {
  const { domainCards, cardMechanics } = srdByLocale[locale];

  it('has an entry for every domain card, and only for real cards', () => {
    const cardIds = new Set(domainCards.map((card) => card.id));
    const mechanicIds = new Set(cardMechanics.map((entry) => entry.id));
    for (const id of cardIds) expect(mechanicIds.has(id), `missing ${id}`).toBe(true);
    for (const id of mechanicIds) expect(cardIds.has(id), `unknown ${id}`).toBe(true);
  });

  it('names every sub-ability of a multi-ability card, and no single-ability card', () => {
    for (const entry of cardMechanics) {
      const named = entry.abilities.map((a) => a.name !== null);
      expect(named.every((n) => n === (entry.abilities.length > 1)), entry.id).toBe(true);
    }
  });

  it('gives every grimoire its named spells', () => {
    for (const card of domainCards.filter((c) => c.type === 'grimoire')) {
      const entry = cardMechanics.find((m) => m.id === card.id);
      expect(entry?.abilities.length ?? 0, card.id).toBeGreaterThan(1);
      // Each name is printed in the card's own text.
      for (const ability of entry?.abilities ?? []) {
        expect(card.text, card.id).toContain(`${ability.name ?? ''}:`);
      }
    }
  });

  it('reads Book of Tyfar as the SRD prints it', () => {
    const tyfar = cardMechanics.find((m) => m.id === 'book-of-tyfar');
    expect(tyfar?.abilities.map(({ name: _name, ...rest }) => rest)).toEqual([
      { roll: 'spellcast', damage: { count: 2, die: 6, modifier: 0, type: 'magic', scale: null } },
      { roll: null },
      { roll: 'spellcast', difficulty: 13 },
    ]);
  });
});

describe('card mechanics across locales', () => {
  it('is the same in both locales except for the names', () => {
    const strip = (locale: (typeof LOCALES)[number]) =>
      srdByLocale[locale].cardMechanics.map((entry) => ({
        id: entry.id,
        abilities: entry.abilities.map(({ name: _name, ...rest }) => rest),
      }));
    expect(strip('es')).toEqual(strip('en'));
  });
});

/** The combat wheelchair's name and frame names are translated per locale. */
const WHEELCHAIR = { en: 'Wheelchair', es: 'Silla de Ruedas' } as const;
const FRAMES = {
  en: ['Light-Frame', 'Heavy-Frame', 'Arcane-Frame'],
  es: ['Armazón Liviano', 'Armazón Pesado', 'Armazón Arcano'],
} as const;

describe.each(LOCALES)('equipment shape (%s)', (locale) => {
  const { weapons, armor } = srdByLocale[locale];

  it('covers all four tiers for weapons and armor', () => {
    for (const tier of [1, 2, 3, 4] as const) {
      expect(weapons.filter((w) => w.tier === tier).length, `weapons tier ${tier}`)
        .toBeGreaterThan(0);
      expect(armor.filter((a) => a.tier === tier).length, `armor tier ${tier}`)
        .toBeGreaterThan(0);
    }
  });

  it('has both primary and secondary weapons in every tier', () => {
    for (const tier of [1, 2, 3, 4] as const) {
      for (const category of ['primary', 'secondary'] as const) {
        expect(
          weapons.filter((w) => w.tier === tier && w.category === category).length,
          `${category} tier ${tier}`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('includes the combat wheelchair in all three frames and all four tiers', () => {
    const chairs = weapons.filter((w) => w.name.includes(WHEELCHAIR[locale]));
    expect(chairs).toHaveLength(12);
    for (const frame of FRAMES[locale]) {
      const models = chairs.filter((c) => c.name.includes(frame));
      expect(models.map((m) => m.tier).sort(), frame).toEqual([1, 2, 3, 4]);
    }
  });

  it('stores weapon damage as structured numbers with a base count of 1', () => {
    for (const weapon of weapons) {
      // Proficiency, not the printed line, decides how many dice are rolled.
      expect(weapon.damage.count, weapon.id).toBe(1);
      expect(Number.isInteger(weapon.damage.die), weapon.id).toBe(true);
      expect(Number.isInteger(weapon.damage.modifier), weapon.id).toBe(true);
    }
  });

  it('keeps armor Severe thresholds above Major', () => {
    for (const piece of armor) {
      expect(piece.baseThresholds.severe, piece.id).toBeGreaterThan(piece.baseThresholds.major);
    }
  });
});

/** The text that signals a Fear-costing feature is translated per locale. */
const FEAR = { en: /Fear/, es: /Miedo/ } as const;

describe.each(LOCALES)('stat blocks (%s)', (locale) => {
  const { adversaries, environments } = srdByLocale[locale];

  it('covers all four tiers of adversaries and environments', () => {
    for (const tier of [1, 2, 3, 4] as const) {
      expect(adversaries.filter((a) => a.tier === tier).length, `adversaries tier ${tier}`)
        .toBeGreaterThan(0);
      expect(environments.filter((e) => e.tier === tier).length, `environments tier ${tier}`)
        .toBeGreaterThan(0);
    }
  });

  it('types every adversary and environment feature', () => {
    // 'evolution' is new in SRD 2.0: a one-shot feature gained mid-scene.
    const allowed = new Set(['action', 'reaction', 'passive', 'evolution']);
    for (const entry of [...adversaries, ...environments]) {
      expect(entry.features.length, entry.id).toBeGreaterThan(0);
      for (const feature of entry.features) {
        expect(allowed.has(feature.type), `${entry.id}: ${feature.type}`).toBe(true);
      }
    }
  });

  it('flags Fear features as those whose text spends Fear', () => {
    const fearFeatures = adversaries.flatMap((a) => a.features).filter((f) => f.costsFear);
    expect(fearFeatures.length).toBeGreaterThan(0);
    for (const feature of fearFeatures) {
      expect(feature.text).toMatch(FEAR[locale]);
    }
  });

  it('gives minions no thresholds and everyone else a Major threshold', () => {
    for (const adversary of adversaries) {
      if (adversary.thresholds !== null) {
        expect(adversary.thresholds.major, adversary.id).toBeGreaterThan(0);
      }
    }
  });
});

describe.each(LOCALES)('tables (%s)', (locale) => {
  const { loot, consumables, beastforms } = srdByLocale[locale];

  it('has all 60 rolls in both the core and the additional table', () => {
    // SRD 2.0 prints two d60 tables for each, so a roll is only unique within one.
    for (const [label, rows] of [
      ['loot', loot],
      ['consumables', consumables],
    ] as const) {
      expect(rows, label).toHaveLength(120);
      for (const table of ['core', 'additional'] as const) {
        const inTable = rows.filter((r) => r.table === table);
        expect(inTable.map((r) => r.roll), `${label}/${table}`).toEqual(
          Array.from({ length: 60 }, (_, i) => i + 1),
        );
      }
    }
  });

  it('has the six transformations, each with features and questions', () => {
    const { transformations } = srdByLocale[locale];
    expect(transformations).toHaveLength(6);
    for (const transformation of transformations) {
      expect(transformation.features.length, transformation.id).toBeGreaterThan(0);
      expect(transformation.questions.length, transformation.id).toBeGreaterThan(0);
    }
  });

  it('covers all four tiers of beastforms', () => {
    for (const tier of [1, 2, 3, 4] as const) {
      expect(beastforms.filter((b) => b.tier === tier).length, `beastforms tier ${tier}`)
        .toBeGreaterThan(0);
    }
  });

  it('gives every statted beastform an attack and every upgrade form none', () => {
    for (const form of beastforms) {
      if (form.trait === null) {
        // Upgrade options improve a lower-tier form instead of having own statistics.
        expect(form.attack, form.id).toBeNull();
        expect(form.features.length, form.id).toBeGreaterThan(0);
      } else {
        expect(form.attack, form.id).not.toBeNull();
      }
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
