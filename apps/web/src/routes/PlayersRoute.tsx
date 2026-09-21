import type { User } from '@daggerheart/protocol';
import { useCallback, useEffect, useState } from 'react';

import { Dialog } from '../components/Dialog.js';
import { t } from '../i18n/index.js';
import { SERVER_URL } from '../state/useCampaign.js';

interface PlayersRouteProps {
  token: string;
}

/** GM-only: create and manage the player accounts for this install. */
export function PlayersRoute({ token }: PlayersRouteProps) {
  const [players, setPlayers] = useState<readonly User[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** The account whose password is being reset, or null when the dialog is closed. */
  const [resetting, setResetting] = useState<User | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');

  const reload = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      try {
        const response = await fetch(`${SERVER_URL}/users`, {
          headers: { authorization: `Bearer ${token}` },
          ...(signal === undefined ? {} : { signal }),
        });
        if (!response.ok) throw new Error('load failed');
        setPlayers((await response.json()) as User[]);
        setError(null);
      } catch (cause) {
        // An abort is this component unmounting, not a failure worth showing.
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(t('players.loadFailed'));
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    // Aborted on unmount, so a slow response cannot set state on a gone component.
    return () => controller.abort();
  }, [reload]);

  const authHeader = { authorization: `Bearer ${token}` };

  const createPlayer = async (): Promise<void> => {
    setError(null);
    const response = await fetch(`${SERVER_URL}/users`, {
      method: 'POST',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!response.ok) {
      setError(response.status === 409 ? t('players.usernameTaken') : t('players.createFailed'));
      return;
    }
    setUsername('');
    setPassword('');
    setNotice(t('players.created', { username: username.trim() }));
    void reload();
  };

  const confirmReset = async (): Promise<void> => {
    if (resetting === null || resetPasswordValue === '') return;
    const target = resetting;
    const response = await fetch(`${SERVER_URL}/users/${target.id}/reset-password`, {
      method: 'POST',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ newPassword: resetPasswordValue }),
    });
    setResetting(null);
    setResetPasswordValue('');
    if (!response.ok) {
      setError(t('players.resetFailed'));
      return;
    }
    // The list carries `mustChangePassword`, which this just turned back on.
    setNotice(t('players.resetDone', { username: target.username }));
    void reload();
  };

  return (
    <section>
      <div className="hero">
        <h1>{t('players.title')}</h1>
        <p className="muted">{t('players.subtitle')}</p>
      </div>

      <div className="panel">
        <h2>{t('players.createPlayer')}</h2>
        <label htmlFor="new-player-username">{t('common.username')}</label>
        <input id="new-player-username" value={username} onChange={(event) => setUsername(event.target.value)} />
        <label htmlFor="new-player-password" className="mt-3">
          {t('players.initialPassword')}
        </label>
        <input
          id="new-player-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <div className="mt-3">
          <button
            type="button"
            disabled={username.trim() === '' || password === ''}
            onClick={createPlayer}
          >
            {t('players.createPlayer')}
          </button>
        </div>
        {error !== null ? <div className="errors">{error}</div> : null}
        {notice !== null ? <p className="muted">{notice}</p> : null}
      </div>

      <div className="panel">
        <h2>{t('players.existingTitle')}</h2>
        {loading ? (
          <p className="muted">{t('common.loading')}</p>
        ) : players.length === 0 ? (
          <p className="muted">{t('players.noneYet')}</p>
        ) : (
          <ul>
            {players.map((player) => (
              <li key={player.id} className="row spread">
                <span>
                  {player.username}
                  {player.mustChangePassword ? t('players.mustChangePassword') : ''}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setResetPasswordValue('');
                    setResetting(player);
                  }}
                >
                  {t('players.resetPassword')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {/* A styled dialog rather than window.prompt, which cannot be translated,
          cannot be styled, and gave no sign that the reset had worked. */}
      {resetting !== null ? (
        <Dialog
          title={t('players.resetTitle', { username: resetting.username })}
          onClose={() => setResetting(null)}
        >
          <p className="muted">{t('players.resetPrompt')}</p>
          <label htmlFor="reset-password">{t('players.initialPassword')}</label>
          <input
            id="reset-password"
            type="password"
            autoComplete="new-password"
            value={resetPasswordValue}
            onChange={(event) => setResetPasswordValue(event.target.value)}
          />
          <div className="mt-3">
            <button
              type="button"
              className="btn-primary"
              disabled={resetPasswordValue === ''}
              onClick={() => void confirmReset()}
            >
              {t('players.resetPassword')}
            </button>
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}
