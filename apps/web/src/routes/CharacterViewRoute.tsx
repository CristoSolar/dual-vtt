import type { CampaignSummary, LibraryCharacter, RoomState } from '@daggerheart/protocol';
import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';

import { EditCharacterDialog } from '../components/EditCharacterDialog.js';
import { PrintableSheet } from '../components/sheet/PrintableSheet.js';
import { t } from '../i18n/index.js';
import { playableCampaign } from '../state/library.js';
import type { LibraryConnection } from '../state/useLibrary.js';
import { SheetRoute } from './SheetRoute.js';

const rng = () => Math.random();

/**
 * "Ver hoja": the platform sheet. A character linked to a campaign this account
 * can enter is opened there, where the room's sheet is the live, playable one.
 * Anything else is shown read-only from the library — play needs a table.
 */
export function CharacterSheetRoute({
  library,
  campaigns,
  activeCampaignId,
  room,
  connectionFailed,
  onEnter,
  authToken,
}: {
  authToken: string | null;
  library: LibraryConnection;
  campaigns: readonly CampaignSummary[];
  activeCampaignId: string | null;
  room: RoomState | null;
  /** The socket gave up; show the library copy rather than wait forever. */
  connectionFailed: boolean;
  onEnter: (campaignId: string) => void;
}) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const entry = library.characters.find((c) => c.id === id);
  const playable = entry === undefined ? null : playableCampaign(entry, campaigns);
  const ownerId = entry?.ownerId ?? null;

  const joined = playable !== null && activeCampaignId === playable.id;
  useEffect(() => {
    if (playable !== null && !joined) onEnter(playable.id);
  }, [playable, joined, onEnter]);

  if (!library.loaded) return <p className="muted">{t('common.loading')}</p>;
  if (entry === undefined) return <Navigate to="/characters" replace />;

  if (playable !== null && !connectionFailed) {
    const roomHere = room !== null && room.id === playable.id ? room : null;
    if (roomHere !== null && ownerId !== null && roomHere.characters[ownerId] !== undefined) {
      return <Navigate to="/sheet" replace />;
    }
    // Still connecting, or the room has not arrived yet. A room that arrived
    // without the character falls through to the library copy.
    if (roomHere === null) {
      return <p className="muted">{t('library.entering', { campaign: playable.name })}</p>;
    }
  }

  return (
    <>
      <SheetRoute
        sheet={entry.sheet}
        update={() => null}
        rng={rng}
        readOnly
        actions={
          <>
            <button type="button" className="btn-primary" onClick={() => setEditing(true)}>
              {t('library.edit')}
            </button>
            <button type="button" className="btn-ghost" onClick={() => navigate(`/characters/${entry.id}/pdf`)}>
              {t('library.exportPdf')}
            </button>
            <Link to="/characters">
              <button type="button" className="btn-ghost">
                {t('sheet.route.charactersLink')}
              </button>
            </Link>
          </>
        }
      />
      {editing ? (
        <EditCharacterDialog
          entry={entry}
          authToken={authToken}
          onSave={(details) => library.edit(entry.id, details)}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </>
  );
}

/**
 * "Exportar PDF": the printable recreation of the official sheet, with its print
 * button. Read from the library, which reads through to the room while linked.
 */
export function CharacterPrintRoute({
  characters,
  loaded,
}: {
  characters: readonly LibraryCharacter[];
  loaded: boolean;
}) {
  const { id } = useParams();
  const navigate = useNavigate();
  // Back to wherever it was opened from — the list or the sheet — unless this
  // was the first page loaded, when there is nothing to go back to.
  const openedHere = useLocation().key === 'default';
  if (!loaded) return <p className="muted">{t('common.loading')}</p>;
  const entry = characters.find((c) => c.id === id);
  if (entry === undefined) return <Navigate to="/characters" replace />;
  return <PrintableSheet sheet={entry.sheet} onClose={() => (openedHere ? navigate('/characters') : navigate(-1))} />;
}
