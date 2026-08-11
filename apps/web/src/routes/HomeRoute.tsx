import { Link } from 'react-router-dom';

import type { ConnectionStatus } from '../state/useRoom.js';
import { CampaignRoute } from './CampaignRoute.js';

interface HomeRouteProps {
  status: ConnectionStatus;
  error: string | null;
  code: string | null;
  role: 'gm' | 'player' | null;
  hasActiveCharacter: boolean;
  onCreate: (gmName: string) => void;
  onJoin: (code: string, name: string) => void;
  onLeave: () => void;
}

/**
 * The front door. Nobody sees the campaign forms or the GM/player split until
 * they land here — everything past this point already knows which one it is.
 */
export function HomeRoute({
  status,
  error,
  code,
  role,
  hasActiveCharacter,
  onCreate,
  onJoin,
  onLeave,
}: HomeRouteProps) {
  // Already seated at a table: skip the pitch, go straight to the tools for that seat.
  if (code !== null) {
    return (
      <section>
        <div className="hero">
          <h1>Ya estás en la mesa</h1>
          <p className="muted">
            Código de acceso <span className="join-code">{code}</span> · {role === 'gm' ? 'Director de Juego' : 'Jugador'}
          </p>
        </div>
        <div className="grid cols-2">
          <Link to="/map" className="option home-option">
            <span className="option-name">Abrir el mapa</span>
            <span className="option-meta">Escenas tácticas, fichas, niebla de guerra.</span>
          </Link>
          {role === 'gm' ? (
            <Link to="/gm" className="option home-option">
              <span className="option-name">Panel del DJ</span>
              <span className="option-meta">Adversarios, miedo, registro de tiradas.</span>
            </Link>
          ) : (
            <Link to="/sheet" className="option home-option">
              <span className="option-name">Hoja de personaje</span>
              <span className="option-meta">Tus rasgos, movimientos y recursos.</span>
            </Link>
          )}
        </div>
        <div className="row mt-4">
          <Link to="/characters">
            <button type="button">Biblioteca de personajes</button>
          </Link>
          <button type="button" onClick={onLeave}>
            Salir de la campaña
          </button>
        </div>
        {error !== null ? <div className="errors">{error}</div> : null}
      </section>
    );
  }

  return (
    <section>
      <div className="hero">
        <h1>DAGGERHEART VTT</h1>
        <p className="muted">Dirige la mesa o ven a jugar. Elige una opción para ver las herramientas.</p>
      </div>
      <CampaignRoute
        status={status}
        error={error}
        code={code}
        role={role}
        onCreate={onCreate}
        onJoin={onJoin}
        onLeave={onLeave}
      />
      {hasActiveCharacter ? (
        <div className="panel">
          <div className="row spread">
            <span className="muted">Tienes un personaje listo.</span>
            <Link to="/sheet">
              <button type="button">Abrir hoja</button>
            </Link>
          </div>
        </div>
      ) : null}
    </section>
  );
}
