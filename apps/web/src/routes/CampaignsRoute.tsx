import type { CampaignSummary } from '@daggerheart/protocol';
import { useState } from 'react';

interface CampaignsRouteProps {
  accountId: string;
  campaigns: readonly CampaignSummary[];
  onCreate: (name: string) => void;
  onJoin: (campaignId: string) => void;
  onAddPlayer: (campaignId: string, username: string) => void;
  /** True while creating a campaign or adding a player — disables the relevant
   * form so a double-click can't fire the request twice. */
  pending: boolean;
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
  pending,
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
            className="btn-primary"
            disabled={pending || name.trim() === ''}
            onClick={() => {
              onCreate(name.trim());
              setName('');
            }}
          >
            {pending ? 'Creando…' : 'Crear campaña'}
          </button>
        </div>
      </div>

      {campaigns.length === 0 ? (
        <div className="panel">
          <p className="muted">Todavía no perteneces a ninguna campaña.</p>
        </div>
      ) : (
        <div className="grid cols-2">
          {campaigns.map((campaign) => {
            const isOwner = campaign.ownerId === accountId;
            return (
              <div className="campaign-card" key={campaign.id}>
                <div className="campaign-card-art">
                  {isOwner ? <span className="campaign-card-chip">DJ</span> : null}
                </div>
                <div className="campaign-card-body">
                  <h2>{campaign.name}</h2>
                  <p className="muted">
                    {isOwner
                      ? `${campaign.memberIds.length} jugador(es)`
                      : `DJ: ${campaign.ownerUsername}`}
                  </p>
                  <div className="campaign-card-footer">
                    <button type="button" className="btn-primary" onClick={() => onJoin(campaign.id)}>
                      Entrar
                    </button>
                    {isOwner ? (
                      <button
                        type="button"
                        className="btn-ghost"
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
                        disabled={pending || username.trim() === ''}
                        onClick={() => {
                          onAddPlayer(campaign.id, username.trim());
                          setUsername('');
                          setAddingTo(null);
                        }}
                      >
                        {pending ? 'Agregando…' : 'Agregar'}
                      </button>
                    </div>
                  ) : null}
                  {isOwner ? (
                    <div className="row mt-3">
                      {tunnelUrl === null ? (
                        <button type="button" className="btn-ghost" disabled={tunnelLoading} onClick={onGenerateTunnel}>
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
                            className="btn-ghost"
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
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
