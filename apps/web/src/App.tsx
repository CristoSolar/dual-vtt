import { useCallback, useEffect, useMemo, useState } from 'react';
import { HashRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import { GMPanel } from './components/gm/GMPanel.js';
import { ConfirmDialog } from './components/ConfirmDialog.js';
import { GuideDialog } from './components/GuideDialog.js';
import { LocaleToggle } from './components/LocaleToggle.js';
import { Toast, ToastStack } from './components/Toast.js';
import { t } from './i18n/index.js';
import { CampaignsRoute } from './routes/CampaignsRoute.js';
import { ChangePasswordRoute } from './routes/ChangePasswordRoute.js';
import { LoginRoute } from './routes/LoginRoute.js';
import { MapRoute } from './routes/MapRoute.js';
import { HelpRoute } from './routes/HelpRoute.js';
import { PlayersRoute } from './routes/PlayersRoute.js';
import { SheetRoute } from './routes/SheetRoute.js';
import { WizardRoute } from './routes/WizardRoute.js';
import { useAuth } from './state/auth.js';
import { canRollPrivately, chatRecipients } from './state/feed.js';
import { hasSeenGuide, markGuideSeen } from './state/storage.js';
import { firstTarget } from './state/targets.js';
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

  const accountId = auth.user?.id ?? null;
  const [guideOpen, setGuideOpen] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  useEffect(() => {
    if (accountId !== null && !hasSeenGuide(storage, accountId)) setGuideOpen(true);
  }, [accountId, storage]);
  const closeGuide = useCallback(() => {
    if (accountId !== null) markGuideSeen(storage, accountId);
    setGuideOpen(false);
  }, [accountId, storage]);

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
  /** Everyone at the table who has claimed a character, for downtime targets. */
  const party = useMemo(
    () =>
      (campaign.room?.players ?? [])
        .filter((player) => player.characterId !== null)
        .map((player) => ({ id: player.characterId as string, name: player.name })),
    [campaign.room],
  );

  /** Everyone's sheet, for the party strip on a player's own sheet. */
  const partyMembers = useMemo(
    () =>
      (campaign.room?.players ?? []).flatMap((player) => {
        const sheet =
          player.characterId === null ? undefined : campaign.room?.characters[player.characterId];
        if (sheet === undefined || player.characterId === null) return [];
        return [{ id: player.characterId, name: player.name, sheet }];
      }),
    [campaign.room],
  );

  const mySheet = useMemo(() => {
    if (campaign.room === null || auth.user === null) return null;
    return campaign.room.characters[auth.user.id] ?? null;
  }, [campaign.room, auth.user]);

  const hasClaimedCharacter = mySheet !== null;

  const { send } = campaign;
  const chat = useMemo(() => {
    if (campaign.room === null || accountId === null) return undefined;
    return {
      ...chatRecipients(campaign.room, accountId),
      onSend: (text: string, whisperTo: string[]) => send({ type: 'sendMessage', text, whisperTo }),
    };
  }, [campaign.room, accountId, send]);

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
          DUAL VTT
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
          <Link to="/help">
            <button type="button" aria-label={t('help.open')}>?</button>
          </Link>
          <LocaleToggle />
          <button type="button" onClick={auth.logout}>
            {t('app.logout')}
          </button>
        </nav>
      </header>

      {guideOpen ? <GuideDialog role={account.role} onClose={closeGuide} /> : null}

      {/* A dropped socket used to show nothing at all: the sheet kept taking clicks
          that reached no server. This stays up for as long as the room is out of
          reach, unlike the toasts below, which are dismissible one-shots. */}
      {campaign.activeCampaignId !== null && campaign.status !== 'connected' ? (
        <div className="connection-banner" role="status" aria-live="polite">
          <span className="connection-dot" aria-hidden="true" />
          {campaign.status === 'error'
            ? t('campaign.offline')
            : t('campaign.reconnecting')}
        </div>
      ) : null}

      {/* Toasts stack rather than replace one another: a rejection and the roll
          that provoked it are both worth reading, and losing one to the other is
          how a refusal goes unexplained. */}
      {campaign.error !== null || campaign.lastRoll !== null ? (
        <ToastStack>
          {campaign.error !== null ? (
            <Toast tone="alert" message={campaign.error} onDismiss={campaign.dismissError} />
          ) : null}
          {campaign.lastRoll !== null ? (
            <Toast
              key={campaign.lastRoll.id}
              message={campaign.lastRoll.message}
              onDismiss={campaign.dismissLastRoll}
            />
          ) : null}
        </ToastStack>
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
                  <button type="button" onClick={() => setConfirmingLeave(true)}>
                    {t('app.leaveCampaign')}
                  </button>
                  {confirmingLeave ? (
                    <ConfirmDialog
                      title={t('app.leaveCampaign')}
                      body={t('app.leaveCampaignConfirm')}
                      confirmLabel={t('app.leaveCampaign')}
                      onCancel={() => setConfirmingLeave(false)}
                      onConfirm={() => {
                        setConfirmingLeave(false);
                        campaign.leave();
                      }}
                    />
                  ) : null}
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
                token={auth.token ?? ''}
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
                privateLog={campaign.room?.privateLog}
                chat={chat}
                canRollPrivately={campaign.room !== null && canRollPrivately(campaign.room, account.id)}
                lastEffect={campaign.lastEffect}
                rest={campaign.room?.rest ?? null}
                party={party}
                tagTeam={campaign.room?.tagTeam ?? null}
                partyMembers={partyMembers}
                fear={campaign.room?.fear ?? null}
                spotlit={campaign.room?.spotlight === account.id}
                target={campaign.room === null ? null : firstTarget(campaign.room, account.id)}
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
                campaignName={activeCampaignName}
                authToken={auth.token}
                send={campaign.send}
              />
            )
          }
        />
        <Route path="/help" element={<HelpRoute role={account.role} />} />
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
