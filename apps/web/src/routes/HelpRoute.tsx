import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { GuideDialog } from '../components/GuideDialog.js';
import { t, type MessageKey } from '../i18n/index.js';

export type HelpTab = 'app' | 'rules' | 'compendium';
const TABS: readonly HelpTab[] = ['app', 'rules', 'compendium'];

const APP_SECTIONS = ['start', 'campaigns', 'creation', 'sheet', 'gm', 'map', 'rolls', 'faq'] as const;

/** Parses `#<tab>[/rest]`; anything unknown falls back to the app guide. */
export function parseHelpHash(hash: string): { tab: HelpTab; rest: string[] } {
  const [head = '', ...rest] = hash.replace(/^#/, '').split('/');
  const tab = (TABS as readonly string[]).includes(head) ? (head as HelpTab) : 'app';
  return { tab, rest };
}

/** A collapsible section that hides itself when the filter matches neither title nor body. */
export function Section({ title, body, filter }: { title: MessageKey; body: MessageKey; filter: string }) {
  const heading = t(title);
  const text = t(body);
  const needle = filter.trim().toLowerCase();
  if (needle !== '' && !`${heading} ${text}`.toLowerCase().includes(needle)) return null;
  return (
    <details open={needle !== ''}>
      <summary>{heading}</summary>
      <p className="card-text">{text}</p>
    </details>
  );
}

export function HelpRoute({ role }: { role?: 'gm' | 'player' } = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { tab } = parseHelpHash(location.hash);
  const [filter, setFilter] = useState('');
  const [guideOpen, setGuideOpen] = useState(false);

  const visibleCount = APP_SECTIONS.filter((key) => {
    const needle = filter.trim().toLowerCase();
    if (needle === '') return true;
    const heading = t(`help.app.${key}.title` as MessageKey);
    const text = t(`help.app.${key}.body` as MessageKey);
    return `${heading} ${text}`.toLowerCase().includes(needle);
  }).length;

  return (
    <section className="help">
      <h1>{t('help.title')}</h1>
      {role !== undefined ? (
        <button type="button" onClick={() => setGuideOpen(true)}>
          {t('help.quickGuide')}
        </button>
      ) : null}
      {guideOpen && role !== undefined ? <GuideDialog role={role} onClose={() => setGuideOpen(false)} /> : null}
      <div className="help-tabs" role="tablist">
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => navigate(`/help#${id}`)}
          >
            {t(`help.tab.${id}` as MessageKey)}
          </button>
        ))}
      </div>

      {tab !== 'compendium' ? (
        <input
          className="help-filter"
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t('help.filterPlaceholder')}
          aria-label={t('help.filterPlaceholder')}
        />
      ) : null}

      {tab === 'app' ? (
        <div className="help-sections">
          {visibleCount === 0 ? <p className="muted">{t('help.noMatches')}</p> : null}
          {APP_SECTIONS.map((key) => (
            <Section
              key={key}
              title={`help.app.${key}.title` as MessageKey}
              body={`help.app.${key}.body` as MessageKey}
              filter={filter}
            />
          ))}
        </div>
      ) : null}

      {tab === 'rules' ? <p className="muted">{t('help.tab.rules')}</p> : null}
      {tab === 'compendium' ? <p className="muted">{t('help.tab.compendium')}</p> : null}
    </section>
  );
}
