import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { Compendium } from '../components/help/Compendium.js';
import { GuideDialog } from '../components/GuideDialog.js';
import { t, type MessageKey } from '../i18n/index.js';

export type HelpTab = 'app' | 'rules' | 'compendium' | 'about';
const TABS: readonly HelpTab[] = ['app', 'rules', 'compendium', 'about'];

const APP_SECTIONS = ['start', 'campaigns', 'creation', 'sheet', 'gm', 'map', 'rolls', 'faq'] as const;

const RULE_SECTIONS = [
  'duality',
  'hope',
  'fear',
  'stress',
  'damage',
  'armor',
  'rests',
  'death',
  'conditions',
  'ranges',
  'cards',
  'levelUp',
] as const;

/** Parses `#<tab>[/rest]`; anything unknown falls back to the app guide. */
export function parseHelpHash(hash: string): { tab: HelpTab; rest: string[] } {
  const [head = '', ...rest] = hash.replace(/^#/, '').split('/');
  const tab = (TABS as readonly string[]).includes(head) ? (head as HelpTab) : 'app';
  return { tab, rest };
}

/** True when the filter is empty, or when it matches the title or body (case-insensitive). */
export function matchesFilter(title: string, body: string, filter: string): boolean {
  const needle = filter.trim().toLowerCase();
  return needle === '' || `${title} ${body}`.toLowerCase().includes(needle);
}

/** A collapsible section that hides itself when the filter matches neither title nor body. */
export function Section({ title, body, filter }: { title: MessageKey; body: MessageKey; filter: string }) {
  const heading = t(title);
  const text = t(body);
  if (!matchesFilter(heading, text, filter)) return null;
  return (
    <details open={filter.trim() !== ''}>
      <summary>{heading}</summary>
      <p className="card-text">{text}</p>
    </details>
  );
}

export function HelpRoute({ role }: { role?: 'gm' | 'player' } = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { tab, rest } = parseHelpHash(location.hash);
  const [filter, setFilter] = useState('');
  const [guideOpen, setGuideOpen] = useState(false);

  const visibleAppCount = APP_SECTIONS.filter((key) =>
    matchesFilter(t(`help.app.${key}.title` as MessageKey), t(`help.app.${key}.body` as MessageKey), filter),
  ).length;

  const visibleRuleCount = RULE_SECTIONS.filter((key) =>
    matchesFilter(t(`help.rules.${key}.title` as MessageKey), t(`help.rules.${key}.body` as MessageKey), filter),
  ).length;

  return (
    <section className="help">
      <h1>{t('help.title')}</h1>
      {role !== undefined ? (
        <button type="button" onClick={() => setGuideOpen(true)}>
          {t('help.quickGuide')}
        </button>
      ) : null}
      {guideOpen && role !== undefined ? <GuideDialog role={role} onClose={() => setGuideOpen(false)} /> : null}
      <div className="help-tabs">
        {TABS.map((id) => (
          <button key={id} type="button" aria-pressed={tab === id} onClick={() => navigate(`/help#${id}`)}>
            {t(`help.tab.${id}` as MessageKey)}
          </button>
        ))}
      </div>

      {tab !== 'compendium' && tab !== 'about' ? (
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
          {visibleAppCount === 0 ? <p className="muted">{t('help.noMatches')}</p> : null}
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

      {tab === 'rules' ? (
        <div className="help-sections">
          {visibleRuleCount === 0 ? <p className="muted">{t('help.noMatches')}</p> : null}
          {RULE_SECTIONS.map((key) => (
            <Section
              key={key}
              title={`help.rules.${key}.title` as MessageKey}
              body={`help.rules.${key}.body` as MessageKey}
              filter={filter}
            />
          ))}
          <p className="muted">{t('brand.compatibleShort')}</p>
        </div>
      ) : null}
      {tab === 'compendium' ? (
        <Compendium
          path={rest}
          onNavigate={(collection, id) => navigate(`/help#compendium/${collection}${id === null ? '' : `/${id}`}`)}
        />
      ) : null}
      {tab === 'about' ? <About /> : null}
    </section>
  );
}

/**
 * The licence notice the Darrington Press Community Gaming License asks for, kept
 * on a page of its own rather than in a footer nobody reads: the copyright line,
 * where the material came from, the licence itself, and the fact that the Spanish
 * data is this project's own translation of it.
 */
function About() {
  return (
    <div className="help-sections">
      <section className="panel about">
        <img
          className="about-logo"
          src="images/brand/daggerheart-compatible.svg"
          alt={t('brand.logoAlt')}
          width={320}
        />
        <p>{t('brand.notice')}</p>
        <ul>
          <li>
            <a href="https://www.daggerheart.com" target="_blank" rel="noreferrer noopener">
              daggerheart.com
            </a>
          </li>
          <li>
            <a href="https://www.darringtonpress.com/license/" target="_blank" rel="noreferrer noopener">
              {t('brand.licenseLink')}
            </a>
          </li>
        </ul>
        <p className="muted">{t('brand.modifications')}</p>
        <p className="muted">{t('brand.notAffiliated')}</p>
      </section>
    </div>
  );
}
