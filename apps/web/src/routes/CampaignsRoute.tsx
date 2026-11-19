import type { CampaignStatus, CampaignSummary } from '@daggerheart/protocol';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { t } from '../i18n/index.js';
import { CAMPAIGN_STATUSES, campaignsByStatus } from '../state/gmHome.js';

interface CampaignsRouteProps {
  accountId: string;
  campaigns: readonly CampaignSummary[];
  /** Which status tab opens first. */
  initialTab?: CampaignStatus;
  onCreate: (name: string) => void;
  /** Sits the GM at the campaign's live table. */
  onEnter: (campaignId: string) => void;
  /** True while creating a campaign — disables the form so a double-click can't
   * fire the request twice. */
  pending: boolean;
  /** The tunnel is one per server, not per campaign. */
  tunnelUrl: string | null;
  tunnelLoading: boolean;
  onGenerateTunnel: () => void;
}

/**
 * The GM's "Mis campañas": the campaigns they run, in tabs by status, each with a
 * way into its page (story, notes, monsters, players) and one to the table.
 * Connection errors surface once, higher up in `App.tsx`'s shared `Toast`.
 */
export function CampaignsRoute({
  accountId,
  campaigns,
  initialTab = 'active',
  onCreate,
  onEnter,
  pending,
  tunnelUrl,
  tunnelLoading,
  onGenerateTunnel,
}: CampaignsRouteProps) {
  const [name, setName] = useState('');
  const [tab, setTab] = useState<CampaignStatus>(initialTab);
  const [copied, setCopied] = useState(false);
  const groups = campaignsByStatus(campaigns, accountId);
  const shown = groups[tab];

  return (
    <section>
      <div className="hero">
        <h1>{t('gmCampaigns.title')}</h1>
        <p className="muted">{t('gmCampaigns.subtitle')}</p>
      </div>

      <form
        className="panel"
        onSubmit={(event) => {
          event.preventDefault();
          if (pending || name.trim() === '') return;
          onCreate(name.trim());
          setName('');
          setTab('active');
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

      <nav className="sheet-tabs mb-4" role="tablist" aria-label={t('gmCampaigns.tabsAria')}>
        {CAMPAIGN_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            className="sheet-tab"
            role="tab"
            aria-selected={tab === status}
            onClick={() => setTab(status)}
          >
            {t(`gmCampaigns.tab.${status}`, { count: groups[status].length })}
          </button>
        ))}
      </nav>

      {shown.length === 0 ? (
        <div className="panel">
          <p className="muted">{t('gmCampaigns.emptyTab')}</p>
          {campaigns.length === 0 ? <p className="muted">{t('campaigns.noneHint')}</p> : null}
        </div>
      ) : (
        <div className="grid cols-2">
          {shown.map((campaign) => (
            <div className="campaign-card" key={campaign.id}>
              <div className="campaign-card-art">
                <span className={`campaign-card-chip status-chip--${campaign.status}`}>
                  {t(`status.${campaign.status}`)}
                </span>
              </div>
              <div className="campaign-card-body">
                <h2>{campaign.name}</h2>
                <p className="muted">
                  {t('campaigns.memberCount', { count: campaign.memberIds.length })}
                  {campaign.invitedIds.length > 0
                    ? ` · ${t('campaigns.pendingInvites')}: ${campaign.invitedIds.length}`
                    : ''}
                </p>
                <div className="campaign-card-footer">
                  <Link to={`/campaigns/${campaign.id}`}>
                    <button type="button" className="btn-primary">
                      {t('gmCampaigns.open')}
                    </button>
                  </Link>
                  <button type="button" className="btn-ghost" onClick={() => onEnter(campaign.id)}>
                    {t('gmCampaigns.enterTable')}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="panel mt-4">
        <h2>{t('gmCampaigns.tunnelTitle')}</h2>
        <div className="row">
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
      </div>
    </section>
  );
}
