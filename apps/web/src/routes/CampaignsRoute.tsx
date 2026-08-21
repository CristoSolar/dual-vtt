import type { CampaignSummary } from '@daggerheart/protocol';
import { useState } from 'react';

interface CampaignsRouteProps {
  accountId: string;
  campaigns: readonly CampaignSummary[];
  onCreate: (name: string) => void;
  onJoin: (campaignId: string) => void;
  onAddPlayer: (campaignId: string, username: string) => void;
  /** The tunnel is one per server, not per campaign — the same URL (or none yet)
   * shows on every card the account owns. */
  tunnelUrl: string | null;
  tunnelLoading: boolean;
  onGenerateTunnel: () => void;
}

/**
 * Lists the campaigns this account owns or belongs to, and offers to create one.
 * Connection errors surface once, higher up in `App.tsx`'s shared `Toast` — not
 * duplicated here.
 */
export function CampaignsRoute({
  accountId,
  campaigns,
  onCreate,
  onJoin,
  onAddPlayer,
  tunnelUrl,
  tunnelLoading,
  onGenerateTunnel,
}: CampaignsRouteProps) {
  const [name, setName] = useState('');
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [copied, setCopied] = useState(false);

  return (
    <section>
      <div className="hero">
        <h1>Campañas</h1>
        <p className="muted">Elige una campaña para entrar, o crea una nueva.</p>
      </div>

      <div className="panel">
        <h2>Crear una campaña</h2>
        <label htmlFor="campaign-name">Nombre</label>
        <input
          id="campaign-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Grupo del martes"
        />
        <div className="mt-3">
          <button
            type="button"
            disabled={name.trim() === ''}
            onClick={() => {
              onCreate(name.trim());
              setName('');
            }}
          >
            Crear campaña
          </button>
        </div>
      </div>

      {campaigns.length === 0 ? (
        <div className="panel">
          <p className="muted">Todavía no perteneces a ninguna campaña.</p>
        </div>
      ) : (
        <div className="grid cols-2">
          {campaigns.map((campaign) => (
            <div className="panel" key={campaign.id}>
              <div className="card-head">
                <h2>{campaign.name}</h2>
                {campaign.ownerId === accountId ? <span className="badge">DJ</span> : null}
              </div>
              <p className="muted">
                {campaign.ownerId === accountId
                  ? `${campaign.memberIds.length} jugador(es)`
                  : `DJ: ${campaign.ownerUsername}`}
              </p>
              <div className="row">
                <button type="button" onClick={() => onJoin(campaign.id)}>
                  Entrar
                </button>
                {campaign.ownerId === accountId ? (
                  <button
                    type="button"
                    onClick={() => setAddingTo(addingTo === campaign.id ? null : campaign.id)}
                  >
                    Agregar jugador
                  </button>
                ) : null}
              </div>
              {addingTo === campaign.id ? (
                <div className="row mt-3">
                  <input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="usuario"
                  />
                  <button
                    type="button"
                    disabled={username.trim() === ''}
                    onClick={() => {
                      onAddPlayer(campaign.id, username.trim());
                      setUsername('');
                      setAddingTo(null);
                    }}
                  >
                    Agregar
                  </button>
                </div>
              ) : null}
              {campaign.ownerId === accountId ? (
                <div className="row mt-3">
                  {tunnelUrl === null ? (
                    <button type="button" disabled={tunnelLoading} onClick={onGenerateTunnel}>
                      {tunnelLoading ? 'Generando…' : 'Generar enlace para jugadores'}
                    </button>
                  ) : (
                    <>
                      <input
                        readOnly
                        aria-label="Enlace para jugadores"
                        value={tunnelUrl}
                        onFocus={(event) => event.target.select()}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText(tunnelUrl);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }}
                      >
                        {copied ? 'Copiado' : 'Copiar'}
                      </button>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
