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
import { canvasPalette, rangeRingColor } from '../../styles/canvasTokens.js';

export interface MapCanvasProps {
  scene: Scene;
  /** Viewer's role: the GM sees fog at reduced opacity, players not at all. */
  isGameMaster: boolean;
  /** Session id of the viewer, used to decide which tokens they may drag. */
  viewerId: string | null;
  width: number;
  height: number;
  selectedTokenId: string | null;
  onSelectToken: (tokenId: string | null) => void;
  onMoveToken: (tokenId: string, x: number, y: number, commit: boolean) => void;
  /** Set while the GM is painting fog; a drag then paints instead of panning. */
  fogBrush: { radius: number; reveal: boolean } | null;
  onPaintFog: (x: number, y: number) => void;
  measuring: boolean;
  /** Set while the GM is placing a wall; a drag then draws a segment instead
   * of panning, same interaction shape as `measuring`. */
  drawingWall: boolean;
  onAddWall: (x1: number, y1: number, x2: number, y2: number) => void;
  /** Reports the current pan/zoom, so the caller can anchor an HTML overlay
   * (e.g. a token popover) to a scene-space point in screen coordinates. */
  onViewChange?: (view: { x: number; y: number; scale: number }) => void;
  /** Health per token id, for the 4px bar under a token's name chip. Only
   * tokens the caller has real numbers for get one — no bar is drawn for a
   * token whose HP nobody tracks. */
  health?: Readonly<Record<string, { marked: number; total: number }>>;
  /** Filled in by the canvas with a one-step zoom, so the HUD's zoom control
   * (an HTML overlay, outside the Konva tree) can drive it. */
  zoomApi?: { current: ((direction: 1 | -1) => void) | null };
}

/** Scene grid settings translated into the scale the range module expects. */
export function scaleFor(grid: Grid): RangeScale {
  return { mode: grid.mode, pixelsPerSquare: grid.size, feetPerInch: grid.feetPerInch };
}

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
  width,
  height,
  selectedTokenId,
  onSelectToken,
  onMoveToken,
  fogBrush,
  onPaintFog,
  measuring,
  drawingWall,
  onAddWall,
  onViewChange,
  health,
  zoomApi,
}: MapCanvasProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  useEffect(() => onViewChange?.(view), [view, onViewChange]);
  const [measureLine, setMeasureLine] = useState<{
    from: { x: number; y: number };
    to: { x: number; y: number };
  } | null>(null);
  const [wallDraft, setWallDraft] = useState<{
    from: { x: number; y: number };
    to: { x: number; y: number };
  } | null>(null);

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
    zoomApi.current = (direction) => zoomAbout({ x: width / 2, y: height / 2 }, direction);
    return () => {
      zoomApi.current = null;
    };
  }, [zoomApi, zoomAbout, width, height]);

  const onWheel = (event: Konva.KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault();
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!stage || !pointer) return;
    zoomAbout(pointer, event.evt.deltaY > 0 ? -1 : 1);
  };

  const painting = fogBrush !== null && isGameMaster;

  const onStagePointerDown = (event: Konva.KonvaEventObject<PointerEvent>) => {
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    const point = toScene(pointer);

    if (painting) {
      onPaintFog(point.x, point.y);
      return;
    }
    if (drawingWall) {
      setWallDraft({ from: point, to: point });
      return;
    }
    if (measuring) {
      setMeasureLine({ from: point, to: point });
      return;
    }
    // A click on empty canvas clears the selection.
    if (event.target === stage) onSelectToken(null);
  };

  const onStagePointerMove = () => {
    const pointer = stageRef.current?.getPointerPosition();
    if (!pointer) return;
    const point = toScene(pointer);

    if (painting && stageRef.current?.isDragging() === false) return;
    if (measureLine !== null) setMeasureLine({ ...measureLine, to: point });
    if (wallDraft !== null) setWallDraft({ ...wallDraft, to: point });
  };

  const canDrag = (token: Token): boolean =>
    isGameMaster || (viewerId !== null && token.ownerId === viewerId);

  const measurement = measureLine === null ? null : measure(measureLine.from, measureLine.to, scale);
  const selected = scene.tokens.find((token) => token.id === selectedTokenId) ?? null;

  return (
    <Stage
      ref={stageRef}
      width={width}
      height={height}
      x={view.x}
      y={view.y}
      scaleX={view.scale}
      scaleY={view.scale}
      draggable={!painting && !measuring && !drawingWall}
      onWheel={onWheel}
      onPointerDown={onStagePointerDown}
      onPointerMove={onStagePointerMove}
      onPointerUp={() => {
        setMeasureLine(null);
        if (wallDraft !== null) {
          const dx = wallDraft.to.x - wallDraft.from.x;
          const dy = wallDraft.to.y - wallDraft.from.y;
          // A plain click without any drag would otherwise create an invisible
          // zero-length wall that still occupies a slot in the scene.
          if (Math.hypot(dx, dy) >= 4) {
            onAddWall(wallDraft.from.x, wallDraft.from.y, wallDraft.to.x, wallDraft.to.y);
          }
          setWallDraft(null);
        }
      }}
      onDragEnd={(event) => {
        if (event.target === stageRef.current) {
          setView((current) => ({ ...current, x: event.target.x(), y: event.target.y() }));
        }
      }}
      style={{ background: canvasPalette.stage(), cursor: painting ? 'crosshair' : 'grab' }}
    >
      <Layer listening={false}>
        {image === null ? null : <KonvaImage image={image} x={0} y={0} />}
        {scene.grid.mode === 'square' && scene.image !== null ? (
          <GridLines grid={scene.grid} width={scene.image.width} height={scene.image.height} />
        ) : null}
      </Layer>

      <Layer listening={false}>
        {scene.walls.map((wall) => (
          <Line
            key={wall.id}
            points={[wall.x1, wall.y1, wall.x2, wall.y2]}
            stroke={wall.kind === 'door' ? canvasPalette.doorLine() : canvasPalette.wallLine()}
            strokeWidth={wall.kind === 'door' && wall.open ? 1 : 3}
            {...(wall.kind === 'door' ? { dash: [10, 6] } : {})}
            opacity={wall.kind === 'door' && wall.open ? 0.4 : 1}
          />
        ))}
        {wallDraft !== null ? (
          <Line
            points={[wallDraft.from.x, wallDraft.from.y, wallDraft.to.x, wallDraft.to.y]}
            stroke={canvasPalette.wallLine()}
            strokeWidth={3}
            dash={[4, 4]}
          />
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
            draggable={canDrag(token)}
            health={health?.[token.id]}
            onSelect={() => onSelectToken(token.id)}
            onDragMove={(x, y) => {
              const preview = throttle.current.move(x, y);
              if (preview !== null) onMoveToken(token.id, preview.x, preview.y, false);
            }}
            onDragEnd={(x, y) => {
              const commit = throttle.current.end(x, y);
              const snapped = snapToGrid(commit.x, commit.y, scene.grid);
              onMoveToken(token.id, snapped.x, snapped.y, true);
            }}
          />
        ))}
      </Layer>

      {/* Fog last, so it covers everything beneath it. */}
      {scene.fog.enabled && scene.image !== null ? (
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
    </Stage>
  );
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
  draggable: boolean;
  health: { marked: number; total: number } | undefined;
  onSelect: () => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: (x: number, y: number) => void;
}

/** Chip and pip geometry for a token's label, in scene pixels. */
const CHIP_HEIGHT = 16;
const CHIP_GAP = 6;
const PIP_HEIGHT = 4;
const PIP_GAP = 2;

function TokenShape({
  token,
  selected,
  draggable,
  health,
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
      onDragEnd={(event) => onDragEnd(event.target.x(), event.target.y())}
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
