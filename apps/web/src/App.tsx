import { useCallback, useMemo } from 'react';
import { HashRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import { GMPanel } from './components/gm/GMPanel.js';
import { CampaignsRoute } from './routes/CampaignsRoute.js';
import { ChangePasswordRoute } from './routes/ChangePasswordRoute.js';
import { LoginRoute } from './routes/LoginRoute.js';
import { MapRoute } from './routes/MapRoute.js';
import { PlayersRoute } from './routes/PlayersRoute.js';
import { SheetRoute } from './routes/SheetRoute.js';
import { WizardRoute } from './routes/WizardRoute.js';
import { useAuth } from './state/auth.js';
import { useCampaign } from './state/useCampaign.js';

/**
 * Dice come from here for the sheet's optimistic local echo — a campaign's real
 * rolls always come from the server, seeded and auditable; this only drives the
 * client-side preview before the server's result replaces it.
 */
const rng = () => Math.random();

function Shell() {
  const storage = window.localStorage;
  const navigate = useNavigate();
  // The map is a Foundry-style fullscreen stage: it owns the whole viewport
  // and draws its own thin scene bar instead of sharing the page chrome.
  const isMapRoute = useLocation().pathname === '/map';
  const auth = useAuth(storage);
  const campaign = useCampaign(storage, auth.token);

  const inCampaign = campaign.activeCampaignId !== null && campaign.room !== null;
  const isGameMaster = campaign.role === 'gm';

  const activeCampaignName = useMemo(
    () => campaign.campaigns.find((c) => c.id === campaign.activeCampaignId)?.name ?? '',
    [campaign.campaigns, campaign.activeCampaignId],
  );

  /** The current account's own character sheet in the joined campaign, if claimed. */
  const mySheet = useMemo(() => {
    if (campaign.room === null || auth.user === null) return null;
    return campaign.room.characters[auth.user.id] ?? null;
  }, [campaign.room, auth.user]);

  const hasClaimedCharacter = mySheet !== null;

  if (auth.status === 'loading') {
    return (
      <div className="app">
        <p className="muted">Cargando…</p>
      </div>
    );
  }

  if (auth.status === 'signedOut') {
    return <LoginRoute error={auth.error} onLogin={auth.login} />;
  }

  const account = auth.user;
  if (account === null) {
    return (
      <div className="app">
        <p className="muted">Cargando…</p>
      </div>
    );
  }

  if (account.mustChangePassword === true) {
    return <ChangePasswordRoute error={auth.error} onChange={auth.changePassword} />;
  }

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
          {account.role === 'gm' ? (
            <Link to="/players">
              <button type="button">Jugadores</button>
            </Link>
          ) : null}
          {inCampaign ? (
            <>
              <Link to="/map">
                <button type="button">Mapa</button>
              </Link>
              {isGameMaster ? (
                <Link to="/gm">
                  <button type="button">Panel del DJ</button>
                </Link>
              ) : hasClaimedCharacter ? (
                <Link to="/sheet">
                  <button type="button">Hoja</button>
                </Link>
              ) : null}
            </>
          ) : null}
          <button type="button" onClick={auth.logout}>
            Cerrar sesión
          </button>
        </nav>
      </header>

      {!isMapRoute && inCampaign && !isGameMaster && !hasClaimedCharacter ? (
        <div className="panel">
          <div className="row spread">
            <span>
              Estás en la campaña <strong>{activeCampaignName}</strong> pero todavía no creaste tu
              personaje.
            </span>
            <Link to="/create/1">
              <button type="button">Crear personaje</button>
            </Link>
          </div>
        </div>
      ) : null}

      <Routes>
        <Route
          path="/"
          element={
            inCampaign ? (
              <section>
                <div className="hero">
                  <h1>{activeCampaignName}</h1>
                  <p className="muted">{isGameMaster ? 'Eres el DJ.' : 'Eres jugador.'}</p>
                </div>
                <div className="grid cols-2">
                  <Link to="/map" className="option home-option">
                    <span className="option-name">Abrir el mapa</span>
                    <span className="option-meta">Escenas tácticas, fichas, niebla de guerra.</span>
                  </Link>
                  {isGameMaster ? (
                    <Link to="/gm" className="option home-option">
                      <span className="option-name">Panel del DJ</span>
                      <span className="option-meta">Adversarios, miedo, registro de tiradas.</span>
                    </Link>
                  ) : hasClaimedCharacter ? (
                    <Link to="/sheet" className="option home-option">
                      <span className="option-name">Hoja de personaje</span>
                      <span className="option-meta">Tus rasgos, movimientos y recursos.</span>
                    </Link>
                  ) : (
                    <Link to="/create/1" className="option home-option">
                      <span className="option-name">Crear personaje</span>
                      <span className="option-meta">Todavía no tienes uno en esta campaña.</span>
                    </Link>
                  )}
                </div>
                <div className="row mt-4">
                  <button type="button" onClick={campaign.leave}>
                    Salir de la campaña
                  </button>
                </div>
                {campaign.error !== null ? <div className="errors">{campaign.error}</div> : null}
              </section>
            ) : (
              <CampaignsRoute
                accountId={account.id}
                campaigns={campaign.campaigns}
                error={campaign.error}
                onCreate={(name) => void campaign.createCampaign(name)}
                onJoin={(campaignId) => {
                  campaign.join(campaignId);
                  navigate('/');
                }}
                onAddPlayer={(campaignId, username) => void campaign.addPlayer(campaignId, username)}
              />
            )
          }
        />
        <Route
          path="/create/:step"
          element={
            campaign.activeCampaignId === null ? (
              <Navigate to="/" replace />
            ) : (
              <WizardRoute
                storage={storage}
                campaignId={campaign.activeCampaignId}
                onClaim={campaign.claimCharacter}
                onFinish={() => navigate('/sheet')}
              />
            )
          }
        />
        <Route
          path="/players"
          element={
            account.role !== 'gm' || auth.token === null ? (
              <Navigate to="/" replace />
            ) : (
              <PlayersRoute token={auth.token} />
            )
          }
        />
        <Route path="/create" element={<Navigate to="/create/1" replace />} />
        <Route
          path="/gm"
          element={
            campaign.room === null || !isGameMaster ? (
              <Navigate to="/" replace />
            ) : (
              <GMPanel room={campaign.room} campaignName={activeCampaignName} send={campaign.send} />
            )
          }
        />
        <Route
          path="/sheet"
          element={
            mySheet === null ? (
              <Navigate to="/" replace />
            ) : (
              <SheetRoute
                sheet={mySheet}
                update={() => null}
                rng={rng}
                characterId={account.id}
                send={campaign.send}
                sharedLog={campaign.room?.rollLog}
              />
            )
          }
        />
        <Route
          path="/map"
          element={
            campaign.room === null ? (
              <Navigate to="/" replace />
            ) : (
              <MapRoute
                room={campaign.room}
                isGameMaster={isGameMaster}
                viewerId={account.id}
                send={campaign.send}
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
