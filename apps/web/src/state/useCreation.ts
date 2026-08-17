import {
  applyChoice,
  createInitialState,
  validateStep,
  type CreationAction,
  type CreationState,
  type Step,
  type ValidationError,
} from '@daggerheart/character';
import { useCallback, useEffect, useState } from 'react';

import { clearCreation, loadCreation, saveCreation, type StorageLike } from './storage.js';

/**
 * Holds the wizard's state for one campaign's character. Every change goes through
 * `applyChoice`, so the reducer remains the single source of truth.
 */
export function useCreation(storage: StorageLike, campaignId: string) {
  const [state, setState] = useState<CreationState>(
    () => loadCreation(storage, campaignId) ?? createInitialState(),
  );

  // Auto-save after every change so a reload resumes exactly where it left off.
  useEffect(() => {
    saveCreation(storage, campaignId, state);
  }, [storage, campaignId, state]);

  const dispatch = useCallback((action: CreationAction) => {
    setState((current) => applyChoice(current, action));
  }, []);

  const reset = useCallback(() => {
    clearCreation(storage, campaignId);
    setState(createInitialState());
  }, [storage, campaignId]);

  const discard = useCallback(() => {
    clearCreation(storage, campaignId);
  }, [storage, campaignId]);

  return { state, dispatch, reset, discard };
}

/** Validation errors for a step, keyed by the field they belong to. */
export function errorsByField(errors: readonly ValidationError[]): Map<string, ValidationError[]> {
  const map = new Map<string, ValidationError[]>();
  for (const error of errors) {
    const key = error.field ?? '';
    const existing = map.get(key);
    if (existing) existing.push(error);
    else map.set(key, [error]);
  }
  return map;
}

/** Errors attached to one field, for rendering inline beneath it. */
export function fieldErrors(errors: readonly ValidationError[], field: string): readonly ValidationError[] {
  return errors.filter((e) => e.field === field);
}
