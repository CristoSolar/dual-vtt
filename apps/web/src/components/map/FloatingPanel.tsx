import { useRef, type ReactNode } from 'react';

import { clampPanelPosition, type PanelLayout } from '../../state/floatingPanel.js';

interface FloatingPanelProps {
  title: string;
  layout: PanelLayout;
  onLayoutChange: (layout: PanelLayout) => void;
  onFocus: () => void;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A Foundry-style floating window: drag the header to move it, close to
 * hide it. Position lives in the caller's state (usually per-scene, saved
 * to localStorage) — this component only reports gestures.
 */
export function FloatingPanel({
  title,
  layout,
  onLayoutChange,
  onFocus,
  onClose,
  children,
}: FloatingPanelProps) {
  const drag = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(
    null,
  );

  const onHeaderPointerDown = (event: React.PointerEvent) => {
    onFocus();
    drag.current = { startX: event.clientX, startY: event.clientY, originX: layout.x, originY: layout.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onHeaderPointerMove = (event: React.PointerEvent) => {
    if (drag.current === null) return;
    const { startX, startY, originX, originY } = drag.current;
    const { x, y } = clampPanelPosition(
      originX + (event.clientX - startX),
      originY + (event.clientY - startY),
      window.innerWidth,
      window.innerHeight,
    );
    onLayoutChange({ ...layout, x, y });
  };

  const onHeaderPointerUp = () => {
    drag.current = null;
  };

  return (
    <div
      className="floating-panel"
      style={{ left: layout.x, top: layout.y, zIndex: layout.z }}
      onPointerDownCapture={onFocus}
    >
      <div
        className="floating-panel-header"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
      >
        <span>{title}</span>
        <button
          type="button"
          className="floating-panel-close"
          // The header above captures the pointer on pointerdown to drag the panel;
          // without stopping it here, that capture retargets this button's pointerup
          // to the header instead, so the browser never synthesizes a click on it.
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onClose}
          aria-label={`Cerrar ${title}`}
        >
          ×
        </button>
      </div>
      <div className="floating-panel-body">{children}</div>
    </div>
  );
}
