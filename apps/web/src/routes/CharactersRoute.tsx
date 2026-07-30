import { Link } from 'react-router-dom';

import { selectSheetView } from '../state/selectors.js';
import type { SavedCharacter } from '../state/storage.js';

interface CharactersRouteProps {
  characters: readonly SavedCharacter[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  hasCreationInProgress: boolean;
}

/** Home: pick a saved character, resume a creation, or start a new one. */
export function CharactersRoute({
  characters,
  activeId,
  onSelect,
  onDelete,
  hasCreationInProgress,
}: CharactersRouteProps) {
  return (
    <section>
      <div className="card-head">
        <h1>Characters</h1>
        <Link to="/create/1">
          <button type="button">
            {hasCreationInProgress ? 'Resume creation' : 'New character'}
          </button>
        </Link>
      </div>

      {characters.length === 0 ? (
        <div className="panel">
          <p className="muted">
            No characters yet. Create one to get a sheet you can use at the table.
          </p>
        </div>
      ) : (
        <div className="grid cols-2">
          {characters.map((entry) => {
            const view = selectSheetView(entry.sheet);
            const character = entry.sheet.character;
            return (
              <div className="panel" key={entry.id}>
                <div className="card-head">
                  <h2>{character.name ?? 'Unnamed character'}</h2>
                  {entry.id === activeId ? <span className="badge">Active</span> : null}
                </div>
                <p className="muted">
                  Level {character.level} {view.className} · {view.subclassName}
                  <br />
                  {view.heritageLabel} · {view.communityName}
                </p>
                <div className="row">
                  <Link to="/sheet" onClick={() => onSelect(entry.id)}>
                    <button type="button">Open sheet</button>
                  </Link>
                  <button type="button" onClick={() => onDelete(entry.id)}>
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
