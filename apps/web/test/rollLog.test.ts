import type { RollEntry } from '@daggerheart/protocol';
import { srd } from '@daggerheart/srd-data';
import { afterEach, describe, expect, it } from 'vitest';

import { setLocale, t } from '../src/i18n/index.js';
import { describeRollEntry, effectCopy } from '../src/state/rollLog.js';

afterEach(() => setLocale('es'));

const effect = (over: Partial<Extract<RollEntry, { kind: 'effect' }>>): Extract<RollEntry, { kind: 'effect' }> => ({
  kind: 'effect',
  id: 'e1',
  at: 0,
  by: 'Ash',
  byId: 'p1',
  source: 'domainCard',
  ref: 'x',
  feature: null,
  title: 'As logged',
  ...over,
});

describe('effectCopy', () => {
  it('reads a domain card in the reader’s own language', () => {
    const card = srd().domainCards[0];
    if (card === undefined) throw new Error('no cards');
    expect(effectCopy(effect({ ref: card.id }))).toEqual({ title: card.name, text: card.text });
  });

  it('reads a class Hope feature, and an adversary or environment feature by its place', () => {
    const cls = srd().classes[0];
    const adversary = srd().adversaries[0];
    const environment = srd().environments[0];
    if (cls === undefined || adversary === undefined || environment === undefined) throw new Error('no data');
    expect(effectCopy(effect({ source: 'hopeFeature', ref: cls.id }))).toEqual({
      title: cls.hopeFeature.name,
      text: cls.hopeFeature.text,
    });
    expect(effectCopy(effect({ source: 'adversaryFeature', ref: adversary.id, feature: 0 }))).toEqual({
      title: adversary.features[0]?.name,
      text: adversary.features[0]?.text,
    });
    expect(effectCopy(effect({ source: 'environmentFeature', ref: environment.id, feature: 0 }))).toEqual({
      title: environment.features[0]?.name,
      text: environment.features[0]?.text,
    });
  });

  it('falls back to the logged name when the reference is unknown', () => {
    expect(effectCopy(effect({ ref: 'gone' }))).toEqual({ title: 'As logged', text: null });
  });
});

describe('describeRollEntry for the tray and effects', () => {
  it('names the dice, total and the effect used', () => {
    const dice: RollEntry = {
      kind: 'dice',
      id: 'd1',
      at: 0,
      by: 'Ash',
      byId: 'p1',
      label: '2d6+1',
      groups: [{ sides: 6, rolls: [3, 5] }],
      modifier: 1,
      total: 9,
    };
    expect(describeRollEntry(dice)).toBe(t('roll.diceLine', { by: 'Ash', label: '2d6+1', total: 9 }));
    expect(describeRollEntry(effect({ ref: 'gone' }))).toBe(t('roll.effectLine', { by: 'Ash', title: 'As logged' }));
  });
});
