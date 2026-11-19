import { Link } from 'react-router-dom';

import { t } from '../i18n/index.js';

interface GmHomeRouteProps {
  username: string;
  /** Active campaigns, flagged on the campaigns door. */
  activeCount: number;
}

/**
 * The GM's front door, built like the player's: two big cards. The art sits on a
 * CSS gradient (`home-door--gm-*` in app.css), so a missing image leaves a styled
 * card rather than a broken icon.
 */
export function GmHomeRoute({ username, activeCount }: GmHomeRouteProps) {
  return (
    <section>
      <div className="hero">
        <h1>{t('home.title', { name: username })}</h1>
        <p className="muted">{t('home.subtitle')}</p>
      </div>
      <div className="player-home">
        <Link to="/campaigns" className="home-door home-door--gm-campaigns">
          {activeCount > 0 ? (
            <span className="home-door-badge">{t('gmHome.activeCount', { count: activeCount })}</span>
          ) : null}
          <span className="home-door-text">
            <span className="home-door-title">{t('gmHome.campaigns')}</span>
            <span className="home-door-desc">{t('gmHome.campaignsDesc')}</span>
          </span>
        </Link>
        <Link to="/players" className="home-door home-door--gm-players">
          <span className="home-door-text">
            <span className="home-door-title">{t('gmHome.players')}</span>
            <span className="home-door-desc">{t('gmHome.playersDesc')}</span>
          </span>
        </Link>
      </div>
    </section>
  );
}
