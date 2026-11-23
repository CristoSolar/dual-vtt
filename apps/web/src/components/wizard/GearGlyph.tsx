import type { GearGlyph as Glyph } from '../../state/equipment.js';

/**
 * Monochrome line glyphs for weapon and armor cards that have no art yet. Same
 * grammar as `icons/Icon.tsx`: 24×24 viewBox, `currentColor` stroke, no fill —
 * the caller sizes and tints it. Each entry is an SVG path, or `c cx cy r` for a
 * circle.
 */
const PATHS: Record<Glyph, readonly string[]> = {
  sword: ['M20 4 19 8 9.5 17.5 6.5 14.5 16 5Z', 'M5 13 11 19', 'M7.5 16.5 4 20'],
  dagger: ['M19 5 18.4 8 12.5 13.9 10.1 11.5 16 5.6Z', 'M8.5 10.5 13.5 15.5', 'M10.5 13.5 5 19'],
  axe: ['M6 21 15.5 4', 'M13 7.5 19 3.5C21.5 6.5 21.5 10.5 19.5 13.5L14.5 10Z'],
  hammer: ['M5 20 13.5 11.5', 'M10.5 6.5 14.5 2.5 21.5 9.5 17.5 13.5Z'],
  polearm: ['M4 20 17 7', 'M17 7 21 3 20 8Z', 'M14 6.5C16 6 17.5 7.5 17 10L13.5 10.5'],
  bow: ['M6 3A15 15 0 0 1 21 18', 'M6 3 21 18', 'M3 21 15 9', 'M11 9H15V13'],
  crossbow: ['M12 4V21', 'M4 10C8 6.5 16 6.5 20 10', 'M4 10 12 14 20 10', 'M10 4H14'],
  staff: ['M5 21 15.5 8.5', 'c 17.5 6.5 2.5', 'M17.5 1V2.5', 'M22.5 6.5H21'],
  wand: ['M4 20 14 10', 'M17 3V6', 'M17 9V12', 'M12.5 7.5H15.5', 'M18.5 7.5H21.5'],
  shield: ['M12 3 20 6V12C20 17 16 20 12 21 8 20 4 17 4 12V6Z', 'M12 7V17', 'M8 11H16'],
  fist: [
    'M5 10.5A2.5 2.5 0 0 1 7.5 8H17A2.5 2.5 0 0 1 19.5 10.5V15A5 5 0 0 1 14.5 20H10A5 5 0 0 1 5 15Z',
    'M9.5 8V12',
    'M13 8V12',
    'M16.5 8V12',
    'M5 13H19.5',
  ],
  whip: ['M4 20 7 17', 'M7 17C10 14 8 10 12 9S20 11 20 5', 'M20 5 18.5 3.5'],
  rune: ['c 12 12 8.5', 'M12 7 15.5 12 12 17 8.5 12Z', 'M12 3.5V7', 'M12 17V20.5'],
  chakram: ['c 12 12 8.5', 'c 12 12 3', 'M12 1.5V3.5', 'M22.5 12H20.5', 'M12 22.5V20.5', 'M1.5 12H3.5'],
  firearm: ['M3 8H20V11.5H10L8.5 18H5L6.5 11.5H3Z', 'M10 11.5 11 14H13'],
  wheel: ['c 10.5 15 5.5', 'M8 3V10H16L19 16', 'M8 6H13'],
  cloak: ['M9 3H15L18 7 17 21H7L6 7Z', 'M9 3 12 8 15 3', 'M12 8V21'],
  robe: ['M9 3H15L17 8 19 21H5L7 8Z', 'M9 3 12 7 15 3', 'M7 13H17'],
  tunic: ['M8.5 3 4 6 6 10.5 8 9.5V21H16V9.5L18 10.5 20 6 15.5 3C14.5 5 13 5.5 12 5.5S9.5 5 8.5 3Z'],
  plate: [
    'M8.5 3 4 6 6 10.5 8 9.5V21H16V9.5L18 10.5 20 6 15.5 3C14.5 5 13 5.5 12 5.5S9.5 5 8.5 3Z',
    'M8 13H16',
    'M8 17H16',
    'M12 5.5V21',
  ],
};

export function GearGlyph({ glyph, className }: { glyph: Glyph; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[glyph].map((d) => {
        if (!d.startsWith('c ')) return <path key={d} d={d} />;
        const [cx, cy, r] = d.slice(2).split(' ');
        return <circle key={d} cx={cx} cy={cy} r={r} />;
      })}
    </svg>
  );
}
