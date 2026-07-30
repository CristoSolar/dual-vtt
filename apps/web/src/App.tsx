import { useCallback, useMemo } from 'react';
import { HashRouter, Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';

import { GMPanel } from './components/gm/GMPanel.js';
import { CampaignRoute } from './routes/CampaignRoute.js';
import { CharactersRoute } from './routes/CharactersRoute.js';
import { MapRoute } from './routes/MapRoute.js';
import { SheetRoute } from './routes/SheetRoute.js';
import { WizardRoute } from './routes/WizardRoute.js';
import { loadCreation } from './state/storage.js';
import { useCharacters } from './state/useCharacters.js';
import { useRoom } from './state/useRoom.js';
import type { SheetState } from './state/sheet.js';

/**
 * Dice come from here for offline play so every local roll shares one injectable
 * source. In a campaign the server rolls instead, seeded and auditable.
 */
const rng = () => Math.random();

function Shell() {
  const storage = window.localStorage;
  const navigate = useNavigate();
  const { characters, active, activeId, setActiveId, addCharacter, updateActive, deleteCharacter } =
    useCharacters(storage);
  const room = useRoom(storage);

  const hasCreationInProgress = useMemo(() => loadCreation(storage) !== null, [storage]);

  const isGameMaster = room.session?.role === 'gm';
  const inCampaign = room.session !== null && room.room !== null;

  /**
   * The character this player controls in the campaign, if any. Its sheet comes from
   * the server, so every table sees the same numbers.
   */
  const syncedSheet: SheetState | null = useMemo(() => {
    if (room.room === null || room.session === null || activeId === null) return null;
    const mine = room.room.players.find((p) => p.id === room.session?.sessionId);
    if (mine?.characterId !== activeId) return null;
    return room.room.characters[activeId] ?? null;
  }, [room.room, room.session, activeId]);

  /** Publishes the active local character into the campaign. */
  const claimActive = useCallback(() => {
    if (active === null) return;
    room.claimCharacter(active.id, active.sheet);
  }, [active, room]);

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          DAGGERHEART VTT
        </Link>
        <nav>
          <Link to="/">
            <button type="button">Characters</button>
          </Link>
          <Link to="/create/1">
            <button type="button">Create</button>
          </Link>
          {active !== null ? (
            <Link to="/sheet">
              <button type="button">Sheet</button>
            </Link>
          ) : null}
          <Link to="/campaign">
            <button type="button">
              {inCampaign ? `Campaign ${room.session?.code ?? ''}` : 'Campaign'}
            </button>
          </Link>
          {inCampaign ? (
            <Link to="/map">
              <button type="button">Map</button>
            </Link>
          ) : null}
          {isGameMaster ? (
            <Link to="/gm">
              <button type="button">GM Panel</button>
            </Link>
          ) : null}
        </nav>
      </header>

      {inCampaign && active !== null && syncedSheet === null && !isGameMaster ? (
        <div className="panel">
          <div className="row spread">
            <span>
              You’re in campaign <strong>{room.session?.code}</strong> but haven’t claimed a
              character.
            </span>
            <button type="button" onClick={claimActive}>
              Claim {active.sheet.character.name ?? 'this character'}
            </button>
          </div>
        </div>
      ) : null}

      <Routes>
        <Route
          path="/"
          element={
            <CharactersRoute
              characters={characters}
              activeId={activeId}
              onSelect={setActiveId}
              onDelete={deleteCharacter}
              hasCreationInProgress={hasCreationInProgress}
            />
          }
        />
        <Route
          path="/create/:step"
          element={
            <WizardRoute
              storage={storage}
              addCharacter={addCharacter}
              onFinish={() => navigate('/sheet')}
            />
          }
        />
        <Route path="/create" element={<Navigate to="/create/1" replace />} />
        <Route
          path="/campaign"
          element={
            <CampaignRoute
              status={room.status}
              error={room.error}
              code={room.session?.code ?? null}
              role={room.session?.role ?? null}
              onCreate={(gmName) => {
                room.createRoom(gmName);
                navigate('/gm');
              }}
              onJoin={room.joinRoom}
              onLeave={room.leave}
            />
          }
        />
        <Route
          path="/gm"
          element={
            room.room === null || !isGameMaster ? (
              <Navigate to="/campaign" replace />
            ) : (
              <GMPanel room={room.room} send={room.send} />
            )
          }
        />
        <Route
          path="/sheet"
          element={
            active === null ? (
              <Navigate to="/" replace />
            ) : (
              <SheetRoute
                // In a campaign the server's copy is the truth; offline, the local one is.
                sheet={syncedSheet ?? active.sheet}
                update={updateActive}
                rng={rng}
                {...(syncedSheet === null
                  ? {}
                  : { characterId: active.id, send: room.send, sharedLog: room.room?.rollLog })}
              />
            )
          }
        />
        <Route
          path="/map"
          element={
            room.room === null ? (
              <Navigate to="/campaign" replace />
            ) : (
              <MapRoute
                room={room.room}
                isGameMaster={isGameMaster}
                viewerId={room.session?.sessionId ?? null}
                send={room.send}
              />
            )
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

export function App() {
  // Hash routing keeps deep links working when this is opened straight from disk.
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}
