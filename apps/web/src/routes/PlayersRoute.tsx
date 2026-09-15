import type { User } from '@daggerheart/protocol';
import { useEffect, useState } from 'react';

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

  const authHeader = { authorization: `Bearer ${token}` };

  const reload = (): void => {
    fetch(`${SERVER_URL}/users`, { headers: authHeader })
      .then((response) => (response.ok ? (response.json() as Promise<User[]>) : Promise.reject()))
      .then(setPlayers)
      .catch(() => setError(t('players.loadFailed')));
  };

  useEffect(reload, []);

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
    reload();
  };

  const resetPassword = async (id: string): Promise<void> => {
    const newPassword = window.prompt(t('players.resetPrompt'));
    if (newPassword === null || newPassword === '') return;
    const response = await fetch(`${SERVER_URL}/users/${id}/reset-password`, {
      method: 'POST',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ newPassword }),
    });
    if (!response.ok) setError(t('players.resetFailed'));
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
      </div>

      <div className="panel">
        <h2>{t('players.existingTitle')}</h2>
        {players.length === 0 ? (
          <p className="muted">{t('players.noneYet')}</p>
        ) : (
          <ul>
            {players.map((player) => (
              <li key={player.id} className="row spread">
                <span>
                  {player.username}
                  {player.mustChangePassword ? t('players.mustChangePassword') : ''}
                </span>
                <button type="button" onClick={() => resetPassword(player.id)}>
                  {t('players.resetPassword')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
