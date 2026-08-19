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
        <SectionHead>Registro de tiradas</SectionHead>
        <p className="muted">Todavía no hay tiradas en esta sesión.</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <SectionHead>Registro de tiradas</SectionHead>
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
                  Esperanza {entry.roll.hope} · Miedo {entry.roll.fear}
                  {entry.roll.modifiers !== 0 ? ` · modificador ${entry.roll.modifiers}` : ''} · total{' '}
                  {entry.roll.total} vs {entry.difficulty}
                  {entry.experiences.length > 0 ? ` · ${entry.experiences.join(', ')}` : ''}
                </span>
              </>
            ) : (
              <>
                <div className="row spread">
                  <strong>{entry.label}</strong>
                  <span>{entry.roll.total} de daño</span>
                </div>
                <span className="muted">
                  Dados {entry.roll.rolls.join(', ')}
                  {entry.roll.modifier !== 0 ? ` · modificador ${entry.roll.modifier}` : ''}
                  {entry.critical ? ` · crítico +${entry.roll.criticalBonus}` : ''}
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
