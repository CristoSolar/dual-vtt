import { useEffect } from 'react';
import { Link } from 'react-router-dom';

import { t } from '../i18n/index.js';

interface PlayerHomeRouteProps {
  username: string;
  /** Pending invitations, flagged on the campaigns card so they are not missed. */
  invitationCount: number;
  /** Re-reads the campaign list, so a fresh invitation is flagged. */
  onRefresh: () => void;
}

/**
 * A player's front door: two choices and nothing else. The art sits on a CSS
 * gradient, so a missing image leaves a styled card rather than a broken icon.
 */
export function PlayerHomeRoute({ username, invitationCount, onRefresh }: PlayerHomeRouteProps) {
  useEffect(() => {
    onRefresh();
  }, [onRefresh]);

  return (
    <section>
      <div className="hero">
        <h1>{t('home.title', { name: username })}</h1>
        <p className="muted">{t('home.subtitle')}</p>
      </div>
      <div className="player-home">
        <Link to="/characters" className="home-door home-door--characters">
          <span className="home-door-text">
            <span className="home-door-title">{t('home.characters')}</span>
            <span className="home-door-desc">{t('home.charactersDesc')}</span>
          </span>
        </Link>
        <Link to="/campaigns" className="home-door home-door--campaigns">
          {invitationCount > 0 ? (
            <span className="home-door-badge">{t('home.invitations', { count: invitationCount })}</span>
          ) : null}
          <span className="home-door-text">
            <span className="home-door-title">{t('home.campaigns')}</span>
            <span className="home-door-desc">{t('home.campaignsDesc')}</span>
          </span>
        </Link>
      </div>
    </section>
  );
}
