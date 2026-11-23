import {
  MAX_BACKGROUND_LENGTH,
  MAX_CONNECTIONS,
  MAX_EXPERIENCE_NAME_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PRONOUNS_LENGTH,
  type EditCharacterRequest,
  type LibraryCharacter,
} from '@daggerheart/protocol';
import { useState } from 'react';

import { t, type MessageKey } from '../i18n/index.js';
import { detailsRequest, draftFromSheet, type DetailsDraft, type DetailsProblem } from '../state/library.js';
import { Dialog } from './Dialog.js';

const PROBLEM_KEYS: Record<DetailsProblem, MessageKey> = {
  emptyExperience: 'library.editDialog.emptyExperience',
  duplicateExperience: 'library.editDialog.duplicateExperience',
  halfConnection: 'library.editDialog.halfConnection',
};

/**
 * Edits who a character is — name, pronouns, background, Experience names,
 * connections. Mechanics are not offered: play and level-up change those.
 */
export function EditCharacterDialog({
  entry,
  onSave,
  onClose,
}: {
  entry: LibraryCharacter;
  /** Resolves true once the server accepted it. */
  onSave: (details: EditCharacterRequest) => Promise<boolean>;
  onClose: () => void;
}) {
  const sheet = entry.sheet;
  const [draft, setDraft] = useState<DetailsDraft>(() => draftFromSheet(sheet));
  const [problem, setProblem] = useState<DetailsProblem | null>(null);
  const [saving, setSaving] = useState(false);
  const modifiers = Object.values(sheet.character.experiences);
  const set = (patch: Partial<DetailsDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setConnection = (index: number, patch: Partial<DetailsDraft['connections'][number]>) =>
    set({ connections: draft.connections.map((c, i) => (i === index ? { ...c, ...patch } : c)) });

  const submit = async () => {
    const built = detailsRequest(sheet, draft);
    if (!built.ok) {
      setProblem(built.problem);
      return;
    }
    setProblem(null);
    setSaving(true);
    const ok = await onSave(built.request);
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Dialog
      title={t('library.editDialog.title', { name: sheet.character.name ?? t('library.unnamed') })}
      onClose={onClose}
    >
      <form
        className="edit-character"
        onSubmit={(event) => {
          event.preventDefault();
          if (!saving) void submit();
        }}
      >
        <p className="muted">{t('library.editDialog.hint')}</p>
        {entry.campaignId !== null ? (
          <p className="muted">
            {t('library.editDialog.linkedNote', { campaign: entry.campaignName ?? '—' })}
          </p>
        ) : null}

        <div className="grid cols-2">
          <div>
            <label htmlFor="edit-name">{t('library.editDialog.name')}</label>
            <input
              id="edit-name"
              type="text"
              maxLength={MAX_NAME_LENGTH}
              value={draft.name}
              placeholder={t('library.unnamed')}
              onChange={(e) => set({ name: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="edit-pronouns">{t('library.editDialog.pronouns')}</label>
            <input
              id="edit-pronouns"
              type="text"
              maxLength={MAX_PRONOUNS_LENGTH}
              value={draft.pronouns}
              onChange={(e) => set({ pronouns: e.target.value })}
            />
          </div>
        </div>

        <label htmlFor="edit-background">{t('library.editDialog.background')}</label>
        <textarea
          id="edit-background"
          maxLength={MAX_BACKGROUND_LENGTH}
          value={draft.background}
          onChange={(e) => set({ background: e.target.value })}
        />

        {draft.experiences.length > 0 ? (
          <fieldset className="edit-character-group">
            <legend>{t('library.editDialog.experiences')}</legend>
            {draft.experiences.map((name, index) => {
              const modifier = modifiers[index] ?? 0;
              return (
                <div key={index}>
                  <label htmlFor={`edit-experience-${index}`}>
                    {t('library.editDialog.experienceLabel', {
                      index: index + 1,
                      modifier: `${modifier >= 0 ? '+' : ''}${modifier}`,
                    })}
                  </label>
                  <input
                    id={`edit-experience-${index}`}
                    type="text"
                    maxLength={MAX_EXPERIENCE_NAME_LENGTH}
                    value={name}
                    onChange={(e) =>
                      set({ experiences: draft.experiences.map((n, i) => (i === index ? e.target.value : n)) })
                    }
                  />
                </div>
              );
            })}
          </fieldset>
        ) : null}

        <fieldset className="edit-character-group">
          <legend>{t('library.editDialog.connections')}</legend>
          {draft.connections.map((connection, index) => (
            <div className="edit-character-connection" key={index}>
              <div>
                <label htmlFor={`edit-connection-with-${index}`}>{t('library.editDialog.connectionWith')}</label>
                <input
                  id={`edit-connection-with-${index}`}
                  type="text"
                  maxLength={80}
                  value={connection.withCharacter}
                  onChange={(e) => setConnection(index, { withCharacter: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor={`edit-connection-what-${index}`}>{t('library.editDialog.connectionWhat')}</label>
                <input
                  id={`edit-connection-what-${index}`}
                  type="text"
                  maxLength={1000}
                  value={connection.description}
                  onChange={(e) => setConnection(index, { description: e.target.value })}
                />
              </div>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => set({ connections: draft.connections.filter((_, i) => i !== index) })}
              >
                {t('common.remove')}
              </button>
            </div>
          ))}
          {draft.connections.length < MAX_CONNECTIONS ? (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => set({ connections: [...draft.connections, { withCharacter: '', description: '' }] })}
            >
              {t('library.editDialog.addConnection')}
            </button>
          ) : null}
        </fieldset>

        {problem !== null ? (
          <p className="field-error" role="alert">
            {t(PROBLEM_KEYS[problem])}
          </p>
        ) : null}

        <div className="row edit-character-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? t('library.editDialog.saving') : t('library.editDialog.save')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
