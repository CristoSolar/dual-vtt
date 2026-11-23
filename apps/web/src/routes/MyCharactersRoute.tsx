import type { CampaignSummary, LibraryCharacter, SheetState } from '@daggerheart/protocol';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { TransformationBadge } from '../components/TransformationBadge.js';
import { t } from '../i18n/index.js';
import {
  characterPortrait,
  DRAFT_SCOPE,
  findLegacyCharacters,
  linkableCampaigns,
  markLegacyImported,
} from '../state/library.js';
import type { LibraryConnection } from '../state/useLibrary.js';
import { selectSheetView } from '../state/selectors.js';
import { loadCreation, saveCreation } from '../state/storage.js';

interface MyCharactersRouteProps {
  accountId: string;
  storage: Storage;
  library: LibraryConnection;
  /** Campaigns this account is a member of, for the link picker. */
  campaigns: readonly CampaignSummary[];
}

const nameOf = (sheet: SheetState): string => sheet.character.name ?? t('library.unnamed');

/** A portrait that simply disappears if its image is missing — no broken icon. */
function Portrait({ sheet }: { sheet: SheetState }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="library-portrait library-portrait--empty" aria-hidden="true" />;
  return (
    <img className="library-portrait" src={characterPortrait(sheet)} alt="" onError={() => setFailed(true)} />
  );
}

function LibraryCard({
  entry,
  linkable,
  library,
  onConfirmUnlink,
  onConfirmDelete,
}: {
  entry: LibraryCharacter;
  linkable: readonly CampaignSummary[];
  library: LibraryConnection;
  onConfirmUnlink: () => void;
  onConfirmDelete: () => void;
}) {
  const [campaignId, setCampaignId] = useState('');
  const view = selectSheetView(entry.sheet);
  const linked = entry.campaignId !== null;
  const selectId = `link-${entry.id}`;

  return (
    <article className="library-card" data-linked={linked}>
      <Portrait sheet={entry.sheet} />
      <div className="library-card-body">
        <h2>{nameOf(entry.sheet)}</h2>
        <p className="muted">
          {t('library.levelClass', { level: entry.sheet.character.level, className: view.className })}{' '}
          <TransformationBadge id={entry.sheet.transformation} />
        </p>
        <span className={linked ? 'library-chip library-chip--linked' : 'library-chip'}>
          {linked
            ? t('library.inCampaign', { campaign: entry.campaignName ?? '—' })
            : t('library.noCampaign')}
        </span>

        <div className="library-card-actions">
          <Link to={`/characters/${entry.id}`}>
            <button type="button" className="btn-ghost">
              {t('library.viewSheet')}
            </button>
          </Link>
          {linked ? (
            <button type="button" className="btn-ghost" disabled={library.pending} onClick={onConfirmUnlink}>
              {t('library.unlink')}
            </button>
          ) : (
            <button type="button" className="btn-danger" disabled={library.pending} onClick={onConfirmDelete}>
              {t('library.delete')}
            </button>
          )}
        </div>

        {linked ? null : linkable.length === 0 ? (
          <p className="muted library-hint">{t('library.noLinkable')}</p>
        ) : (
          <form
            className="row"
            onSubmit={(event) => {
              event.preventDefault();
              if (campaignId === '' || library.pending) return;
              void library.link(entry.id, campaignId).then((ok) => {
                if (ok) setCampaignId('');
              });
            }}
          >
            <label className="sr-only" htmlFor={selectId}>
              {t('library.linkLabel', { name: nameOf(entry.sheet) })}
            </label>
            <select id={selectId} value={campaignId} onChange={(event) => setCampaignId(event.target.value)}>
              <option value="">{t('library.chooseCampaign')}</option>
              {linkable.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </select>
            <button type="submit" className="btn-primary" disabled={campaignId === '' || library.pending}>
              {t('library.link')}
            </button>
          </form>
        )}
      </div>
    </article>
  );
}

/** The account's characters: create, read, link to a campaign, unlink, delete. */
export function MyCharactersRoute({ accountId, storage, library, campaigns }: MyCharactersRouteProps) {
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState<{ kind: 'unlink' | 'delete'; entry: LibraryCharacter } | null>(null);
  // Re-scanned after an import or a resumed draft moves keys aside.
  const [scan, setScan] = useState(0);
  const legacy = useMemo(
    () => findLegacyCharacters(storage, Object.keys(storage)),
    // `scan` is only the re-read trigger.
    [storage, scan],
  );
  const [importing, setImporting] = useState(false);

  // Linked characters change in play; read them afresh whenever this page opens.
  const { refresh } = library;
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const linkable = linkableCampaigns(library.characters, campaigns, accountId);

  const importAll = async () => {
    setImporting(true);
    try {
      const failedKeys = new Set<string>();
      for (const item of legacy.importable) {
        // The import id makes a retry after a partial failure safe: the server
        // returns what it already filed instead of a second copy.
        const created = await library.create(item.sheet, item.importId);
        if (created === null) failedKeys.add(item.key);
      }
      // A key is set aside only once everything in it made it to the server.
      markLegacyImported(
        storage,
        legacy.importable.map((i) => i.key).filter((key) => !failedKeys.has(key)),
      );
    } finally {
      setImporting(false);
      setScan((n) => n + 1);
    }
  };

  const resumeDraft = (key: string) => {
    const draft = legacy.drafts.find((d) => d.key === key);
    if (draft === undefined) return;
    // Never overwrite a draft already in progress in the new wizard.
    if (loadCreation(storage, DRAFT_SCOPE) === null) {
      saveCreation(storage, DRAFT_SCOPE, draft.state);
      markLegacyImported(storage, [key]);
    }
    setScan((n) => n + 1);
    navigate(`/create/${draft.state.currentStep}`);
  };

  return (
    <section>
      <div className="hero">
        <h1>{t('library.title')}</h1>
        <p className="muted">{t('library.subtitle')}</p>
      </div>

      <div className="row spread mb-4">
        <Link to="/create/1">
          <button type="button" className="btn-primary">
            {t('library.create')}
          </button>
        </Link>
      </div>

      {legacy.importable.length > 0 || legacy.drafts.length > 0 ? (
        <div className="panel library-import">
          <h2>{t('library.import.title')}</h2>
          {legacy.importable.length > 0 ? (
            <>
              <p>{t('library.import.body', { count: legacy.importable.length })}</p>
              <button type="button" className="btn-primary" disabled={importing} onClick={() => void importAll()}>
                {importing ? t('library.import.importing') : t('library.import.button')}
              </button>
            </>
          ) : null}
          {legacy.drafts.length > 0 ? (
            <div className="mt-3">
              <p className="muted">{t('library.import.drafts', { count: legacy.drafts.length })}</p>
              <div className="row">
                {legacy.drafts.map((draft) => (
                  <button key={draft.key} type="button" className="btn-ghost" onClick={() => resumeDraft(draft.key)}>
                    {t('library.import.resume')}
                    {draft.state.name === null ? '' : ` · ${draft.state.name}`}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {legacy.unreadable > 0 ? (
            <p className="muted mt-3">{t('library.import.unreadable', { count: legacy.unreadable })}</p>
          ) : null}
        </div>
      ) : null}

      {!library.loaded ? (
        <p className="muted">{t('common.loading')}</p>
      ) : library.characters.length === 0 ? (
        <div className="panel">
          <p>{t('library.empty')}</p>
          <p className="muted">{t('library.emptyHint')}</p>
        </div>
      ) : (
        <div className="library-grid">
          {library.characters.map((entry) => (
            <LibraryCard
              key={entry.id}
              entry={entry}
              linkable={linkable}
              library={library}
              onConfirmUnlink={() => setConfirm({ kind: 'unlink', entry })}
              onConfirmDelete={() => setConfirm({ kind: 'delete', entry })}
            />
          ))}
        </div>
      )}

      {confirm !== null ? (
        <ConfirmDialog
          title={confirm.kind === 'unlink' ? t('library.unlink') : t('library.delete')}
          body={
            confirm.kind === 'unlink'
              ? t('library.unlinkConfirm', {
                  name: nameOf(confirm.entry.sheet),
                  campaign: confirm.entry.campaignName ?? '—',
                })
              : t('library.deleteConfirm', { name: nameOf(confirm.entry.sheet) })
          }
          confirmLabel={confirm.kind === 'unlink' ? t('library.unlink') : t('library.delete')}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const { kind, entry } = confirm;
            setConfirm(null);
            void (kind === 'unlink' ? library.unlink(entry.id) : library.remove(entry.id));
          }}
        />
      ) : null}
    </section>
  );
}
