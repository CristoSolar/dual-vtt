/**
 * The app's 16-icon linear set, straight from the "Dirección visual" spec's
 * §09: 24×24 viewBox, 1.5px stroke, right-angle joins, no fill except the
 * odd filled dot (door handle, dice pip). Every icon inherits `currentColor`
 * so one sprite covers rest/hover/active/disabled — the caller sets color.
 *
 * This replaces the map rail's emoji (🗺️ 🖼️ 🚪 📏), which the spec calls
 * out by name as "lo que más grita 'prototipo'": emoji carry their own
 * colour, perspective and rounded corners that no CSS token can retune.
 */
type ShapeSpec = readonly [kind: 'rect' | 'line' | 'circle' | 'polyline', args: string];

const ICONS = {
  map: [['rect', '3,5,18,14'], ['line', '9,5,9,19'], ['line', '15,5,15,19']],
  scene: [
    ['rect', '3,5,18,14'],
    ['polyline', '5,17 10,11 13,14 16,10 19,15'],
    ['circle', '8.5,9,1.4'],
  ],
  door: [['rect', '5,3,14,18'], ['circle', '15,12,1.1']],
  measure: [['line', '4,20,20,4'], ['line', '4,20,4,16'], ['line', '20,4,16,4']],
  select: [['polyline', '5,3 5,19 10,14 13,21 15,20 12,13 19,13 5,3']],
  move: [
    ['line', '12,3,12,21'],
    ['line', '3,12,21,12'],
    ['polyline', '9,6 12,3 15,6'],
    ['polyline', '9,18 12,21 15,18'],
    ['polyline', '6,9 3,12 6,15'],
    ['polyline', '18,9 21,12 18,15'],
  ],
  dice: [
    ['polyline', '12,2 20,7 20,17 12,22 4,17 4,7 12,2'],
    ['polyline', '7,9 12,15 17,9'],
    ['line', '12,15,12,22'],
  ],
  weapon: [
    ['line', '5,19,16,8'],
    ['line', '14,4,20,10'],
    ['line', '4,17,7,20'],
    ['line', '12,6,18,12'],
  ],
  shield: [['polyline', '12,3 19,6 19,12 12,21 5,12 5,6 12,3'], ['line', '12,3,12,21']],
  hp: [['rect', '4,4,16,16'], ['line', '12,8,12,16'], ['line', '8,12,16,12']],
  hope: [
    ['polyline', '12,3 21,12 12,21 3,12 12,3'],
    ['polyline', '12,8 16,12 12,16 8,12 12,8'],
  ],
  fear: [['polyline', '12,21 3,7 21,7 12,21'], ['line', '12,10,12,15'], ['circle', '12,17.6,0.9']],
  fog: [
    ['polyline', '3,10 8,7 13,10 18,7 21,10'],
    ['polyline', '3,15 8,12 13,15 18,12 21,15'],
    ['line', '3,20,21,20'],
  ],
  chat: [['rect', '3,4,18,13'], ['polyline', '8,17 8,21 13,17'], ['line', '7,9,17,9'], ['line', '7,13,13,13']],
  group: [
    ['circle', '9,8,3'],
    ['polyline', '3,20 3,17 9,14 15,17 15,20'],
    ['circle', '17,8,2.2'],
    ['polyline', '17,13 21,15 21,20'],
  ],
  settings: [
    ['circle', '12,12,3.2'],
    ['circle', '12,12,7.6'],
    ['line', '12,2,12,6'],
    ['line', '12,18,12,22'],
    ['line', '2,12,6,12'],
    ['line', '18,12,22,12'],
  ],
} satisfies Record<string, readonly ShapeSpec[]>;

export type IconName = keyof typeof ICONS;

function shape([kind, args]: ShapeSpec, key: number) {
  const props = { key, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 };
  if (kind === 'rect') {
    const [x, y, w, h] = args.split(',').map(Number);
    return <rect {...props} x={x} y={y} width={w} height={h} />;
  }
  if (kind === 'line') {
    const [x1, y1, x2, y2] = args.split(',').map(Number);
    return <line {...props} x1={x1} y1={y1} x2={x2} y2={y2} />;
  }
  if (kind === 'circle') {
    const [cx, cy, r] = args.split(',').map(Number);
    return <circle {...props} cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />;
  }
  return <polyline {...props} points={args} />;
}

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

/** Renders one of the 16 line icons at any size — the stroke stays 1.5px
 * regardless (the spec: "el trazo no escala"), so scale the box, not the line. */
export function Icon({ name, size = 24, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block' }}
    >
      {ICONS[name].map((spec, i) => shape(spec, i))}
    </svg>
  );
}
