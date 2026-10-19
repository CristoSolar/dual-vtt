import {
  measure,
  ringRadii,
  type Fog,
  type Grid,
  type RangeScale,
  type Scene,
  type Token,
} from '@daggerheart/protocol';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text } from 'react-konva';
import type Konva from 'konva';

import { t, type MessageKey } from '../../i18n/index.js';
import { DragThrottle } from '../../state/dragCommit.js';
import { snapToGrid } from '../../state/gridSnap.js';
import { PING_DURATION_MS } from '../../state/useCampaign.js';
import { canvasPalette, rangeRingColor } from '../../styles/canvasTokens.js';
import { FogGl } from './FogGl.js';

/** A journal note as the canvas draws it: where, and what it opens. */
export interface MapPin {
  id: string;
  x: number;
  y: number;
  journalId: string;
  title: string;
}

export interface MapCanvasProps {
  scene: Scene;
  /** Viewer's role: the GM sees fog at reduced opacity, players not at all. */
  isGameMaster: boolean;
  /** Session id of the viewer, used to decide which tokens they may drag. */
  viewerId: string | null;
  /** The account the spotlight is on, so their token can wear a ring. */
  spotlightId?: string | null;
  width: number;
  height: number;
  selectedTokenId: string | null;
  onSelectToken: (tokenId: string | null) => void;
  onMoveToken: (tokenId: string, x: number, y: number, commit: boolean) => void;
  /** Set while the GM is painting fog; a drag then paints instead of panning. */
  fogBrush: { radius: number; reveal: boolean } | null;
  onPaintFog: (x: number, y: number) => void;
  /** Set while the GM is outlining fog with the pen: clicks drop corners and the
   * closed shape is revealed or hidden in one go. Mutually exclusive with the
   * brush, which the panel enforces. */
  fogPen: { reveal: boolean } | null;
  onFillFog: (points: readonly { x: number; y: number }[]) => void;
  measuring: boolean;
  /** Whether a dropped token lands on the grid. Off puts it exactly where it fell. */
  snapping?: boolean;
  /** Set while the GM is placing walls. Clicks chain corner to corner, like the
   * fog pen; each leg is its own wall, so one can be deleted without the rest. */
  drawingWall: boolean;
  onAddWall: (x1: number, y1: number, x2: number, y2: number) => void;
  /** Clicking a door on the map opens or closes it. GM only. */
  onToggleDoor: (wallId: string) => void;
  /** Reports the current pan/zoom, so the caller can anchor an HTML overlay
   * (e.g. a token popover) to a scene-space point in screen coordinates. */
  onViewChange?: (view: { x: number; y: number; scale: number }) => void;
  /** Health per token id, for the 4px bar under a token's name chip. Only
   * tokens the caller has real numbers for get one — no bar is drawn for a
   * token whose HP nobody tracks. */
  health?: Readonly<Record<string, { marked: number; total: number }>>;
  /** Per token id, the colour of each account targeting it; each gets a dashed ring. */
  targetRings?: Readonly<Record<string, readonly string[]>>;
  /** Pings on this scene, each already in its sender's colour. */
  pings?: readonly { id: number; x: number; y: number; color: string }[];
  /** Alt+click, or a long press on touch, pings a point. Absent means no pinging. */
  onPing?: (x: number, y: number) => void;
  /** Journal pins on this scene, each with its entry's title. */
  notes?: readonly MapPin[];
  /** Clicking a pin opens its journal entry. */
  onOpenNote?: (journalId: string) => void;
  /** Filled in by the canvas with a one-step zoom, so the HUD's zoom control
   * (an HTML overlay, outside the Konva tree) can drive it. */
  /**
   * An imperative handle for the view, so the toolbar and the keyboard can drive
   * the camera without lifting pan and zoom out of the canvas.
   */
  zoomApi?: {
    current: {
      zoom: (direction: 1 | -1) => void;
      /** Fits the whole scene, or the grid's extent when there is no image. */
      fit: () => void;
      /** Centres the view on a point in scene coordinates, keeping the zoom. */
      centreOn: (point: { x: number; y: number }) => void;
    } | null;
  };
}

/** Scene grid settings translated into the scale the range module expects. */
export function scaleFor(grid: Grid): RangeScale {
  return { mode: grid.mode, pixelsPerSquare: grid.size, feetPerInch: grid.feetPerInch };
}

/** How long a finger has to rest before it pings, and how far it may drift. */
const LONG_PRESS_MS = 600;
const LONG_PRESS_SLOP = 10;

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;

/**
 * The tactical map. This component draws and reports gestures; it works out no
 * distances or bands itself — `measure` and `ringRadii` come from the protocol
 * package, which is where those rules are tested.
 */
export function MapCanvas({
  scene,
  isGameMaster,
  viewerId,
  spotlightId = null,
  width,
  height,
  selectedTokenId,
  onSelectToken,
  onMoveToken,
  fogBrush,
  onPaintFog,
  fogPen,
  onFillFog,
  measuring,
  snapping = true,
  drawingWall,
  onAddWall,
  onToggleDoor,
  onViewChange,
  health,
  targetRings,
  pings = NO_PINGS,
  onPing,
  notes = NO_PINS,
  onOpenNote,
  zoomApi,
}: MapCanvasProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  useEffect(() => onViewChange?.(view), [view, onViewChange]);
  /**
   * Fog runs on the GPU unless this browser has no WebGL2, in which case the
   * Konva cover below takes over. It has to fail closed: the map image is
   * already on the client, and fog is the only thing keeping it hidden.
   */
  const [fogOnGpu, setFogOnGpu] = useState(true);
  const fogUnavailable = useCallback(() => setFogOnGpu(false), []);

  const [measureLine, setMeasureLine] = useState<{
    from: { x: number; y: number };
    to: { x: number; y: number };
  } | null>(null);
  /**
   * The pen's corners so far, shared by the fog pen and the wall chain — the two
   * differ only in what happens when the shape is finished. The cursor is tracked
   * separately so the leg being aimed can be drawn before it is committed.
   */
  const [penPoints, setPenPoints] = useState<readonly { x: number; y: number }[]>([]);
  const [penCursor, setPenCursor] = useState<{ x: number; y: number } | null>(null);

  // One throttle per drag; a ref so re-renders don't reset it mid-gesture.
  const throttle = useRef(new DragThrottle());

  const scale = useMemo(() => scaleFor(scene.grid), [scene.grid]);

  useEffect(() => {
    const url = scene.image?.url;
    if (url === undefined) {
      setImage(null);
      return;
    }
    const element = new window.Image();
    element.src = url.startsWith('http') ? url : `${MAP_ORIGIN}${url}`;
    element.onload = () => setImage(element);
    return () => {
      element.onload = null;
    };
  }, [scene.image?.url]);

  /** Converts a pointer position on the stage into scene coordinates. */
  const toScene = useCallback((point: { x: number; y: number }) => {
    return { x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale };
  }, [view]);

  /** Zooms one step about a fixed stage point, which stays put on screen. */
  const zoomAbout = useCallback((pointer: { x: number; y: number }, direction: 1 | -1) => {
    setView((current) => {
      const next = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, current.scale * (direction > 0 ? 1.1 : 1 / 1.1)),
      );
      const scenePoint = {
        x: (pointer.x - current.x) / current.scale,
        y: (pointer.y - current.y) / current.scale,
      };
      return { scale: next, x: pointer.x - scenePoint.x * next, y: pointer.y - scenePoint.y * next };
    });
  }, []);

  // The HUD's zoom control lives outside the canvas (it's an HTML overlay), so
  // hand it a way in: zooming about the viewport centre, the way a button
  // should, rather than about a pointer it doesn't have.
  useEffect(() => {
    if (zoomApi === undefined) return;
    zoomApi.current = {
      zoom: (direction) => zoomAbout({ x: width / 2, y: height / 2 }, direction),
      fit: () => {
        const sceneWidth = scene.image?.width ?? width;
        const sceneHeight = scene.image?.height ?? height;
        if (sceneWidth <= 0 || sceneHeight <= 0) return;
        const next = Math.min(
          MAX_ZOOM,
          Math.max(MIN_ZOOM, Math.min(width / sceneWidth, height / sceneHeight)),
        );
        setView({
          scale: next,
          x: (width - sceneWidth * next) / 2,
          y: (height - sceneHeight * next) / 2,
        });
      },
      centreOn: (point) =>
        setView((current) => ({
          ...current,
          x: width / 2 - point.x * current.scale,
          y: height / 2 - point.y * current.scale,
        })),
    };
    return () => {
      zoomApi.current = null;
    };
  }, [zoomApi, zoomAbout, width, height, scene.image?.width, scene.image?.height]);

  const onWheel = (event: Konva.KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault();
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!stage || !pointer) return;
    zoomAbout(pointer, event.evt.deltaY > 0 ? -1 : 1);
  };

  const painting = fogBrush !== null && isGameMaster;
  /** True between pointer-down and pointer-up while the fog brush is active. */
  const paintingStroke = useRef(false);

  const penning = isGameMaster && (fogPen !== null || drawingWall);
  /** How close to the first corner a click counts as "close the shape", in scene
   * pixels at the current zoom — so it stays the same size on screen. */
  const closeRadius = 10 / view.scale;

  const cancelPen = useCallback(() => {
    setPenPoints([]);
    setPenCursor(null);
  }, []);

  /** Commits what the pen has drawn: a filled shape for fog, a run of segments
   * for walls. Fewer than the minimum corners is a stray click, so it is dropped. */
  const finishPen = useCallback(
    (points: readonly { x: number; y: number }[]) => {
      if (fogPen !== null) {
        if (points.length >= 3) onFillFog(points);
      } else {
        for (let i = 1; i < points.length; i++) {
          const from = points[i - 1];
          const to = points[i];
          if (from === undefined || to === undefined) continue;
          onAddWall(from.x, from.y, to.x, to.y);
        }
      }
      cancelPen();
    },
    [fogPen, onFillFog, onAddWall, cancelPen],
  );

  // Enter finishes what the pen has drawn, Escape throws it away. Both are what
  // a drawing tool does everywhere else, and the canvas has no focusable node to
  // hang them on, so they are read from the window while the pen is out.
  useEffect(() => {
    if (!penning) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelPen();
      if (event.key === 'Enter') finishPen(penPoints);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [penning, penPoints, cancelPen, finishPen]);

  // Putting the pen away mid-shape drops the draft rather than leaving it to
  // reappear on top of the next one.
  useEffect(() => {
    if (!penning) cancelPen();
  }, [penning, cancelPen]);

  /**
   * True from the pointer-down that pinged until the next pointer-down, so the
   * click that follows it (selecting a token, opening a door) is swallowed: a ping
   * points at something, it does not act on it.
   */
  const pingGesture = useRef(false);
  const longPress = useRef<{ at: { x: number; y: number }; timer: number } | null>(null);
  const cancelLongPress = useCallback(() => {
    if (longPress.current !== null) window.clearTimeout(longPress.current.timer);
    longPress.current = null;
  }, []);
  useEffect(() => cancelLongPress, [cancelLongPress]);

  /** Read once: the system setting rarely changes mid-session. */
  const reducedMotion = useMemo(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    [],
  );

  const onStagePointerDown = (event: Konva.KonvaEventObject<PointerEvent>) => {
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    const point = toScene(pointer);
    pingGesture.current = false;
    cancelLongPress();

    // Alt+click pings whatever tool is out, and does nothing else.
    if (event.evt.altKey && onPing !== undefined) {
      pingGesture.current = true;
      onPing(point.x, point.y);
      return;
    }

    if (painting) {
      paintingStroke.current = true;
      onPaintFog(point.x, point.y);
      return;
    }
    if (penning) {
      const first = penPoints[0];
      // Clicking the first corner again closes the shape, the way a pen tool does.
      if (first !== undefined && penPoints.length >= 2 && Math.hypot(first.x - point.x, first.y - point.y) <= closeRadius) {
        finishPen(fogPen !== null ? penPoints : [...penPoints, first]);
        return;
      }
      setPenPoints([...penPoints, point]);
      setPenCursor(point);
      return;
    }
    if (measuring) {
      setMeasureLine({ from: point, to: point });
      return;
    }
    // Touch has no Alt: a finger held still pings instead. Only with no tool out,
    // where a press would otherwise just pan or select.
    if (onPing !== undefined && event.evt.pointerType === 'touch') {
      longPress.current = {
        at: pointer,
        timer: window.setTimeout(() => {
          longPress.current = null;
          pingGesture.current = true;
          onPing(point.x, point.y);
        }, LONG_PRESS_MS),
      };
    }
    // A click on empty canvas clears the selection.
    if (event.target === stage) onSelectToken(null);
  };

  const onStagePointerMove = () => {
    const pointer = stageRef.current?.getPointerPosition();
    if (!pointer) return;
    const point = toScene(pointer);
    const press = longPress.current;
    if (press !== null && Math.hypot(pointer.x - press.at.x, pointer.y - press.at.y) > LONG_PRESS_SLOP) {
      cancelLongPress();
    }

    // Dragging the brush paints a stroke. The old guard asked the stage whether it
    // was dragging, but the stage is not draggable while painting, so it always
    // answered no and every move was discarded — one dab per click.
    if (painting && paintingStroke.current) {
      onPaintFog(point.x, point.y);
      return;
    }
    if (measureLine !== null) setMeasureLine({ ...measureLine, to: point });
    if (penning && penPoints.length > 0) setPenCursor(point);
  };

  /**
   * Pinch to zoom. Two fingers zoom about the point between them, which is what a
   * phone does everywhere else; one finger keeps panning through the stage's own
   * drag. Konva reports the raw touches, so the gesture is tracked here.
   */
  const pinch = useRef<{ distance: number; scale: number } | null>(null);

  const onTouchMove = (event: Konva.KonvaEventObject<TouchEvent>) => {
    const touches = event.evt.touches;
    const first = touches[0];
    const second = touches[1];
    if (first === undefined || second === undefined) {
      pinch.current = null;
      return;
    }
    cancelLongPress();

    event.evt.preventDefault();
    const stage = stageRef.current;
    if (stage === null) return;
    const box = stage.container().getBoundingClientRect();
    const centre = {
      x: (first.clientX + second.clientX) / 2 - box.left,
      y: (first.clientY + second.clientY) / 2 - box.top,
    };
    const distance = Math.hypot(
      first.clientX - second.clientX,
      first.clientY - second.clientY,
    );

    if (pinch.current === null) {
      pinch.current = { distance, scale: view.scale };
      return;
    }
    if (pinch.current.distance === 0) return;

    const next = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, (pinch.current.scale * distance) / pinch.current.distance),
    );
    setView((current) => {
      const scenePoint = {
        x: (centre.x - current.x) / current.scale,
        y: (centre.y - current.y) / current.scale,
      };
      return { scale: next, x: centre.x - scenePoint.x * next, y: centre.y - scenePoint.y * next };
    });
  };

  const canDrag = (token: Token): boolean =>
    isGameMaster || (viewerId !== null && token.ownerId === viewerId);

  /**
   * Live vision, for the lighting pass. Only in a scene that computes vision:
   * in a hand-painted one the GM's brush is the whole truth and dimming would
   * only argue with it. A token's pool is centred on the token, not its corner.
   */
  const lights = useMemo(
    () =>
      scene.visionMode === 'auto'
        ? scene.tokens
            .filter((token) => token.kind === 'pc' && token.visionRadius > 0 && !token.hidden)
            .map((token) => ({
              x: token.x + token.width / 2,
              y: token.y + token.height / 2,
              radius: token.visionRadius,
            }))
        : [],
    [scene.visionMode, scene.tokens],
  );

  const measurement = measureLine === null ? null : measure(measureLine.from, measureLine.to, scale);
  const selected = scene.tokens.find((token) => token.id === selectedTokenId) ?? null;

  return (
    <>
    <Stage
      ref={stageRef}
      width={width}
      height={height}
      x={view.x}
      y={view.y}
      scaleX={view.scale}
      scaleY={view.scale}
      draggable={!painting && !measuring && !penning}
      onWheel={onWheel}
      onTouchMove={onTouchMove}
      onTouchEnd={() => {
        pinch.current = null;
      }}
      onPointerDown={onStagePointerDown}
      onPointerMove={onStagePointerMove}
      onPointerUp={() => {
        cancelLongPress();
        paintingStroke.current = false;
        setMeasureLine(null);
      }}
      onDblClick={() => {
        // The other way to finish, for people who never look for a keyboard.
        if (penning && !pingGesture.current) finishPen(penPoints);
      }}
      onDragMove={(event) => {
        // Reported during the pan, not only at its end: a popover positioned from
        // `view` was frozen in place until the drag finished.
        if (event.target === stageRef.current) {
          setView((current) => ({ ...current, x: event.target.x(), y: event.target.y() }));
        }
      }}
      onDragEnd={(event) => {
        if (event.target === stageRef.current) {
          setView((current) => ({ ...current, x: event.target.x(), y: event.target.y() }));
        }
      }}
      style={{ background: canvasPalette.stage(), cursor: painting || penning ? 'crosshair' : 'grab' }}
    >
      <Layer listening={false}>
        {image === null ? null : <KonvaImage image={image} x={0} y={0} />}
        {scene.grid.mode === 'square' && scene.image !== null ? (
          <GridLines grid={scene.grid} width={scene.image.width} height={scene.image.height} />
        ) : null}
      </Layer>

      {/* Walls listen only for the GM, and only so a door can be clicked open;
          a player's pointer passes straight through to the tokens below. */}
      <Layer listening={isGameMaster && !penning}>
        {scene.walls.map((wall) => {
          const isDoor = wall.kind === 'door';
          const open = isDoor && wall.open;
          return (
            <Group key={wall.id}>
              <Line
                points={[wall.x1, wall.y1, wall.x2, wall.y2]}
                stroke={isDoor ? canvasPalette.doorLine() : canvasPalette.wallLine()}
                strokeWidth={open ? 2 : isDoor ? 7 : 3}
                {...(open ? { dash: [10, 6] } : {})}
                opacity={open ? 0.45 : 1}
                // A 3px line is hard to hit; the click target is wider than the ink.
                hitStrokeWidth={isDoor ? 18 : 0}
                listening={isDoor}
                {...(isDoor
                  ? {
                      onPointerClick: () => {
                        if (!pingGesture.current) onToggleDoor(wall.id);
                      },
                    }
                  : {})}
                onMouseEnter={(event) => {
                  if (isDoor) {
                    const stage = event.target.getStage();
                    if (stage !== null) stage.container().style.cursor = 'pointer';
                  }
                }}
                onMouseLeave={(event) => {
                  const stage = event.target.getStage();
                  if (stage !== null) stage.container().style.cursor = penning ? 'crosshair' : 'grab';
                }}
              />
              {/* A dot at the hinge marks a door as a door at a glance, and stays
                  visible once the leaf itself has faded out on opening. */}
              {isDoor ? (
                <Circle
                  x={wall.x1}
                  y={wall.y1}
                  radius={5}
                  fill={canvasPalette.doorLine()}
                  opacity={open ? 0.5 : 1}
                  listening={false}
                />
              ) : null}
            </Group>
          );
        })}
      </Layer>

      {/* The pen's draft: committed legs solid, the leg being aimed dashed. */}
      <Layer listening={false}>
        {penPoints.length > 0 ? (
          <Group>
            <Line
              points={penPoints.flatMap((point) => [point.x, point.y])}
              stroke={fogPen === null ? canvasPalette.wallLine() : canvasPalette.measureLine()}
              strokeWidth={3}
              {...(fogPen === null ? {} : { closed: penPoints.length > 2, opacity: 0.8 })}
            />
            {penCursor === null ? null : (
              <Line
                points={[
                  penPoints[penPoints.length - 1]?.x ?? 0,
                  penPoints[penPoints.length - 1]?.y ?? 0,
                  penCursor.x,
                  penCursor.y,
                ]}
                stroke={fogPen === null ? canvasPalette.wallLine() : canvasPalette.measureLine()}
                strokeWidth={2}
                dash={[6, 6]}
              />
            )}
            {penPoints.map((point, index) => (
              <Circle
                key={`pen-${index}`}
                x={point.x}
                y={point.y}
                radius={index === 0 ? 6 : 4}
                fill={fogPen === null ? canvasPalette.wallLine() : canvasPalette.measureLine()}
              />
            ))}
          </Group>
        ) : null}
      </Layer>

      {/* Range rings sit under the tokens so they never obscure a face. */}
      <Layer listening={false}>
        {scene.tokens
          .filter((token) => token.showRings)
          .map((token) => (
            <RangeRings key={`rings-${token.id}`} token={token} scale={scale} />
          ))}
      </Layer>

      <Layer>
        {scene.tokens.map((token) => (
          <TokenShape
            key={token.id}
            token={token}
            selected={token.id === selectedTokenId}
            spotlit={spotlightId !== null && token.ownerId === spotlightId}
            draggable={canDrag(token)}
            health={health?.[token.id]}
            targetedBy={targetRings?.[token.id] ?? NO_RINGS}
            onSelect={() => {
              if (!pingGesture.current) onSelectToken(token.id);
            }}
            onDragMove={(x, y) => {
              const preview = throttle.current.move(x, y);
              if (preview !== null) onMoveToken(token.id, preview.x, preview.y, false);
            }}
            onDragEnd={(x, y) => {
              const commit = throttle.current.end(x, y);
              const snapped = snapping
                ? snapToGrid(commit.x, commit.y, scene.grid, {
                    width: token.width,
                    height: token.height,
                  })
                : { x: commit.x, y: commit.y };
              onMoveToken(token.id, snapped.x, snapped.y, true);
            }}
          />
        ))}
      </Layer>

      {/* Journal pins sit over the tokens, so a note on a crowded square is
          still there to click. */}
      <Layer listening={!penning && !painting}>
        {notes.map((note) => (
          <Group
            key={note.id}
            x={note.x}
            y={note.y}
            onClick={() => {
              if (!pingGesture.current) onOpenNote?.(note.journalId);
            }}
            onTap={() => onOpenNote?.(note.journalId)}
            onMouseEnter={(event) => {
              const stage = event.target.getStage();
              if (stage !== null) stage.container().style.cursor = 'pointer';
            }}
            onMouseLeave={(event) => {
              const stage = event.target.getStage();
              if (stage !== null) stage.container().style.cursor = 'grab';
            }}
          >
            <Circle
              radius={10 / view.scale}
              fill={canvasPalette.doorLine()}
              stroke={canvasPalette.tokenChip()}
              strokeWidth={2 / view.scale}
            />
            <Text
              x={14 / view.scale}
              y={-7 / view.scale}
              text={note.title}
              fill={canvasPalette.tokenLabel()}
              fontSize={14 / view.scale}
            />
          </Group>
        ))}
      </Layer>

      {/* Fog last, so it covers everything beneath it. Only drawn here when the
          GPU layer could not start; see FogGl. */}
      {scene.fog.enabled && scene.image !== null && !fogOnGpu ? (
        <Layer listening={false}>
          <FogLayer
            fog={scene.fog}
            width={scene.image.width}
            height={scene.image.height}
            isGameMaster={isGameMaster}
          />
        </Layer>
      ) : null}

      <Layer listening={false}>
        {measureLine !== null && measurement !== null ? (
          <>
            <Line
              points={[measureLine.from.x, measureLine.from.y, measureLine.to.x, measureLine.to.y]}
              stroke={canvasPalette.measureLine()}
              strokeWidth={3 / view.scale}
              dash={[10 / view.scale, 6 / view.scale]}
            />
            <Text
              x={measureLine.to.x + 10 / view.scale}
              y={measureLine.to.y}
              text={
                measurement.squares === null
                  ? t('map.measure.feet', {
                      label: t(`range.${measurement.band}` as MessageKey),
                      feet: Math.round(measurement.feet ?? 0),
                    })
                  : t('map.measure.squares', {
                      label: t(`range.${measurement.band}` as MessageKey),
                      squares: measurement.squares,
                    })
              }
              fill={canvasPalette.measureText()}
              fontSize={16 / view.scale}
            />
          </>
        ) : null}

        {selected !== null && selected.showRings ? (
          <Text
            x={selected.x}
            y={selected.y - selected.height}
            text={selected.name}
            fill={canvasPalette.tokenLabel()}
            fontSize={14 / view.scale}
          />
        ) : null}
      </Layer>

      <Layer listening={false}>
        {pings.map((ping) => (
          <PingRing
            key={ping.id}
            x={ping.x}
            y={ping.y}
            color={ping.color}
            scale={view.scale}
            reducedMotion={reducedMotion}
          />
        ))}
      </Layer>
    </Stage>
    {scene.fog.enabled && scene.image !== null && fogOnGpu ? (
      <FogGl
        fog={scene.fog}
        lights={lights}
        view={view}
        width={width}
        height={height}
        isGameMaster={isGameMaster}
        onUnavailable={fogUnavailable}
      />
    ) : null}
    </>
  );
}

const NO_PINS: readonly MapPin[] = [];
const NO_PINGS: readonly { id: number; x: number; y: number; color: string }[] = [];

/** A ping's ring at full size, in screen pixels, so it reads the same at any zoom. */
const PING_RADIUS = 60;

/**
 * One ping: a ring that grows out of the point and fades over `PING_DURATION_MS`.
 * With reduced motion it does not grow, it only fades. Driven frame by frame on
 * the Konva node rather than through React state, which would re-render the
 * whole canvas sixty times a second.
 */
function PingRing({
  x,
  y,
  color,
  scale,
  reducedMotion,
}: {
  x: number;
  y: number;
  color: string;
  scale: number;
  reducedMotion: boolean;
}) {
  const ref = useRef<Konva.Circle>(null);
  // Read each frame, so zooming mid-ping keeps the ring's size on screen without
  // restarting the animation.
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / PING_DURATION_MS);
      const size = reducedMotion ? 1 : 0.15 + 0.85 * progress;
      node.radius((PING_RADIUS * size) / scaleRef.current);
      node.opacity(1 - progress);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [reducedMotion]);

  return <Circle ref={ref} x={x} y={y} radius={0} stroke={color} strokeWidth={4 / scale} />;
}

/** Where uploaded maps are served from. */
const MAP_ORIGIN = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:4000';

function GridLines({ grid, width, height }: { grid: Grid; width: number; height: number }) {
  const lines: JSX.Element[] = [];
  for (let x = grid.offsetX; x <= width; x += grid.size) {
    lines.push(
      <Line key={`v${x}`} points={[x, 0, x, height]} stroke={grid.color} strokeWidth={grid.lineWidth} />,
    );
  }
  for (let y = grid.offsetY; y <= height; y += grid.size) {
    lines.push(
      <Line key={`h${y}`} points={[0, y, width, y]} stroke={grid.color} strokeWidth={grid.lineWidth} />,
    );
  }
  return <>{lines}</>;
}

function RangeRings({ token, scale }: { token: Token; scale: RangeScale }) {
  const centre = { x: token.x + token.width / 2, y: token.y + token.height / 2 };
  return (
    <Group>
      {ringRadii(scale).map((ring) => (
        <Circle
          key={ring.band}
          x={centre.x}
          y={centre.y}
          radius={ring.radius}
          stroke={rangeRingColor(ring.band)}
          strokeWidth={2}
          dash={[8, 6]}
          opacity={0.75}
        />
      ))}
    </Group>
  );
}

// One <img> per URL, shared across every token that uses it — a battlefield
// full of the same adversary sprite should load it once, not once per token.
const tokenImageCache = new Map<string, HTMLImageElement>();

function useTokenImage(url: string | null): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(
    () => (url !== null ? tokenImageCache.get(url) ?? null : null),
  );
  useEffect(() => {
    if (url === null) {
      setImage(null);
      return;
    }
    const cached = tokenImageCache.get(url);
    if (cached !== undefined) {
      setImage(cached);
      return;
    }
    const element = new window.Image();
    element.src = url.startsWith('http') ? url : `${MAP_ORIGIN}${url}`;
    element.onload = () => {
      tokenImageCache.set(url, element);
      setImage(element);
    };
    return () => {
      element.onload = null;
    };
  }, [url]);
  return image;
}

/** A rounded-rect path; `radius === width/2` (and `height === width`) draws a circle. */
function roundedRectPath(ctx: Konva.Context, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(width - r, 0);
  ctx.arc(width - r, r, r, -Math.PI / 2, 0);
  ctx.lineTo(width, height - r);
  ctx.arc(width - r, height - r, r, 0, Math.PI / 2);
  ctx.lineTo(r, height);
  ctx.arc(r, height - r, r, Math.PI / 2, Math.PI);
  ctx.lineTo(0, r);
  ctx.arc(r, r, r, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}

interface TokenShapeProps {
  token: Token;
  selected: boolean;
  /** True while the spotlight is on this token's owner. */
  spotlit: boolean;
  draggable: boolean;
  health: { marked: number; total: number } | undefined;
  /** The colour of each account targeting this token. */
  targetedBy: readonly string[];
  onSelect: () => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: (x: number, y: number) => void;
}

/** Chip and pip geometry for a token's label, in scene pixels. */
const CHIP_HEIGHT = 16;
const CHIP_GAP = 6;
const PIP_HEIGHT = 4;
const PIP_GAP = 2;
/** Target rings start outside the spotlight ring and step out one per account. */
const TARGET_RING_OFFSET = 14;
const TARGET_RING_STEP = 5;
const NO_RINGS: readonly string[] = [];

function TokenShape({
  token,
  selected,
  spotlit,
  draggable,
  health,
  targetedBy,
  onSelect,
  onDragMove,
  onDragEnd,
}: TokenShapeProps) {
  const image = useTokenImage(token.image?.url ?? null);
  const radius = token.kind === 'adversary' ? 4 : token.width / 2;
  const chipY = token.height + CHIP_GAP;
  // Pips run the token's width, one per HP slot, so a glance reads both how
  // much is gone and how much there was.
  const pipCount = health?.total ?? 0;
  const pipWidth =
    pipCount === 0 ? 0 : (token.width - PIP_GAP * (pipCount - 1)) / pipCount;

  return (
    <Group
      x={token.x}
      y={token.y}
      rotation={token.rotation}
      draggable={draggable}
      onClick={onSelect}
      onTap={onSelect}
      onDragMove={(event) => onDragMove(event.target.x(), event.target.y())}
      onDragEnd={(event) => {
        onDragEnd(event.target.x(), event.target.y());
        // Konva moves the node itself during a drag, outside React. Put it back
        // where the state says it is: the authoritative position arrives as a
        // patch, and a refused or snapped-away move would otherwise leave the
        // token sitting wherever it was dropped, for good.
        event.target.position({ x: token.x, y: token.y });
      }}
      opacity={token.hidden ? 0.55 : 1}
    >
      {/*
       * A double ring lifts the token off the art: its side's colour, then a
       * ring of the canvas colour outside it. Without the second ring a dark
       * token on a dark map has no edge at all.
       */}
      <Rect
        x={-4}
        y={-4}
        width={token.width + 8}
        height={token.height + 8}
        fill="transparent"
        cornerRadius={radius + 4}
        stroke={canvasPalette.canvas()}
        strokeWidth={4}
        listening={false}
        shadowColor="#000000"
        shadowBlur={20}
        shadowOffsetY={10}
        shadowOpacity={0.9}
      />
      {image !== null ? (
        <Group clipFunc={(ctx) => roundedRectPath(ctx, token.width, token.height, radius)}>
          <KonvaImage image={image} width={token.width} height={token.height} />
        </Group>
      ) : (
        <Rect width={token.width} height={token.height} fill={token.color} cornerRadius={radius} />
      )}
      <Rect
        x={-1}
        y={-1}
        width={token.width + 2}
        height={token.height + 2}
        fill="transparent"
        cornerRadius={radius + 1}
        stroke={token.color}
        strokeWidth={2}
        listening={false}
      />
      {/* The spotlight is a warm ring further out than selection, so a token can
          be both spotlit and selected without the two rings merging. */}
      {spotlit ? (
        <Rect
          x={-10}
          y={-10}
          width={token.width + 20}
          height={token.height + 20}
          fill="transparent"
          cornerRadius={radius + 10}
          stroke="#e8b44a"
          strokeWidth={3}
          listening={false}
        />
      ) : null}
      {/* Targets are dashed, in the colour of whoever is aiming, so two players
          aiming at the same token both show. */}
      {targetedBy.map((color, index) => {
        const offset = TARGET_RING_OFFSET + index * TARGET_RING_STEP;
        return (
          <Rect
            key={`target-${index}`}
            x={-offset}
            y={-offset}
            width={token.width + offset * 2}
            height={token.height + offset * 2}
            fill="transparent"
            cornerRadius={radius + offset}
            stroke={color}
            strokeWidth={2}
            dash={[6, 4]}
            listening={false}
          />
        );
      })}
      {/* Selection reads as a brighter, wider ring outside the band, so it
          never has to compete with the band for the same pixels. */}
      {selected ? (
        <Rect
          x={-6}
          y={-6}
          width={token.width + 12}
          height={token.height + 12}
          fill="transparent"
          cornerRadius={radius + 6}
          stroke={canvasPalette.tokenOutline()}
          strokeWidth={2}
          listening={false}
        />
      ) : null}
      {/* Conditions ride above the token as initials, so the table can read at a
          glance who is Hidden, Restrained or Vulnerable without opening a sheet. */}
      {token.conditions.length === 0 ? null : (
        <>
          <Rect
            x={-6}
            y={-CHIP_HEIGHT - 4}
            width={token.width + 12}
            height={CHIP_HEIGHT}
            fill={canvasPalette.tokenChip()}
            cornerRadius={2}
            opacity={0.9}
            listening={false}
          />
          <Text
            x={-6}
            y={-CHIP_HEIGHT - 1}
            width={token.width + 12}
            align="center"
            text={token.conditions.map((c) => c.slice(0, 1).toUpperCase()).join(' ')}
            fill={canvasPalette.tokenLabel()}
            fontSize={11}
            fontStyle="700"
            listening={false}
          />
        </>
      )}
      {/* The name never floats loose over the art: it sits in a chip dark
          enough to read against anything underneath. */}
      <Rect
        x={-6}
        y={chipY}
        width={token.width + 12}
        height={CHIP_HEIGHT}
        fill={canvasPalette.tokenChip()}
        cornerRadius={2}
        stroke={token.color}
        strokeWidth={1}
        opacity={0.95}
        listening={false}
      />
      <Text
        x={-6}
        y={chipY + 3}
        width={token.width + 12}
        align="center"
        text={token.name}
        fill={canvasPalette.tokenLabel()}
        fontSize={11}
        fontStyle="600"
        listening={false}
      />
      {health === undefined
        ? null
        : Array.from({ length: pipCount }, (_, index) => (
            <Rect
              key={`hp-${index}`}
              x={index * (pipWidth + PIP_GAP)}
              y={chipY + CHIP_HEIGHT + PIP_GAP}
              width={pipWidth}
              height={PIP_HEIGHT}
              cornerRadius={1}
              fill={
                index < health.total - health.marked
                  ? canvasPalette.hpFull()
                  : canvasPalette.hpEmpty()
              }
              listening={false}
            />
          ))}
      {token.hidden ? (
        <Text
          y={-18}
          text={t('map.token.gmOnly')}
          fill={canvasPalette.tokenLabelMuted()}
          fontSize={11}
          listening={false}
        />
      ) : null}
    </Group>
  );
}

/**
 * Fog. Players get a solid cover over everything not revealed; the GM sees the same
 * regions at reduced opacity so they can still read the map underneath.
 *
 * Only revealed cells are known to a player's client at all — the rest never left
 * the server — so this draws cover for every cell that isn't in the revealed set.
 */
function FogLayer({
  fog,
  width,
  height,
  isGameMaster,
}: {
  fog: Fog;
  width: number;
  height: number;
  isGameMaster: boolean;
}) {
  const revealed = useMemo(() => new Set(fog.revealed), [fog.revealed]);
  const cells: JSX.Element[] = [];

  for (let row = 0; row < fog.rows; row++) {
    for (let col = 0; col < fog.cols; col++) {
      if (revealed.has(row * fog.cols + col)) continue;
      cells.push(
        <Rect
          key={`${row}-${col}`}
          x={col * fog.cellSize}
          y={row * fog.cellSize}
          width={fog.cellSize}
          height={fog.cellSize}
          fill={canvasPalette.fog()}
          opacity={isGameMaster ? 0.5 : 1}
        />,
      );
    }
  }

  return (
    <Group>
      <Rect x={0} y={0} width={width} height={height} opacity={0} />
      {cells}
    </Group>
  );
}
