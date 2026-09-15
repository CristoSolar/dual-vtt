import { describe, expect, it } from 'vitest';

import { en } from '../src/i18n/en.js';
import { es } from '../src/i18n/es.js';
import { describeEffect, resolveInitialLocale, setLocale, t } from '../src/i18n/index.js';

describe('resolveInitialLocale', () => {
  it('prefers a valid stored value', () => {
    expect(resolveInitialLocale('en', 'es-CL')).toBe('en');
    expect(resolveInitialLocale('es', 'en-US')).toBe('es');
  });
  it('falls back to the browser language', () => {
    expect(resolveInitialLocale(null, 'en-GB')).toBe('en');
    expect(resolveInitialLocale(null, 'es-CL')).toBe('es');
    expect(resolveInitialLocale(null, 'fr')).toBe('es');
  });
  it('ignores garbage in storage', () => {
    expect(resolveInitialLocale('klingon', 'en')).toBe('en');
  });
});

describe('t', () => {
  it('interpolates params', () => {
    setLocale('en');
    expect(t('effect.notEnoughHope', { amount: 2 })).toBe('Not enough Hope (need 2).');
    setLocale('es');
    expect(t('effect.notEnoughHope', { amount: 2 })).toBe('No tienes suficiente Esperanza (necesitas 2).');
  });
  it('has the same keys in both dictionaries', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort());
  });
});

describe('describeEffect', () => {
  const base = { vulnerable: false, deathMoveRequired: false, stressBecameHP: false, message: null, code: null } as const;
  it('returns null for an empty effect', () => {
    expect(describeEffect(base)).toBeNull();
  });
  it('composes from the booleans first', () => {
    setLocale('en');
    expect(describeEffect({ ...base, stressBecameHP: true, vulnerable: true })).toBe(
      'No Stress left — marked 1 Hit Point instead. All Stress marked — you are Vulnerable.',
    );
  });
  it('renders a code with params', () => {
    setLocale('es');
    expect(describeEffect({ ...base, code: 'levelledUp', params: { level: 3 }, message: 'x' })).toBe('Subiste al nivel 3.');
  });
  it('falls back to message when there is no code', () => {
    expect(describeEffect({ ...base, message: 'raw' })).toBe('raw');
  });
});
