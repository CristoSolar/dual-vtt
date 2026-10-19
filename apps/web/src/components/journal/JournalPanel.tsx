import type { JournalEntry, MapNote, RoomEvent } from '@daggerheart/protocol';
import { useState } from 'react';

import { t } from '../../i18n/index.js';
import { uploadImage } from '../../state/uploadMap.js';
import { SERVER_URL } from '../../state/useCampaign.js';

interface JournalPanelProps {
  /** Everything for the GM; only what has been shared for a player. */
  journal: readonly JournalEntry[];
  isGameMaster: boolean;
  /** The entry being read, or null for the list. Lifted so a map pin can open one. */
  openId: string | null;
  onOpen: (id: string | null) => void;
  send: (event: RoomEvent) => void;
  /** The session token, which image uploads need. */
  authToken: string | null;
  /** Notes on the scene in view, so the GM can see what is pinned there. */
  notes: readonly MapNote[];
  /** Pins an entry to the scene in view, or takes a pin off it. Absent with no scene. */
  onPin?: (journalId: string) => void;
  onUnpin?: (noteId: string) => void;
}

let counter = 0;
const nextJournalId = () => {
  counter += 1;
  return `jrn-${Date.now().toString(36)}-${counter.toString(36)}`;
};

/** Uploads are served by the API, which may be on another origin than the app. */
export const imageSrc = (url: string) => (url.startsWith('http') ? url : `${SERVER_URL}${url}`);

/**
 * The journal: a list of entries and, once one is open, its page. The GM reads,
 * edits, shares, and pins; a player only reads what the GM has shared, which is all
 * the server ever sends them.
 */
export function JournalPanel({
  journal,
  isGameMaster,
  openId,
  onOpen,
  send,
  authToken,
  notes,
  onPin,
  onUnpin,
}: JournalPanelProps) {
  const open = journal.find((entry) => entry.id === openId) ?? null;

  if (open !== null) {
    return (
      <JournalPage
        // A fresh page per entry, so a half-typed edit never carries over.
        key={open.id}
        entry={open}
        isGameMaster={isGameMaster}
        send={send}
        authToken={authToken}
        notes={notes.filter((note) => note.journalId === open.id)}
        onBack={() => onOpen(null)}
        {...(onPin === undefined ? {} : { onPin: () => onPin(open.id) })}
        {...(onUnpin === undefined ? {} : { onUnpin })}
      />
    );
  }

  const createEntry = () => {
    const entry: JournalEntry = {
      id: nextJournalId(),
      title: t('journal.untitled'),
      body: '',
      image: null,
      shared: 'gm',
    };
    send({ type: 'upsertJournalEntry', entry });
    onOpen(entry.id);
  };

  return (
    <div className="panel">
      <h2>{t('map.panel.journal')}</h2>
      {isGameMaster ? (
        <button type="button" onClick={createEntry}>
          {t('journal.new')}
        </button>
      ) : null}
      {journal.length === 0 ? (
        <p className="muted mt-3">
          {isGameMaster ? t('journal.empty') : t('journal.emptyPlayer')}
        </p>
      ) : (
        <ul className="log mt-3">
          {journal.map((entry) => (
            <li key={entry.id}>
              <div className="row spread">
                <button type="button" onClick={() => onOpen(entry.id)}>
                  {entry.title}
                </button>
                {isGameMaster && entry.shared === 'all' ? (
                  <span className="badge">{t('journal.shared')}</span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface JournalPageProps {
  entry: JournalEntry;
  isGameMaster: boolean;
  send: (event: RoomEvent) => void;
  authToken: string | null;
  /** This entry's notes on the scene in view. */
  notes: readonly MapNote[];
  onBack: () => void;
  onPin?: () => void;
  onUnpin?: (noteId: string) => void;
}

/** One entry: read by everyone, and for the GM the controls that change it. */
function JournalPage({
  entry,
  isGameMaster,
  send,
  authToken,
  notes,
  onBack,
  onPin,
  onUnpin,
}: JournalPageProps) {
  const [draft, setDraft] = useState<JournalEntry | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const upsert = (next: JournalEntry) => send({ type: 'upsertJournalEntry', entry: next });

  const onUpload = async (file: File) => {
    setUploadError(null);
    setUploading(true);
    try {
      const image = await uploadImage(file, authToken);
      setDraft((current) => (current === null ? current : { ...current, image }));
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : t('map.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  if (isGameMaster && draft !== null) {
    return (
      <div className="panel">
        <label htmlFor="journal-title">{t('journal.titleLabel')}</label>
        <input
          id="journal-title"
          value={draft.title}
          maxLength={80}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
        />
        <label htmlFor="journal-body" className="mt-3">
          {t('journal.bodyLabel')}
        </label>
        <textarea
          id="journal-body"
          rows={10}
          value={draft.body}
          maxLength={20_000}
          onChange={(event) => setDraft({ ...draft, body: event.target.value })}
        />
        <label htmlFor="journal-image" className="mt-3">
          {t('journal.imageLabel')}
        </label>
        <input
          id="journal-image"
          type="file"
          disabled={uploading}
          accept="image/png,image/jpeg,image/gif,image/webp"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) void onUpload(file);
          }}
        />
        {uploading ? <p className="muted">{t('map.uploading')}</p> : null}
        {uploadError !== null ? <p className="field-error">{uploadError}</p> : null}
        {draft.image !== null ? (
          <button type="button" onClick={() => setDraft({ ...draft, image: null })}>
            {t('journal.removeImage')}
          </button>
        ) : null}
        <div className="row mt-3">
          <button
            type="button"
            disabled={draft.title.trim() === '' || uploading}
            onClick={() => {
              upsert({ ...draft, title: draft.title.trim() });
              setDraft(null);
            }}
          >
            {t('journal.save')}
          </button>
          <button type="button" onClick={() => setDraft(null)}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel journal-page">
      <button type="button" onClick={onBack}>
        {t('journal.back')}
      </button>
      <h2 className="mt-3">{entry.title}</h2>
      {entry.image !== null ? (
        <img className="journal-image" src={imageSrc(entry.image.url)} alt="" />
      ) : null}
      <p className="journal-body">{entry.body}</p>
      {isGameMaster ? (
        <div className="row mt-3">
          <button type="button" onClick={() => setDraft(entry)}>
            {t('journal.edit')}
          </button>
          <button
            type="button"
            aria-pressed={entry.shared === 'all'}
            onClick={() => upsert({ ...entry, shared: entry.shared === 'all' ? 'gm' : 'all' })}
          >
            {entry.shared === 'all' ? t('journal.hideFromPlayers') : t('journal.showToPlayers')}
          </button>
          {onPin !== undefined && notes.length === 0 ? (
            <button type="button" onClick={onPin}>
              {t('journal.pin')}
            </button>
          ) : null}
          {onUnpin === undefined
            ? null
            : notes.map((note) => (
                <button key={note.id} type="button" onClick={() => onUnpin(note.id)}>
                  {t('journal.unpin')}
                </button>
              ))}
          <button type="button" onClick={() => send({ type: 'removeJournalEntry', id: entry.id })}>
            {t('common.remove')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
