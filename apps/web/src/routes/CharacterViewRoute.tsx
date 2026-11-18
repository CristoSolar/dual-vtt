import type { LibraryCharacter } from '@daggerheart/protocol';
import { Navigate, useNavigate, useParams } from 'react-router-dom';

import { PrintableSheet } from '../components/sheet/PrintableSheet.js';
import { t } from '../i18n/index.js';

/**
 * A library character's sheet, read-only. Play happens in a campaign, where the
 * room's sheet is the live one; outside one, a sheet is something to read or print.
 */
export function CharacterViewRoute({
  characters,
  loaded,
}: {
  characters: readonly LibraryCharacter[];
  loaded: boolean;
}) {
  const { id } = useParams();
  const navigate = useNavigate();
  if (!loaded) return <p className="muted">{t('common.loading')}</p>;
  const entry = characters.find((c) => c.id === id);
  if (entry === undefined) return <Navigate to="/characters" replace />;
  return <PrintableSheet sheet={entry.sheet} onClose={() => navigate('/characters')} />;
}
