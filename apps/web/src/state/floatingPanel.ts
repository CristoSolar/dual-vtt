/** A floating panel's on-screen position and stacking order. */
export interface PanelLayout {
  x: number;
  y: number;
  z: number;
}

/**
 * Keeps a dragged panel's header on-screen even if the panel body runs off
 * the viewport — you can always grab it back. Only the top-left corner
 * (where the header lives) is clamped; width/height are left to the caller.
 */
export function clampPanelPosition(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
  margin = 24,
): { x: number; y: number } {
  return {
    x: Math.min(Math.max(x, 0), Math.max(0, viewportWidth - margin)),
    y: Math.min(Math.max(y, 0), Math.max(0, viewportHeight - margin)),
  };
}
