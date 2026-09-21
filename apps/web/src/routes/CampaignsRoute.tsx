import type { CampaignSummary, User } from '@daggerheart/protocol';
import { useEffect, useState } from 'react';

import { t } from '../i18n/index.js';
import { SERVER_URL } from '../state/useCampaign.js';

interface CampaignsRouteProps {
  accountId: string;
  campaigns: readonly CampaignSummary[];
  onCreate: (name: string) => void;
  onJoin: (campaignId: string) => void;
  onAddPlayer: (campaignId: string, username: string) => void;
  /** Session token — the player list behind "add player" is GM-only. */
  token: string;
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
  token,
  pending,
  tunnelUrl,
  tunnelLoading,
  onGenerateTunnel,
}: CampaignsRouteProps) {
  const [name, setName] = useState('');
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [copied, setCopied] = useState(false);
  /** The accounts that exist, so the GM picks one instead of typing a name that
   * may not match any. Loaded once, when the first "add player" form opens. */
  const [players, setPlayers] = useState<readonly User[]>([]);

  useEffect(() => {
    if (addingTo === null) return;
    const controller = new AbortController();
    void fetch(`${SERVER_URL}/users`, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then((response) => (response.ok ? (response.json() as Promise<User[]>) : []))
      .then(setPlayers)
      // A failure leaves the list empty, which reads as "no accounts yet".
      .catch(() => undefined);
    return () => controller.abort();
  }, [addingTo, token]);

  return (
    <section>
      <div className="hero">
        <h1>{t('campaigns.title')}</h1>
        <p className="muted">{t('campaigns.subtitle')}</p>
      </div>

      <form
        className="panel"
        onSubmit={(event) => {
          event.preventDefault();
          if (pending || name.trim() === '') return;
          onCreate(name.trim());
          setName('');
        }}
      >
        <h2>{t('campaigns.createTitle')}</h2>
        <label htmlFor="campaign-name">{t('campaigns.name')}</label>
        <input
          id="campaign-name"
          name="campaign-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('campaigns.namePlaceholder')}
        />
        <div className="mt-3">
          <button type="submit" className="btn-primary" disabled={pending || name.trim() === ''}>
            {pending ? t('campaigns.creating') : t('campaigns.create')}
          </button>
        </div>
      </form>

      {campaigns.length === 0 ? (
        <div className="panel">
          <p className="muted">{t('campaigns.none')}</p>
          {/* An empty list is the first thing a new account sees, so it says what
              to do next rather than only that there is nothing here. */}
          <p className="muted">{t('campaigns.noneHint')}</p>
        </div>
      ) : (
        <div className="grid cols-2">
          {campaigns.map((campaign) => {
            const isOwner = campaign.ownerId === accountId;
            return (
              <div className="campaign-card" key={campaign.id}>
                <div className="campaign-card-art">
                  {isOwner ? <span className="campaign-card-chip">{t('campaigns.gmChip')}</span> : null}
                </div>
                <div className="campaign-card-body">
                  <h2>{campaign.name}</h2>
                  <p className="muted">
                    {isOwner
                      ? t('campaigns.memberCount', { count: campaign.memberIds.length })
                      : t('campaigns.ownedBy', { username: campaign.ownerUsername })}
                  </p>
                  <div className="campaign-card-footer">
                    <button type="button" className="btn-primary" onClick={() => onJoin(campaign.id)}>
                      {t('campaigns.join')}
                    </button>
                    {isOwner ? (
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => setAddingTo(addingTo === campaign.id ? null : campaign.id)}
                      >
                        {t('campaigns.addPlayer')}
                      </button>
                    ) : null}
                  </div>
                  {addingTo === campaign.id ? (
                    (() => {
                      const candidates = players.filter(
                        (player) => !campaign.memberIds.includes(player.id),
                      );
                      if (candidates.length === 0) {
                        return <p className="muted mt-3">{t('campaigns.noPlayersToAdd')}</p>;
                      }
                      return (
                        <form
                          className="row mt-3"
                          onSubmit={(event) => {
                            event.preventDefault();
                            if (pending || username === '') return;
                            onAddPlayer(campaign.id, username);
                            setUsername('');
                            setAddingTo(null);
                          }}
                        >
                          <label className="sr-only" htmlFor={`add-player-${campaign.id}`}>
                            {t('common.username')}
                          </label>
                          <select
                            id={`add-player-${campaign.id}`}
                            name="username"
                            value={username}
                            onChange={(event) => setUsername(event.target.value)}
                          >
                            <option value="">{t('campaigns.choosePlayer')}</option>
                            {candidates.map((player) => (
                              <option key={player.id} value={player.username}>
                                {player.username}
                              </option>
                            ))}
                          </select>
                          <button type="submit" disabled={pending || username === ''}>
                            {pending ? t('campaigns.adding') : t('campaigns.add')}
                          </button>
                        </form>
                      );
                    })()
                  ) : null}
                  {isOwner ? (
                    <div className="row mt-3">
                      {tunnelUrl === null ? (
                        <button type="button" className="btn-ghost" disabled={tunnelLoading} onClick={onGenerateTunnel}>
                          {tunnelLoading ? t('campaigns.generatingLink') : t('campaigns.generateLink')}
                        </button>
                      ) : (
                        <>
                          <input
                            readOnly
                            aria-label={t('campaigns.linkLabel')}
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
                            {copied ? t('campaigns.copied') : t('campaigns.copy')}
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
