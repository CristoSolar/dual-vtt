import { useCallback, useMemo } from 'react';
import { HashRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import { GMPanel } from './components/gm/GMPanel.js';
import { CharactersRoute } from './routes/CharactersRoute.js';
import { HomeRoute } from './routes/HomeRoute.js';
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
  // The map is a Foundry-style fullscreen stage: it owns the whole viewport
  // and draws its own thin scene bar instead of sharing the page chrome.
  const isMapRoute = useLocation().pathname === '/map';
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
    <div className={isMapRoute ? 'app app--map' : 'app'}>
      <header className={isMapRoute ? 'topbar topbar--overlay' : 'topbar'}>
        <Link to="/" className="brand">
          DAGGERHEART VTT
        </Link>
        <nav>
          <Link to="/">
            <button type="button">Inicio</button>
          </Link>
          {inCampaign ? (
            <>
              <Link to="/map">
                <button type="button">Mapa</button>
              </Link>
              {isGameMaster ? (
                <Link to="/gm">
                  <button type="button">Panel del DJ</button>
                </Link>
              ) : active !== null ? (
                <Link to="/sheet">
                  <button type="button">Hoja</button>
                </Link>
              ) : null}
            </>
          ) : (
            <>
              <Link to="/characters">
                <button type="button">Personajes</button>
              </Link>
              <Link to="/create/1">
                <button type="button">Crear</button>
              </Link>
              {active !== null ? (
                <Link to="/sheet">
                  <button type="button">Hoja</button>
                </Link>
              ) : null}
            </>
          )}
        </nav>
      </header>

      {!isMapRoute && inCampaign && active !== null && syncedSheet === null && !isGameMaster ? (
        <div className="panel">
          <div className="row spread">
            <span>
              Estás en la campaña <strong>{room.session?.code}</strong> pero todavía no reclamaste
              un personaje.
            </span>
            <button type="button" onClick={claimActive}>
              Reclamar {active.sheet.character.name ?? 'este personaje'}
            </button>
          </div>
        </div>
      ) : null}

      <Routes>
        <Route
          path="/"
          element={
            <HomeRoute
              status={room.status}
              error={room.error}
              code={room.session?.code ?? null}
              role={room.session?.role ?? null}
              hasActiveCharacter={active !== null}
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
          path="/characters"
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
        <Route path="/campaign" element={<Navigate to="/" replace />} />
        <Route
          path="/gm"
          element={
            room.room === null || !isGameMaster ? (
              <Navigate to="/" replace />
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
              <Navigate to="/" replace />
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
