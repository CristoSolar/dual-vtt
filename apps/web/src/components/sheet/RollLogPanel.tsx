import { OUTCOME_LABELS, outcomeTone, type RollEntry } from '../../state/rollLog.js';
import { SectionHead } from '../SectionHead.js';

interface RollLogPanelProps {
  entries: readonly RollEntry[];
}

/** The session's rolls, most recent first. */
export function RollLogPanel({ entries }: RollLogPanelProps) {
  if (entries.length === 0) {
    return (
      <div className="panel">
        <SectionHead>Roll log</SectionHead>
        <p className="muted">No rolls yet this session.</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <SectionHead>Roll log</SectionHead>
      <ul className="log">
        {entries.map((entry) => (
          <li key={entry.id}>
            {entry.kind === 'duality' ? (
              <>
                <div className="row spread">
                  <strong>{entry.label}</strong>
                  <span className="outcome" data-tone={outcomeTone(entry.outcome)}>
                    {OUTCOME_LABELS[entry.outcome]}
                  </span>
                </div>
                <span className="muted">
                  Hope {entry.roll.hope} · Fear {entry.roll.fear} · total {entry.roll.total} vs{' '}
                  {entry.difficulty}
                  {entry.experiences.length > 0 ? ` · ${entry.experiences.join(', ')}` : ''}
                </span>
              </>
            ) : (
              <>
                <div className="row spread">
                  <strong>{entry.label}</strong>
                  <span>{entry.roll.total} damage</span>
                </div>
                <span className="muted">
                  Dice {entry.roll.rolls.join(', ')}
                  {entry.roll.modifier !== 0 ? ` · modifier ${entry.roll.modifier}` : ''}
                  {entry.critical ? ` · critical +${entry.roll.criticalBonus}` : ''}
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
