import { MIN_PASSWORD_LENGTH, type CampaignSummary, type ManagedPlayer } from '@daggerheart/protocol';
import { useCallback, useEffect, useState } from 'react';

import { Dialog } from '../components/Dialog.js';
import { getLocale, t } from '../i18n/index.js';
import { invitableCampaigns, parseManagedPlayers } from '../state/gmHome.js';
import { SERVER_URL } from '../state/useCampaign.js';

interface PlayersRouteProps {
  token: string;
  accountId: string;
  /** This GM's campaigns, for the invite picker. */
  campaigns: readonly CampaignSummary[];
  /** Invites through the shared campaign connection, so its list refreshes too. */
  onInvite: (campaignId: string, username: string) => Promise<boolean>;
}

/**
 * GM-only "Mis jugadores": the player accounts this GM manages (`GET /players`),
 * with their campaigns, invitations and last sign-in; create one, reset a
 * password, invite one to a campaign.
 */
export function PlayersRoute({ token, accountId, campaigns, onInvite }: PlayersRouteProps) {
  const [players, setPlayers] = useState<readonly ManagedPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const reload = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      try {
        const response = await fetch(`${SERVER_URL}/players`, {
          headers: { authorization: `Bearer ${token}` },
          ...(signal === undefined ? {} : { signal }),
        });
        if (!response.ok) throw new Error('load failed');
        setPlayers(parseManagedPlayers(await response.json()));
        setLoadError(false);
      } catch (cause) {
        // An abort is this component unmounting, not a failure worth showing.
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload]);

  const authHeader = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  return (
    <>
      {loadError ? (
        <div className="errors" role="alert">
          {t('players.loadFailed')}
        </div>
      ) : null}
      <PlayersView
        players={players}
        campaigns={campaigns}
        accountId={accountId}
        loading={loading}
        onCreate={async (username, password) => {
          const response = await fetch(`${SERVER_URL}/users`, {
            method: 'POST',
            headers: authHeader,
            body: JSON.stringify({ username, password }),
          });
          if (response.ok) void reload();
          return response.ok ? null : response.status === 409 ? t('players.usernameTaken') : t('players.createFailed');
        }}
        onReset={async (player, newPassword) => {
          const response = await fetch(`${SERVER_URL}/users/${player.id}/reset-password`, {
            method: 'POST',
            headers: authHeader,
            body: JSON.stringify({ newPassword }),
          });
          // The list carries `mustChangePassword`, which this just turned back on.
          if (response.ok) void reload();
          return response.ok ? null : t('players.resetFailed');
        }}
        onInvite={async (campaignId, username) => {
          const ok = await onInvite(campaignId, username);
          if (ok) void reload();
          return ok ? null : t('campaign.invitePlayerFailed');
        }}
      />
    </>
  );
}

interface PlayersViewProps {
  players: readonly ManagedPlayer[];
  campaigns: readonly CampaignSummary[];
  accountId: string;
  loading: boolean;
  /** Each resolves to an error to show, or null on success. */
  onCreate: (username: string, password: string) => Promise<string | null | boolean>;
  onReset: (player: ManagedPlayer, newPassword: string) => Promise<string | null | boolean>;
  onInvite: (campaignId: string, username: string) => Promise<string | null | boolean>;
}

/** `true`/`null` is success; a string is the error to show; `false` a generic one. */
const failure = (result: string | null | boolean): string | null =>
  result === true || result === null ? null : result === false ? t('campaignPage.saveFailed') : result;

const formatLogin = (at: number | null): string =>
  at === null
    ? t('players.never')
    : new Date(at).toLocaleString(getLocale() === 'es' ? 'es-CL' : 'en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });

export function PlayersView({ players, campaigns, accountId, loading, onCreate, onReset, onInvite }: PlayersViewProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** The account whose password is being reset, or null when the dialog is closed. */
  const [resetting, setResetting] = useState<ManagedPlayer | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  /** Player id -> the campaign picked in their invite select. */
  const [inviteChoice, setInviteChoice] = useState<Record<string, string>>({});

  const report = (result: string | null | boolean, success: string): void => {
    const problem = failure(result);
    setError(problem);
    setNotice(problem === null ? success : null);
  };

  return (
    <section>
      <div className="hero">
        <h1>{t('players.title')}</h1>
        <p className="muted">{t('players.subtitle')}</p>
      </div>

      <form
        className="panel"
        onSubmit={(event) => {
          event.preventDefault();
          const name = username.trim();
          if (name === '' || password.length < MIN_PASSWORD_LENGTH) return;
          void onCreate(name, password).then((result) => {
            report(result, t('players.created', { username: name }));
            if (failure(result) === null) {
              setUsername('');
              setPassword('');
            }
          });
        }}
      >
        <h2>{t('players.createPlayer')}</h2>
        <label htmlFor="new-player-username">{t('common.username')}</label>
        <input
          id="new-player-username"
          name="new-username"
          autoComplete="off"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
        <label htmlFor="new-player-password" className="mt-3">
          {t('players.initialPassword')}
        </label>
        <input
          id="new-player-password"
          name="new-player-password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-describedby="new-player-password-hint"
        />
        <p className="muted" id="new-player-password-hint">
          {t('changePassword.minLength', { min: MIN_PASSWORD_LENGTH })}
        </p>
        <div className="mt-3">
          <button type="submit" disabled={username.trim() === '' || password.length < MIN_PASSWORD_LENGTH}>
            {t('players.createPlayer')}
          </button>
        </div>
      </form>

      {error !== null ? (
        <div className="errors" role="alert">
          {error}
        </div>
      ) : null}
      {notice !== null ? (
        <p className="muted" role="status">
          {notice}
        </p>
      ) : null}

      <div className="panel">
        <h2>{t('players.existingTitle')}</h2>
        {loading ? (
          <p className="muted">{t('common.loading')}</p>
        ) : players.length === 0 ? (
          <p className="muted">{t('players.noneYet')}</p>
        ) : (
          <div className="players-table-wrap">
            <table className="players-table">
              <thead>
                <tr>
                  <th scope="col">{t('players.username')}</th>
                  <th scope="col">{t('players.campaigns')}</th>
                  <th scope="col">{t('players.invitedTo')}</th>
                  <th scope="col">{t('players.lastLogin')}</th>
                  <th scope="col">{t('players.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {players.map((player) => {
                  const candidates = invitableCampaigns(player, campaigns, accountId);
                  const choice = inviteChoice[player.id] ?? '';
                  return (
                    <tr key={player.id}>
                      <th scope="row">
                        {player.username}
                        {player.mustChangePassword ? (
                          <span className="muted">{t('players.mustChangePassword')}</span>
                        ) : null}
                      </th>
                      <td>
                        {player.campaigns.length === 0
                          ? '—'
                          : player.campaigns.map((c) => (
                              <span key={c.id} className="players-table-campaign">
                                {c.name}
                                {c.status === 'active' ? null : (
                                  <span className="muted"> ({t(`status.${c.status}`)})</span>
                                )}
                              </span>
                            ))}
                      </td>
                      <td>
                        {player.invitedTo.length === 0
                          ? '—'
                          : player.invitedTo.map((c) => (
                              <span key={c.id} className="players-table-campaign">
                                {c.name}
                              </span>
                            ))}
                      </td>
                      <td>{formatLogin(player.lastLoginAt)}</td>
                      <td>
                        <div className="row">
                          {candidates.length === 0 ? (
                            <span className="muted">{t('players.noCampaignToInvite')}</span>
                          ) : (
                            <form
                              className="row"
                              onSubmit={(event) => {
                                event.preventDefault();
                                if (choice === '') return;
                                void onInvite(choice, player.username).then((result) => {
                                  report(result, t('players.invited', { username: player.username }));
                                  setInviteChoice((current) => ({ ...current, [player.id]: '' }));
                                });
                              }}
                            >
                              <label className="sr-only" htmlFor={`invite-${player.id}`}>
                                {t('players.inviteTo')}
                              </label>
                              <select
                                id={`invite-${player.id}`}
                                value={choice}
                                onChange={(event) =>
                                  setInviteChoice((current) => ({ ...current, [player.id]: event.target.value }))
                                }
                              >
                                <option value="">{t('players.inviteTo')}</option>
                                {candidates.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name}
                                  </option>
                                ))}
                              </select>
                              <button type="submit" disabled={choice === ''}>
                                {t('players.invite')}
                              </button>
                            </form>
                          )}
                          <button
                            type="button"
                            className="btn-ghost"
                            onClick={() => {
                              setResetPasswordValue('');
                              setResetting(player);
                            }}
                          >
                            {t('players.resetPassword')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {/* A styled dialog rather than window.prompt, which cannot be translated,
          cannot be styled, and gave no sign that the reset had worked. */}
      {resetting !== null ? (
        <Dialog title={t('players.resetTitle', { username: resetting.username })} onClose={() => setResetting(null)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (resetPasswordValue.length < MIN_PASSWORD_LENGTH) return;
              const target = resetting;
              setResetting(null);
              void onReset(target, resetPasswordValue).then((result) =>
                report(result, t('players.resetDone', { username: target.username })),
              );
              setResetPasswordValue('');
            }}
          >
            <p className="muted">{t('players.resetPrompt')}</p>
            <label htmlFor="reset-password">{t('players.initialPassword')}</label>
            <input
              id="reset-password"
              name="reset-password"
              type="password"
              autoComplete="new-password"
              value={resetPasswordValue}
              onChange={(event) => setResetPasswordValue(event.target.value)}
              aria-describedby="reset-password-hint"
            />
            <p className="muted" id="reset-password-hint">
              {t('changePassword.minLength', { min: MIN_PASSWORD_LENGTH })}
            </p>
            <div className="mt-3">
              <button type="submit" className="btn-primary" disabled={resetPasswordValue.length < MIN_PASSWORD_LENGTH}>
                {t('players.resetPassword')}
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </section>
  );
}
