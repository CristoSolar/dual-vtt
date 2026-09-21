import { useMemo, useState } from 'react';

import { t, type MessageKey } from '../../i18n/index.js';
import { outcomeTone, type RollEntry } from '../../state/rollLog.js';
import { SectionHead } from '../SectionHead.js';

interface RollLogPanelProps {
  entries: readonly RollEntry[];
}

/** What a filter narrows the log to. */
type LogFilter = 'all' | 'duality' | 'attack' | 'damage' | 'fate';

/**
 * The session's rolls, most recent first.
 *
 * A long fight fills this with damage rolls, and the one action roll somebody
 * wants to look back at scrolls away, so the kinds can be narrowed and the whole
 * thing collapsed when the table is doing something else.
 */
export function RollLogPanel({ entries }: RollLogPanelProps) {
  const [filter, setFilter] = useState<LogFilter>('all');
  const [collapsed, setCollapsed] = useState(false);

  const shown = useMemo(
    () => (filter === 'all' ? entries : entries.filter((entry) => entry.kind === filter)),
    [entries, filter],
  );

  if (entries.length === 0) {
    return (
      <div className="panel">
        <SectionHead>{t('sheet.log.title')}</SectionHead>
        <p className="muted">{t('sheet.log.empty')}</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <SectionHead>{t('sheet.log.title')}</SectionHead>
      <div className="row">
        <label className="sr-only" htmlFor="log-filter">
          {t('sheet.log.filterLabel')}
        </label>
        <select
          id="log-filter"
          value={filter}
          onChange={(event) => setFilter(event.target.value as LogFilter)}
        >
          {(['all', 'duality', 'attack', 'damage', 'fate'] as const).map((kind) => (
            <option key={kind} value={kind}>
              {t(`sheet.log.filter.${kind}` as MessageKey)}
            </option>
          ))}
        </select>
        <button type="button" aria-expanded={!collapsed} onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? t('sheet.log.expand') : t('sheet.log.collapse')}
        </button>
      </div>
      {collapsed ? null : shown.length === 0 ? (
        <p className="muted">{t('sheet.log.noneOfThatKind')}</p>
      ) : (
      <ul className="log">
        {shown.map((entry) => (
          <li key={entry.id}>
            {entry.kind === 'duality' ? (
              <>
                <div className="row spread">
                  <strong>{entry.label}</strong>
                  <span className="outcome" data-tone={outcomeTone(entry.outcome)}>
                    {t(`roll.outcome.${entry.outcome}` as MessageKey)}
                  </span>
                </div>
                <span className="muted">
                  {t('sheet.log.dualityMeta', { hope: entry.roll.hope, fear: entry.roll.fear })}
                  {entry.roll.modifiers !== 0
                    ? t('sheet.log.modifier', { mod: entry.roll.modifiers })
                    : ''}
                  {t('sheet.log.totalVs', { total: entry.roll.total, difficulty: entry.difficulty })}
                  {entry.experiences.length > 0 ? ` · ${entry.experiences.join(', ')}` : ''}
                </span>
              </>
            ) : entry.kind === 'attack' ? (
              <>
                <div className="row spread">
                  <strong>
                    {entry.by} · {entry.label}
                  </strong>
                  <span
                    className="outcome"
                    data-tone={
                      entry.roll.critical
                        ? 'critical'
                        : entry.roll.success === null
                          ? undefined
                          : entry.roll.success
                            ? 'success'
                            : 'failure'
                    }
                  >
                    {entry.roll.critical
                      ? t('sheet.log.attackCritical')
                      : entry.roll.success === null
                        ? t('sheet.log.attackTotal', { total: entry.roll.total })
                        : t(entry.roll.success ? 'sheet.log.attackHit' : 'sheet.log.attackMiss')}
                  </span>
                </div>
                <span className="muted">
                  {t('sheet.log.attackDice', { dice: entry.roll.dice.join(', ') })}
                  {entry.roll.modifier !== 0
                    ? t('sheet.log.modifier', { mod: entry.roll.modifier })
                    : ''}
                  {entry.roll.experience !== 0
                    ? t('sheet.log.modifier', { mod: entry.roll.experience })
                    : ''}
                  {entry.evasion === null
                    ? t('sheet.log.attackNoTarget', { total: entry.roll.total })
                    : t('sheet.log.attackVs', {
                        total: entry.roll.total,
                        evasion: entry.evasion,
                        target: entry.target ?? '',
                      })}
                </span>
              </>
            ) : entry.kind === 'fate' ? (
              <div className="row spread">
                <strong>{entry.label}</strong>
                <span>{entry.value}</span>
              </div>
            ) : (
              <>
                <div className="row spread">
                  <strong>{entry.label}</strong>
                  <span>{t('sheet.log.damageTotal', { total: entry.roll.total })}</span>
                </div>
                <span className="muted">
                  {t('sheet.log.dice', { rolls: entry.roll.rolls.join(', ') })}
                  {entry.roll.modifier !== 0
                    ? t('sheet.log.modifier', { mod: entry.roll.modifier })
                    : ''}
                  {entry.critical
                    ? t('sheet.log.criticalBonus', { bonus: entry.roll.criticalBonus })
                    : ''}
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      )}
    </div>
  );
}
