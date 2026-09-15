import type { RollEntry, SheetEffect } from '@daggerheart/protocol';
import { LOCALES, setLocale as setSrdLocale, type Locale } from '@daggerheart/srd-data';
import { useSyncExternalStore } from 'react';

import { en } from './en.js';
import { es } from './es.js';

export type MessageKey = keyof typeof es;

const STORAGE_KEY = 'daggerheart-vtt:locale';
const dictionaries: Record<Locale, Record<MessageKey, string>> = { en, es };

const isLocale = (value: unknown): value is Locale =>
  typeof value === 'string' && (LOCALES as readonly string[]).includes(value);

/** Stored choice wins; otherwise an English browser gets English, everyone else Spanish. */
export function resolveInitialLocale(stored: string | null, navigatorLanguage: string): Locale {
  if (isLocale(stored)) return stored;
  return navigatorLanguage.toLowerCase().startsWith('en') ? 'en' : 'es';
}

function readStored(): string | null {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

// ponytail: module-level store; the App remounts on change via key={locale}, so
// individual components never subscribe. Swap for context if partial updates matter.
let locale: Locale = resolveInitialLocale(readStored(), globalThis.navigator?.language ?? 'es');
setSrdLocale(locale);
if (typeof document !== 'undefined') document.documentElement.lang = locale;

const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return locale;
}

export function setLocale(next: Locale): void {
  if (next === locale) return;
  locale = next;
  setSrdLocale(next);
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, next);
  } catch {
    // storage unavailable (private mode, quota) — the choice just doesn't persist
  }
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  for (const listener of listeners) listener();
}

export function useLocale(): Locale {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getLocale,
    getLocale,
  );
}

/** Looks a key up in the active dictionary and fills `{name}` placeholders. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const text = dictionaries[locale][key];
  if (params === undefined) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** Localized text for a sheet transition, or null when there is nothing to say. */
export function describeEffect(effect: SheetEffect): string | null {
  const parts: string[] = [];
  if (effect.stressBecameHP) parts.push(t('effect.stressBecameHP'));
  if (effect.vulnerable) parts.push(t('effect.vulnerable'));
  if (effect.deathMoveRequired) parts.push(t('effect.deathMoveRequired'));
  if (effect.code !== null) {
    const params = { ...(effect.params ?? {}), message: effect.message ?? '' };
    parts.push(t(`effect.${effect.code}` as MessageKey, params));
  }
  if (parts.length > 0) return parts.join(' ');
  return effect.message;
}

/** Localized toast for a server `rejected` payload; the code is shown for unknown ones. */
export function describeRejection(code: string): string {
  const key = `reject.${code}` as MessageKey;
  return key in es ? t(key) : t('reject.unknown', { code });
}

/** One line for a live "someone just rolled" notification. */
export function describeRollEntry(entry: RollEntry): string {
  if (entry.kind === 'duality') {
    return t('roll.dualityLine', {
      by: entry.by,
      label: entry.label,
      outcome: t(`roll.outcome.${entry.outcome}` as MessageKey),
      total: entry.roll.total,
    });
  }
  return t('roll.damageLine', { by: entry.by, label: entry.label, total: entry.roll.total });
}
