import type { CampaignSummary, LibraryCharacter } from '@daggerheart/protocol';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';

import { t } from '../i18n/index.js';
import { characterIn } from '../state/library.js';

interface MyCampaignsRouteProps {
  accountId: string;
  campaigns: readonly CampaignSummary[];
  invited: readonly CampaignSummary[];
  characters: readonly LibraryCharacter[];
  pending: boolean;
  onAnswer: (campaignId: string, answer: 'accept' | 'decline') => void;
  onEnter: (campaignId: string) => void;
  /** Re-reads campaigns and characters, so a fresh invitation shows on arrival. */
  onRefresh: () => void;
}

/** Invitations first — they need an answer — then the tables this account plays at. */
export function MyCampaignsRoute({
  accountId,
  campaigns,
  invited,
  characters,
  pending,
  onAnswer,
  onEnter,
  onRefresh,
}: MyCampaignsRouteProps) {
  useEffect(() => {
    onRefresh();
  }, [onRefresh]);

  return (
    <section>
      <div className="hero">
        <h1>{t('myCampaigns.title')}</h1>
        <p className="muted">{t('myCampaigns.subtitle')}</p>
      </div>

      {invited.length > 0 ? (
        <>
          <h2 className="section-title">{t('myCampaigns.invitations')}</h2>
          <div className="grid cols-2 mb-4">
            {invited.map((campaign) => (
              <div className="campaign-card campaign-card--invite" key={campaign.id}>
                <div className="campaign-card-body">
                  <h2>{campaign.name}</h2>
                  <p className="muted">{t('myCampaigns.invitedBy', { username: campaign.ownerUsername })}</p>
                  <div className="campaign-card-footer">
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={pending}
                      onClick={() => onAnswer(campaign.id, 'accept')}
                    >
                      {t('myCampaigns.accept')}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={pending}
                      onClick={() => onAnswer(campaign.id, 'decline')}
                    >
                      {t('myCampaigns.decline')}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <h2 className="section-title">{t('myCampaigns.member')}</h2>
      {campaigns.length === 0 ? (
        <div className="panel">
          <p className="muted">{t('myCampaigns.none')}</p>
          <p className="muted">{t('myCampaigns.noneHint')}</p>
        </div>
      ) : (
        <div className="grid cols-2">
          {campaigns.map((campaign) => {
            const isOwner = campaign.ownerId === accountId;
            const mine = characterIn(characters, campaign.id);
            return (
              <div className="campaign-card" key={campaign.id}>
                <div className="campaign-card-art">
                  {isOwner ? <span className="campaign-card-chip">{t('campaigns.gmChip')}</span> : null}
                </div>
                <div className="campaign-card-body">
                  <h2>{campaign.name}</h2>
                  <p className="muted">{t('campaigns.ownedBy', { username: campaign.ownerUsername })}</p>
                  {isOwner ? null : mine !== null ? (
                    <p>{t('myCampaigns.yourCharacter', { name: mine.sheet.character.name ?? t('library.unnamed') })}</p>
                  ) : (
                    <p className="muted">
                      {t('myCampaigns.noCharacter')} <Link to="/characters">{t('myCampaigns.linkOne')}</Link>
                    </p>
                  )}
                  <div className="campaign-card-footer">
                    <button type="button" className="btn-primary" onClick={() => onEnter(campaign.id)}>
                      {t('campaigns.join')}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
