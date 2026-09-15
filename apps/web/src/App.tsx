import { useCallback, useMemo, useState } from 'react';
import { HashRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import { GMPanel } from './components/gm/GMPanel.js';
import { LocaleToggle } from './components/LocaleToggle.js';
import { Toast } from './components/Toast.js';
import { t } from './i18n/index.js';
import { CampaignsRoute } from './routes/CampaignsRoute.js';
import { ChangePasswordRoute } from './routes/ChangePasswordRoute.js';
import { LoginRoute } from './routes/LoginRoute.js';
import { MapRoute } from './routes/MapRoute.js';
import { PlayersRoute } from './routes/PlayersRoute.js';
import { SheetRoute } from './routes/SheetRoute.js';
import { WizardRoute } from './routes/WizardRoute.js';
import { useAuth } from './state/auth.js';
import { SERVER_URL, useCampaign } from './state/useCampaign.js';

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
  const campaign = useCampaign(storage, auth.token, auth.user?.id ?? null);

  // The tunnel is one per server, not per campaign — GM-only, checked via `GET
  // /tunnel` on the campaigns list and started on demand from a campaign card.
  const [tunnelUrl, setTunnelUrl] = useState<string | null>(null);
  const [tunnelLoading, setTunnelLoading] = useState(false);
  const token = auth.token;
  const generateTunnel = useCallback(() => {
    if (token === null) return;
    setTunnelLoading(true);
    void fetch(`${SERVER_URL}/tunnel`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        if (body !== null && typeof body === 'object' && 'url' in body && typeof body.url === 'string') {
          setTunnelUrl(body.url);
        }
      })
      .finally(() => setTunnelLoading(false));
  }, [token]);

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
        <LocaleToggle floating />
        <p className="muted">{t('common.loading')}</p>
      </div>
    );
  }

  if (auth.status === 'signedOut') {
    return (
      <>
        <LocaleToggle floating />
        <LoginRoute error={auth.error} pending={auth.pending} onLogin={auth.login} />
      </>
    );
  }

  const account = auth.user;
  if (account === null) {
    return (
      <div className="app">
        <LocaleToggle floating />
        <p className="muted">{t('common.loading')}</p>
      </div>
    );
  }

  if (account.mustChangePassword === true) {
    return (
      <>
        <LocaleToggle floating />
        <ChangePasswordRoute error={auth.error} pending={auth.pending} onChange={auth.changePassword} />
      </>
    );
  }

  return (
    <div className={isMapRoute ? 'app app--map' : 'app'}>
      <header className={isMapRoute ? 'topbar topbar--overlay' : 'topbar'}>
        <Link to="/" className="brand">
          DAGGERHEART VTT
        </Link>
        <nav>
          <Link to="/">
            <button type="button">{t('app.home')}</button>
          </Link>
          {account.role === 'gm' ? (
            <Link to="/players">
              <button type="button">{t('app.players')}</button>
            </Link>
          ) : null}
          {inCampaign ? (
            <>
              <Link to="/map">
                <button type="button">{t('app.map')}</button>
              </Link>
              {isGameMaster ? (
                <Link to="/gm">
                  <button type="button">{t('app.gmPanel')}</button>
                </Link>
              ) : hasClaimedCharacter ? (
                <Link to="/sheet">
                  <button type="button">{t('app.sheet')}</button>
                </Link>
              ) : null}
            </>
          ) : null}
          <LocaleToggle />
          <button type="button" onClick={auth.logout}>
            {t('app.logout')}
          </button>
        </nav>
      </header>

      {campaign.error !== null ? (
        <Toast message={campaign.error} onDismiss={campaign.dismissError} />
      ) : campaign.lastRoll !== null ? (
        // Same fixed slot as the error toast above, so only ever one shows at
        // once — an error is actionable and takes priority over a roll notice.
        <Toast key={campaign.lastRoll.id} message={campaign.lastRoll.message} onDismiss={campaign.dismissLastRoll} />
      ) : null}

      {!isMapRoute && inCampaign && !isGameMaster && !hasClaimedCharacter ? (
        <div className="panel">
          <div className="row spread">
            <span>
              {t('app.inCampaignPrefix')} <strong>{activeCampaignName}</strong> {t('app.inCampaignSuffix')}
            </span>
            <Link to="/create/1">
              <button type="button">{t('app.createCharacter')}</button>
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
                  <p className="muted">{isGameMaster ? t('app.gmRole') : t('app.playerRole')}</p>
                </div>
                <div className="grid cols-2">
                  <Link to="/map" className="option home-option">
                    <span className="option-name">{t('app.openMap')}</span>
                    <span className="option-meta">{t('app.openMapDesc')}</span>
                  </Link>
                  {isGameMaster ? (
                    <Link to="/gm" className="option home-option">
                      <span className="option-name">{t('app.gmPanel')}</span>
                      <span className="option-meta">{t('app.gmPanelDesc')}</span>
                    </Link>
                  ) : hasClaimedCharacter ? (
                    <Link to="/sheet" className="option home-option">
                      <span className="option-name">{t('app.characterSheet')}</span>
                      <span className="option-meta">{t('app.characterSheetDesc')}</span>
                    </Link>
                  ) : (
                    <Link to="/create/1" className="option home-option">
                      <span className="option-name">{t('app.createCharacter')}</span>
                      <span className="option-meta">{t('app.createCharacterDesc')}</span>
                    </Link>
                  )}
                </div>
                <div className="row mt-4">
                  <button type="button" onClick={campaign.leave}>
                    {t('app.leaveCampaign')}
                  </button>
                </div>
              </section>
            ) : (
              <CampaignsRoute
                accountId={account.id}
                campaigns={campaign.campaigns}
                onCreate={(name) => void campaign.createCampaign(name)}
                onJoin={(campaignId) => {
                  campaign.join(campaignId);
                  navigate('/');
                }}
                onAddPlayer={(campaignId, username) => void campaign.addPlayer(campaignId, username)}
                pending={campaign.pending}
                tunnelUrl={tunnelUrl}
                tunnelLoading={tunnelLoading}
                onGenerateTunnel={generateTunnel}
              />
            )
          }
        />
        <Route
          path="/create/:step"
          element={
            // Not just activeCampaignId: the socket must have actually finished
            // joining (room !== null) before the wizard can claim a character —
            // otherwise a fast finish can race the join and the server rejects
            // the claim with 'noSeat'.
            campaign.activeCampaignId === null || campaign.room === null ? (
              <Navigate to="/" replace />
            ) : (
              <WizardRoute
                storage={storage}
                campaignId={campaign.activeCampaignId}
                onClaim={campaign.claimCharacter}
                onFinish={() => navigate('/sheet')}
                claimed={hasClaimedCharacter}
                error={campaign.error}
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
