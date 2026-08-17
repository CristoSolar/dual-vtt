import type { User } from '@daggerheart/protocol';
import { useEffect, useState } from 'react';

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
      .catch(() => setError('No se pudo cargar la lista de jugadores.'));
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
      setError(response.status === 409 ? 'Ese usuario ya existe.' : 'No se pudo crear el jugador.');
      return;
    }
    setUsername('');
    setPassword('');
    reload();
  };

  const resetPassword = async (id: string): Promise<void> => {
    const newPassword = window.prompt('Nueva contraseña temporal para este jugador:');
    if (newPassword === null || newPassword === '') return;
    const response = await fetch(`${SERVER_URL}/users/${id}/reset-password`, {
      method: 'POST',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ newPassword }),
    });
    if (!response.ok) setError('No se pudo resetear la contraseña.');
  };

  return (
    <section>
      <div className="hero">
        <h1>Jugadores</h1>
        <p className="muted">Crea una cuenta para cada jugador de tu mesa.</p>
      </div>

      <div className="panel">
        <h2>Crear jugador</h2>
        <label htmlFor="new-player-username">Usuario</label>
        <input id="new-player-username" value={username} onChange={(event) => setUsername(event.target.value)} />
        <label htmlFor="new-player-password" className="mt-3">
          Contraseña inicial
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
            Crear jugador
          </button>
        </div>
        {error !== null ? <div className="errors">{error}</div> : null}
      </div>

      <div className="panel">
        <h2>Jugadores existentes</h2>
        {players.length === 0 ? (
          <p className="muted">Todavía no creaste ningún jugador.</p>
        ) : (
          <ul>
            {players.map((player) => (
              <li key={player.id} className="row spread">
                <span>
                  {player.username}
                  {player.mustChangePassword ? ' (debe cambiar su contraseña)' : ''}
                </span>
                <button type="button" onClick={() => resetPassword(player.id)}>
                  Resetear contraseña
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
