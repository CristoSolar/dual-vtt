import { t, type MessageKey } from '../../i18n/index.js';
import { outcomeTone, type RollEntry } from '../../state/rollLog.js';
import { SectionHead } from '../SectionHead.js';

interface RollLogPanelProps {
  entries: readonly RollEntry[];
}

/** The session's rolls, most recent first. */
export function RollLogPanel({ entries }: RollLogPanelProps) {
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
      <ul className="log">
        {entries.map((entry) => (
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
    </div>
  );
}
