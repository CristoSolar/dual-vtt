interface TrackerProps {
  label: string;
  marked: number;
  total: number;
  /** Rendering hook only: changes the pip colour. */
  tone?: 'default' | 'hope' | 'armor';
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
        {pips.map((filled, index) => (
          <li key={index}>
            <button
              type="button"
              className={`pip ${tone === 'default' ? '' : tone}`}
              data-filled={filled}
              aria-pressed={filled}
              aria-label={`${label} ${index + 1} of ${total}${filled ? ` (${fillLabel})` : ''}`}
              onClick={filled ? onClear : onMark}
            >
              {index + 1}
            </button>
          </li>
        ))}
      </ul>
      {total === 0 ? <p className="muted">None available.</p> : null}
    </div>
  );
}
