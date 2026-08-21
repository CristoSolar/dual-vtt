import {
  RANGE_LABELS,
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
}: MapCanvasProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [measureLine, setMeasureLine] = useState<{
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

  const onWheel = (event: Konva.KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault();
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!stage || !pointer) return;

    const direction = event.evt.deltaY > 0 ? -1 : 1;
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.scale * (direction > 0 ? 1.1 : 1 / 1.1)));
    // Keep the point under the cursor fixed while zooming.
    const scenePoint = { x: (pointer.x - view.x) / view.scale, y: (pointer.y - view.y) / view.scale };
    setView({
      scale: next,
      x: pointer.x - scenePoint.x * next,
      y: pointer.y - scenePoint.y * next,
    });
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
      draggable={!painting && !measuring}
      onWheel={onWheel}
      onPointerDown={onStagePointerDown}
      onPointerMove={onStagePointerMove}
      onPointerUp={() => setMeasureLine(null)}
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
                  ? `${RANGE_LABELS[measurement.band]} · ${Math.round(measurement.feet ?? 0)} pies`
                  : `${RANGE_LABELS[measurement.band]} · ${measurement.squares} casillas`
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
      <Line
        key={`v${x}`}
        points={[x, 0, x, height]}
        stroke={canvasPalette.gridLine()}
        strokeWidth={1}
      />,
    );
  }
  for (let y = grid.offsetY; y <= height; y += grid.size) {
    lines.push(
      <Line
        key={`h${y}`}
        points={[0, y, width, y]}
        stroke={canvasPalette.gridLine()}
        strokeWidth={1}
      />,
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
  onSelect: () => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: (x: number, y: number) => void;
}

function TokenShape({
  token,
  selected,
  draggable,
  onSelect,
  onDragMove,
  onDragEnd,
}: TokenShapeProps) {
  const image = useTokenImage(token.image?.url ?? null);
  const radius = token.kind === 'adversary' ? 4 : token.width / 2;

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
      {image !== null ? (
        <Group clipFunc={(ctx) => roundedRectPath(ctx, token.width, token.height, radius)}>
          <KonvaImage image={image} width={token.width} height={token.height} />
        </Group>
      ) : (
        <Rect width={token.width} height={token.height} fill={token.color} cornerRadius={radius} />
      )}
      <Rect
        width={token.width}
        height={token.height}
        fill="transparent"
        cornerRadius={radius}
        stroke={selected ? canvasPalette.tokenOutline() : canvasPalette.tokenOutlineIdle()}
        strokeWidth={selected ? 3 : 1}
      />
      <Text
        y={token.height + 2}
        width={token.width}
        align="center"
        text={token.name}
        fill={canvasPalette.tokenLabel()}
        fontSize={12}
        listening={false}
      />
      {token.hidden ? (
        <Text
          y={-14}
          text="Solo DJ"
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
