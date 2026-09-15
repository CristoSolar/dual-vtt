import type { ValidationError } from '@daggerheart/character';
import { describe, expect, it } from 'vitest';

import { en } from '../src/i18n/en.js';
import { es } from '../src/i18n/es.js';
import { describeEffect, describeValidation, resolveInitialLocale, setLocale, t } from '../src/i18n/index.js';

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

describe('describeValidation', () => {
  const knownError: ValidationError = {
    step: 5,
    code: 'weaponTierTooHigh',
    message: 'Longsword is Tier 2; characters start at Tier 1',
    field: 'equipment.primaryWeaponId',
    params: { name: 'Longsword', tier: 2, startingTier: 1 },
  };

  it('renders a known code with params in English', () => {
    setLocale('en');
    expect(describeValidation(knownError)).toBe('Longsword is Tier 2; characters start at Tier 1.');
  });

  it('renders the same known code with params in Spanish', () => {
    setLocale('es');
    expect(describeValidation(knownError)).toBe('Longsword es de Tier 2; los personajes empiezan en Tier 1.');
  });

  it('falls back to the raw message for an unknown code', () => {
    setLocale('en');
    const unknown: ValidationError = {
      step: 1,
      code: 'somethingMadeUp',
      message: 'a message no dictionary knows about',
      field: null,
    };
    expect(describeValidation(unknown)).toBe('a message no dictionary knows about');
  });
});
