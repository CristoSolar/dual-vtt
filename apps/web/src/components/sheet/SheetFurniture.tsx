/**
 * The sheet's "rulebook" furniture, straight from the design direction's §05:
 * shields, plaques and ribbons drawn as CSS geometry (`clip-path` + a double
 * edge + an inner highlight) rather than illustration. Shared by the full
 * sheet route and the map's compact floating window so both read as the same
 * document — the compact one just leaves parts out.
 */

interface LevelShieldProps {
  level: number;
}

/** A banner/shield plaque: the character's level, in the one place it belongs. */
export function LevelShield({ level }: LevelShieldProps) {
  return (
    <div className="level-shield">
      <span className="level-shield-value">{level}</span>
      <span className="level-shield-label">Nivel</span>
    </div>
  );
}

interface DefenseHexProps {
  value: number;
  label: string;
}

/** Evasion and Armor as hexagons — a defence is a shield, not a table cell. */
export function DefenseHex({ value, label }: DefenseHexProps) {
  return (
    <div className="defense-hex">
      <span className="defense-hex-value">{value}</span>
      <span className="defense-hex-label">{label}</span>
    </div>
  );
}

interface TraitPlaqueProps {
  label: string;
  modifier: number;
  uses: readonly string[];
  /** The trait currently rolled with: fill, edge and glow together, never a
   * 1px border on its own. */
  active?: boolean;
  onClick?: () => void;
}

const signed = (n: number) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

/** A trait plaque with its name on an overlapping chip and its three SRD uses. */
export function TraitPlaque({ label, modifier, uses, active = false, onClick }: TraitPlaqueProps) {
  const body = (
    <>
      <span className="trait-plaque-chip">{label}</span>
      <span className="trait-plaque-value">{signed(modifier)}</span>
    </>
  );

  return (
    <div className="trait-plaque-slot">
      {onClick === undefined ? (
        <div className="trait-plaque" data-active={active}>
          {body}
        </div>
      ) : (
        <button
          type="button"
          className="trait-plaque"
          data-active={active}
          aria-label={`Tirada de ${label} ${signed(modifier)}`}
          onClick={onClick}
        >
          {body}
        </button>
      )}
      <span className="trait-plaque-uses">
        {uses.map((use) => (
          <span key={use}>{use}</span>
        ))}
      </span>
    </div>
  );
}

interface ThresholdRibbonProps {
  major: number;
  severe: number;
  /** Opens the damage dialog — the ribbon is the natural place to start from,
   * since you're already reading the numbers you'd compare against. */
  onCalculate?: () => void;
}

/**
 * The damage-threshold ribbon: three bands with the two threshold numbers
 * riding the boundaries between them, so "which band does 9 fall in" is a
 * glance rather than arithmetic.
 */
export function ThresholdRibbon({ major, severe, onCalculate }: ThresholdRibbonProps) {
  return (
    <div className="threshold-ribbon">
      <div className="threshold-ribbon-head">
        {onCalculate === undefined ? null : (
          <button type="button" className="threshold-calc" onClick={onCalculate}>
            Calcular
            <br />
            daño
          </button>
        )}
        <span className="threshold-ribbon-title">Umbrales de daño</span>
      </div>
      <div className="threshold-bands">
        <div className="threshold-band minor">
          <span className="threshold-band-label">Menor</span>
          <span className="threshold-band-note">marca 1 PV</span>
        </div>
        <div className="threshold-band major">
          <span className="threshold-band-label">Mayor</span>
          <span className="threshold-band-note">marca 2 PV</span>
        </div>
        <div className="threshold-band severe">
          <span className="threshold-band-label">Severo</span>
          <span className="threshold-band-note">marca 3 PV</span>
        </div>
        <span className="threshold-badge at-major">{major}</span>
        <span className="threshold-badge at-severe">{severe}</span>
      </div>
    </div>
  );
}

interface SegmentTrackerProps {
  label: string;
  marked: number;
  total: number;
  tone: 'hp' | 'stress';
  /** Filled segments read as "spent" — the wording differs per resource. */
  fillLabel: string;
  onMark: () => void;
  onClear: () => void;
  note?: string | undefined;
}

/**
 * HP and Stress: a coloured label bar over a row of segments, flanked by −/+.
 * Clicking an empty segment marks one, clicking a filled one clears one.
 */
export function SegmentTracker({
  label,
  marked,
  total,
  tone,
  fillLabel,
  onMark,
  onClear,
  note,
}: SegmentTrackerProps) {
  return (
    <div className="segment-tracker" data-tone={tone}>
      <div className="segment-tracker-head">
        <h3>{label}</h3>
        <span className="segment-tracker-count">
          {marked}/{total} {fillLabel}
          {note === undefined ? null : <span className="badge warn">{note}</span>}
        </span>
      </div>
      <div className="segment-tracker-row">
        <button
          type="button"
          className="round-step"
          aria-label={`Quitar 1 de ${label}`}
          disabled={marked === 0}
          onClick={onClear}
        >
          −
        </button>
        <div className="segment-tracker-bars">
          {Array.from({ length: total }, (_, index) => {
            const filled = index < marked;
            const description = `${label} ${index + 1} de ${total}${filled ? ` (${fillLabel})` : ''}`;
            return (
              <button
                key={index}
                type="button"
                className="segment"
                data-filled={filled}
                aria-pressed={filled}
                aria-label={description}
                title={description}
                onClick={filled ? onClear : onMark}
              />
            );
          })}
        </div>
        <button
          type="button"
          className="round-step accent"
          aria-label={`Sumar 1 a ${label}`}
          disabled={marked === total}
          onClick={onMark}
        >
          +
        </button>
      </div>
      {total === 0 ? <p className="muted">No hay disponibles.</p> : null}
    </div>
  );
}

interface PipRowProps {
  label: string;
  marked: number;
  total: number;
  fillLabel: string;
  onMark: () => void;
  onClear: () => void;
}

/** Hope: gold diamonds — the player's currency, shaped unlike any other track. */
export function HopeRow({ label, marked, total, fillLabel, onMark, onClear }: PipRowProps) {
  return (
    <div className="hope-row">
      <h3>{label}</h3>
      <div className="hope-pips">
        {Array.from({ length: total }, (_, index) => {
          const filled = index < marked;
          const description = `${label} ${index + 1} de ${total}${filled ? ` (${fillLabel})` : ''}`;
          return (
            <button
              key={index}
              type="button"
              className="hope-pip"
              data-filled={filled}
              aria-pressed={filled}
              aria-label={description}
              title={description}
              onClick={filled ? onClear : onMark}
            />
          );
        })}
      </div>
      <span className="segment-tracker-count">
        {marked}/{total}
      </span>
    </div>
  );
}

/** Armor slots: violet hexagons, flanked by −/+ — armour is neither a
 * moment-to-moment resource nor the GM's pool, so it gets its own colour. */
export function ArmorSlots({ label, marked, total, fillLabel, onMark, onClear }: PipRowProps) {
  return (
    <div className="armor-slots">
      <div className="armor-slots-head">
        <h3>{label}</h3>
        <span className="segment-tracker-count">
          {marked}/{total}
        </span>
      </div>
      <div className="armor-slots-row">
        <button
          type="button"
          className="round-step"
          aria-label={`Quitar 1 de ${label}`}
          disabled={marked === 0}
          onClick={onClear}
        >
          −
        </button>
        {Array.from({ length: total }, (_, index) => {
          const filled = index < marked;
          const description = `${label} ${index + 1} de ${total}${filled ? ` (${fillLabel})` : ''}`;
          return (
            <button
              key={index}
              type="button"
              className="armor-pip"
              data-filled={filled}
              aria-pressed={filled}
              aria-label={description}
              title={description}
              onClick={filled ? onClear : onMark}
            />
          );
        })}
        <button
          type="button"
          className="round-step violet"
          aria-label={`Sumar 1 a ${label}`}
          disabled={marked === total}
          onClick={onMark}
        >
          +
        </button>
      </div>
      {total === 0 ? <p className="muted">Sin armadura equipada.</p> : null}
    </div>
  );
}

/** The four 16px corner brackets that frame every "document" surface. */
export function CornerBrackets() {
  return (
    <span className="corner-brackets" aria-hidden="true">
      <span className="corner-bracket tl" />
      <span className="corner-bracket tr" />
      <span className="corner-bracket bl" />
      <span className="corner-bracket br" />
    </span>
  );
}
