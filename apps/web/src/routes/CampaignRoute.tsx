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
        <h1>Campaign</h1>
        <div className="panel">
          <div className="card-head">
            <div>
              <h2>
                Join code: <span className="join-code">{code}</span>
              </h2>
              <p className="muted">
                You are the {role === 'gm' ? 'GM' : 'player'} · {status}
              </p>
            </div>
            <button type="button" onClick={onLeave}>
              Leave campaign
            </button>
          </div>
          <p className="muted">
            Share the code with your table. Players join, then claim the character they
            created.
          </p>
        </div>
        {error !== null ? <div className="errors">{error}</div> : null}
      </section>
    );
  }

  return (
    <section>
      <h1>Campaign</h1>
      {error !== null ? <div className="errors">{error}</div> : null}

      <div className="grid cols-2">
        <div className="panel">
          <h2>Create a campaign</h2>
          <p className="muted">You run the table and get the GM panel.</p>
          <label htmlFor="gm-name">Your name</label>
          <input
            id="gm-name"
            value={gmName}
            onChange={(event) => setGmName(event.target.value)}
            placeholder="The GM"
          />
          <div className="mt-3">
            <button type="button" disabled={gmName.trim() === ''} onClick={() => onCreate(gmName.trim())}>
              Create campaign
            </button>
          </div>
        </div>

        <div className="panel">
          <h2>Join a campaign</h2>
          <p className="muted">Enter the six-character code your GM shared.</p>
          <label htmlFor="join-code">Join code</label>
          <input
            id="join-code"
            value={joinCode}
            maxLength={6}
            autoCapitalize="characters"
            onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
            placeholder="ABC234"
          />
          <label htmlFor="player-name" className="mt-3">
            Your name
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
              Join campaign
            </button>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Playing offline</h2>
        <p className="muted">
          You don’t need a campaign to use this. Characters you create are saved on this
          device and the sheet works with the server stopped.
        </p>
      </div>
    </section>
  );
}
