import { useState } from 'react';

import type { ConnectionStatus } from '../state/useRoom.js';

interface CampaignRouteProps {
  status: ConnectionStatus;
  error: string | null;
  code: string | null;
  role: 'gm' | 'player' | null;
  onCreate: (gmName: string) => void;
  onJoin: (code: string, name: string) => void;
  onLeave: () => void;
}

/** Create or join a campaign. Everything here is optional: offline play still works. */
export function CampaignRoute({
  status,
  error,
  code,
  role,
  onCreate,
  onJoin,
  onLeave,
}: CampaignRouteProps) {
  const [gmName, setGmName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [playerName, setPlayerName] = useState('');

  if (code !== null) {
    return (
      <section>
        <div className="panel">
          <div className="card-head">
            <div>
              <h2>
                Código de acceso: <span className="join-code">{code}</span>
              </h2>
              <p className="muted">
                Eres {role === 'gm' ? 'el DJ' : 'jugador'} · {status}
              </p>
            </div>
            <button type="button" onClick={onLeave}>
              Salir de la campaña
            </button>
          </div>
          <p className="muted">
            Comparte el código con tu mesa. Los jugadores se unen y luego reclaman el
            personaje que crearon.
          </p>
        </div>
        {error !== null ? <div className="errors">{error}</div> : null}
      </section>
    );
  }

  return (
    <section>
      {error !== null ? <div className="errors">{error}</div> : null}

      <div className="grid cols-2">
        <div className="panel">
          <h2>Crear una campaña</h2>
          <p className="muted">Diriges la mesa y obtienes el panel del DJ.</p>
          <label htmlFor="gm-name">Tu nombre</label>
          <input
            id="gm-name"
            value={gmName}
            onChange={(event) => setGmName(event.target.value)}
            placeholder="El DJ"
          />
          <div className="mt-3">
            <button type="button" disabled={gmName.trim() === ''} onClick={() => onCreate(gmName.trim())}>
              Crear campaña
            </button>
          </div>
        </div>

        <div className="panel">
          <h2>Unirse a una campaña</h2>
          <p className="muted">Ingresa el código de seis caracteres que te dio tu DJ.</p>
          <label htmlFor="join-code">Código de acceso</label>
          <input
            id="join-code"
            value={joinCode}
            maxLength={6}
            autoCapitalize="characters"
            onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
            placeholder="ABC234"
          />
          <label htmlFor="player-name" className="mt-3">
            Tu nombre
          </label>
          <input
            id="player-name"
            value={playerName}
            onChange={(event) => setPlayerName(event.target.value)}
            placeholder="Alex"
          />
          <div className="mt-3">
            <button
              type="button"
              disabled={joinCode.trim().length !== 6 || playerName.trim() === ''}
              onClick={() => onJoin(joinCode.trim(), playerName.trim())}
            >
              Unirse a la campaña
            </button>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Jugando sin conexión</h2>
        <p className="muted">
          No necesitas una campaña para usar esto. Los personajes que creas se guardan en
          este dispositivo y la hoja funciona con el servidor detenido.
        </p>
      </div>
    </section>
  );
}
