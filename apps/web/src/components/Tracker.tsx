interface TrackerProps {
  label: string;
  marked: number;
  total: number;
  /** Rendering hook only: each tone gets its own colour and shape, so a
   * resource reads at a glance without needing its label — HP and Stress
   * are bars (red/orange), Hope a diamond, Armor a hexagon. */
  tone?: 'default' | 'stress' | 'hope' | 'armor';
  /** Filled pips read as "spent" for HP/Stress, "held" for Hope. */
  fillLabel: string;
  onMark: () => void;
  onClear: () => void;
  note?: string | undefined;
}

/**
 * A row of clickable pips. Clicking an unfilled pip marks one; clicking a filled one
 * clears one. The component owns no arithmetic — it reports intent and renders counts.
 */
export function Tracker({
  label,
  marked,
  total,
  tone = 'default',
  fillLabel,
  onMark,
  onClear,
  note,
}: TrackerProps) {
  const pips = Array.from({ length: total }, (_, i) => i < marked);

  return (
    <div className="tracker">
      <div className="tracker-head">
        <h3>{label}</h3>
        <span className="muted">
          {marked} / {total} {note ? <span className="badge warn">{note}</span> : null}
        </span>
      </div>
      <ul className="pips">
        {pips.map((filled, index) => {
          const description = `${label} ${index + 1} de ${total}${filled ? ` (${fillLabel})` : ''}`;
          return (
            <li key={index}>
              <button
                type="button"
                className={`pip ${tone === 'default' ? '' : tone}`}
                data-filled={filled}
                aria-pressed={filled}
                aria-label={description}
                title={description}
                onClick={filled ? onClear : onMark}
              />
            </li>
          );
        })}
      </ul>
      {total === 0 ? <p className="muted">No hay disponibles.</p> : null}
    </div>
  );
}
