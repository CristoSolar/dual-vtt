import {
  DEFAULT_GRID,
  type Grid,
  type RoomEvent,
  type RoomState,
  type Token,
} from '@daggerheart/protocol';
import { MAX_FEAR } from '@daggerheart/rules';
import { adversaries } from '@daggerheart/srd-data';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Icon, type IconName } from '../components/icons/Icon.js';
import { FloatingPanel } from '../components/map/FloatingPanel.js';
import { MapCanvas } from '../components/map/MapCanvas.js';
import { MapSheetPanel } from '../components/map/MapSheetPanel.js';
import { TokenPopover } from '../components/map/TokenPopover.js';
import type { PanelLayout } from '../state/floatingPanel.js';
import { useElementSize } from '../state/useElementSize.js';
import { uploadImage } from '../state/uploadMap.js';
import { adversaryTokenColor, tokenColorAt } from '../styles/canvasTokens.js';

interface MapRouteProps {
  room: RoomState;
  isGameMaster: boolean;
  viewerId: string | null;
  send: (event: RoomEvent) => void;
}

let counter = 0;
const nextId = (prefix: string) => {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
};

type PanelId = 'scenes' | 'battlemap' | 'grid' | 'tokens' | 'fog' | 'sheet' | 'walls';

const PANEL_TITLES: Record<PanelId, string> = {
  scenes: 'Escenas',
  battlemap: 'Mapa de batalla',
  grid: 'Cuadrícula y escala',
  tokens: 'Fichas',
  fog: 'Niebla de guerra',
  sheet: 'Hoja de personaje',
  walls: 'Muros y puertas',
};

const PANELS_KEY = 'daggerheart-vtt:map-panels';

type PanelStore = Record<PanelId, PanelLayout & { open: boolean }>;

const defaultPanels = (): PanelStore => ({
  scenes: { x: 90, y: 96, z: 1, open: false },
  battlemap: { x: 90, y: 96, z: 1, open: false },
  grid: { x: 90, y: 96, z: 1, open: false },
  tokens: { x: 90, y: 96, z: 1, open: true },
  fog: { x: 90, y: 96, z: 1, open: false },
  sheet: { x: 90, y: 96, z: 1, open: false },
  walls: { x: 90, y: 96, z: 1, open: false },
});

/** Reads saved panel positions; any corruption just falls back to defaults. */
function loadPanels(): PanelStore {
  try {
    const raw = window.localStorage.getItem(PANELS_KEY);
    if (raw === null) return defaultPanels();
    return { ...defaultPanels(), ...JSON.parse(raw) };
  } catch {
    return defaultPanels();
  }
}

/** The tactical map: canvas plus, for the GM, the tools that drive it. */
export function MapRoute({ room, isGameMaster, viewerId, send }: MapRouteProps) {
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [fogBrush, setFogBrush] = useState<{ radius: number; reveal: boolean } | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [drawingWall, setDrawingWall] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [tokenImageError, setTokenImageError] = useState<string | null>(null);
  const [uploadingTokenImage, setUploadingTokenImage] = useState(false);
  const [canvasView, setCanvasView] = useState({ x: 0, y: 0, scale: 1 });
  const fileInput = useRef<HTMLInputElement>(null);
  const { ref: stageWrapRef, size: stageSize } = useElementSize<HTMLDivElement>();

  const [panels, setPanels] = useState<PanelStore>(loadPanels);
  useEffect(() => {
    window.localStorage.setItem(PANELS_KEY, JSON.stringify(panels));
  }, [panels]);

  const topZ = useRef(1);
  const focusPanel = (id: PanelId) => {
    topZ.current += 1;
    setPanels((prev) => ({ ...prev, [id]: { ...prev[id], z: topZ.current } }));
  };
  const togglePanel = (id: PanelId) => {
    setPanels((prev) => ({ ...prev, [id]: { ...prev[id], open: !prev[id].open } }));
    if (!panels[id].open) focusPanel(id);
  };
  const closePanel = (id: PanelId) => setPanels((prev) => ({ ...prev, [id]: { ...prev[id], open: false } }));
  const movePanel = (id: PanelId, layout: PanelLayout) =>
    setPanels((prev) => ({ ...prev, [id]: { ...prev[id], ...layout } }));

  const scene = useMemo(
    () => room.map.scenes.find((s) => s.id === room.map.activeSceneId) ?? room.map.scenes[0] ?? null,
    [room.map],
  );
  const selected = scene?.tokens.find((t) => t.id === selectedTokenId) ?? null;
  const mySheet = viewerId !== null ? room.characters[viewerId] ?? null : null;

  /**
   * HP per token, for the bar under each name chip. Both sides come from real
   * state — a PC token from its claimed sheet, an adversary from its instance
   * — so a token whose HP nobody tracks simply gets no bar.
   */
  const tokenHealth = useMemo(() => {
    const byToken: Record<string, { marked: number; total: number }> = {};
    for (const token of scene?.tokens ?? []) {
      if (token.refId === null) continue;
      if (token.kind === 'pc') {
        const sheet = room.characters[token.refId];
        if (sheet !== undefined) {
          byToken[token.id] = { marked: sheet.hpMarked, total: sheet.character.hpSlots };
        }
        continue;
      }
      const instance = room.adversaryInstances.find((a) => a.instanceId === token.refId);
      const stats = adversaries.find((a) => a.id === instance?.adversaryId);
      if (instance !== undefined && stats !== undefined) {
        byToken[token.id] = { marked: instance.hpMarked, total: stats.hp };
      }
    }
    return byToken;
  }, [scene, room.characters, room.adversaryInstances]);

  // Filled in by the canvas; the HUD's zoom buttons call through it.
  const zoomApi = useRef<((direction: 1 | -1) => void) | null>(null);

  const moveToken = useCallback(
    (tokenId: string, x: number, y: number, commit: boolean) => {
      if (scene === null) return;
      send({ type: 'moveToken', sceneId: scene.id, tokenId, x, y, commit });
    },
    [scene, send],
  );

  const paintFog = useCallback(
    (x: number, y: number) => {
      if (scene === null || fogBrush === null) return;
      send({ type: 'paintFog', sceneId: scene.id, x, y, radius: fogBrush.radius, reveal: fogBrush.reveal });
    },
    [scene, fogBrush, send],
  );

  const updateSelected = (patch: Partial<Token>) => {
    if (scene === null || selected === null) return;
    send({ type: 'updateToken', sceneId: scene.id, token: { ...selected, ...patch } });
  };

  const onUploadTokenImage = async (file: File) => {
    setTokenImageError(null);
    setUploadingTokenImage(true);
    try {
      const image = await uploadImage(file);
      updateSelected({ image });
    } catch (error) {
      setTokenImageError(error instanceof Error ? error.message : 'Falló la subida');
    } finally {
      setUploadingTokenImage(false);
    }
  };

  const deployAdversary = (adversaryId: string, name: string): string => {
    const instanceId = nextId('adv');
    send({ type: 'addAdversary', instanceId, adversaryId, name });
    return instanceId;
  };

  const hasOwnToken =
    viewerId !== null && scene !== null && scene.tokens.some((t) => t.kind === 'pc' && t.refId === viewerId);

  const placeMyToken = () => {
    if (scene === null || viewerId === null || mySheet === null) return;
    send({
      type: 'addToken',
      sceneId: scene.id,
      token: {
        id: nextId('tok'),
        kind: 'pc',
        refId: viewerId,
        name: mySheet.character.name ?? 'PJ',
        x: 200,
        y: 200,
        width: 50,
        height: 50,
        rotation: 0,
        ownerId: viewerId,
        hidden: false,
        showRings: false,
        color: tokenColorAt(0),
        image: null,
        colorFrame: false,
        visionRadius: 720,
      },
    });
  };

  const onUpload = async (file: File) => {
    if (scene === null) return;
    setUploadError(null);
    setUploading(true);
    try {
      const image = await uploadImage(file);
      send({ type: 'setSceneImage', sceneId: scene.id, image });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Falló la subida');
    } finally {
      setUploading(false);
    }
  };

  const toolButton = (id: PanelId, icon: IconName, label: string) => (
    <button
      type="button"
      key={id}
      className="map-rail-button"
      aria-pressed={panels[id].open}
      aria-label={label}
      title={label}
      onClick={() => togglePanel(id)}
    >
      <Icon name={icon} size={20} />
    </button>
  );

  return (
    <div className="map-fullscreen">
      <div className="map-scene-bar">
        <span className="map-scene-name">
          <span className="ornament-diamond" aria-hidden="true" />
          <span className="map-scene-title">{scene === null ? 'Todavía no hay escena' : scene.name}</span>
          {scene === null ? null : (
            <span className="map-scene-meta">
              {scene.grid.mode === 'square'
                ? `cuadrícula ${scene.grid.feetPerInch} pies`
                : 'sin cuadrícula'}
            </span>
          )}
        </span>
        {isGameMaster ? (
          <button
            type="button"
            onClick={() => send({ type: 'addScene', id: nextId('scene'), name: 'Nueva escena' })}
          >
            Nueva escena
          </button>
        ) : null}
        {!isGameMaster && !hasOwnToken && mySheet !== null && scene !== null ? (
          <button type="button" onClick={placeMyToken}>
            Colocar mi ficha
          </button>
        ) : null}
      </div>

      {isGameMaster || mySheet !== null ? (
        <div className="map-rail">
          {isGameMaster ? (
            <>
              {toolButton('scenes', 'map', 'Escenas')}
              {toolButton('battlemap', 'scene', 'Mapa de batalla')}
              {toolButton('grid', 'select', 'Cuadrícula y escala')}
              {toolButton('tokens', 'group', 'Fichas')}
              {toolButton('fog', 'fog', 'Niebla de guerra')}
              {toolButton('walls', 'door', 'Muros y puertas')}
              <button
                type="button"
                className="map-rail-button"
                aria-pressed={measuring}
                aria-label="Medir distancia"
                title="Medir distancia"
                onClick={() => setMeasuring((m) => !m)}
              >
                <Icon name="measure" size={20} />
              </button>
            </>
          ) : (
            toolButton('sheet', 'shield', 'Hoja de personaje')
          )}
        </div>
      ) : null}

      <div ref={stageWrapRef} className="map-stage-full">
        {scene === null ? (
          <div className="panel map-empty-notice">
            <p className="muted">
              {isGameMaster
                ? 'Crea una escena para empezar a armar el mapa.'
                : 'El DJ todavía no ha compartido una escena.'}
            </p>
          </div>
        ) : stageSize.width > 0 ? (
          <MapCanvas
            scene={scene}
            isGameMaster={isGameMaster}
            viewerId={viewerId}
            width={stageSize.width}
            height={stageSize.height}
            selectedTokenId={selectedTokenId}
            onSelectToken={setSelectedTokenId}
            onMoveToken={moveToken}
            fogBrush={fogBrush}
            onPaintFog={paintFog}
            measuring={measuring}
            health={tokenHealth}
            zoomApi={zoomApi}
            onViewChange={setCanvasView}
            drawingWall={drawingWall}
            onAddWall={(x1, y1, x2, y2) => {
              if (scene === null) return;
              send({
                type: 'addWall',
                sceneId: scene.id,
                wall: { id: nextId('wall'), x1, y1, x2, y2, kind: 'wall', open: false },
              });
            }}
          />
        ) : null}
        {isGameMaster && selected !== null ? (
          <TokenPopover
            token={selected}
            room={room}
            x={selected.x * canvasView.scale + canvasView.x}
            y={(selected.y + selected.height) * canvasView.scale + canvasView.y}
            onUpdate={updateSelected}
            onRemove={() => {
              if (scene === null) return;
              send({ type: 'removeToken', sceneId: scene.id, tokenId: selected.id });
              setSelectedTokenId(null);
            }}
            onClose={() => setSelectedTokenId(null)}
            send={send}
            onUploadImage={(file) => void onUploadTokenImage(file)}
            uploadingImage={uploadingTokenImage}
            imageError={tokenImageError}
          />
        ) : null}
      </div>

      {selected !== null ? (
        <div className="map-selection-bar">
          <strong>{selected.name}</strong>
          <button
            type="button"
            aria-pressed={selected.showRings}
            onClick={() => updateSelected({ showRings: !selected.showRings })}
          >
            {selected.showRings ? 'Ocultar anillos de alcance' : 'Mostrar anillos de alcance'}
          </button>
        </div>
      ) : null}

      {/* The GM's Fear reserve, on the map itself: it's spent mid-scene, so it
          belongs where the scene is, not one panel away. */}
      {isGameMaster ? (
        <div className="map-fear-bar">
          <span className="map-fear-label">Miedo</span>
          <ul className="pips">
            {Array.from({ length: MAX_FEAR }, (_, index) => {
              const filled = index < room.fear;
              const description = `Miedo ${index + 1} de ${MAX_FEAR}`;
              return (
                <li key={index}>
                  <button
                    type="button"
                    className="pip fear"
                    data-filled={filled}
                    aria-pressed={filled}
                    aria-label={description}
                    title={description}
                    onClick={() =>
                      send(filled ? { type: 'spendFear', amount: 1 } : { type: 'gainFear', amount: 1 })
                    }
                  />
                </li>
              );
            })}
          </ul>
          <span className="map-fear-count">
            {room.fear} / {MAX_FEAR}
          </span>
        </div>
      ) : null}

      <div className="map-zoom-bar">
        <button
          type="button"
          className="map-zoom-button"
          aria-label="Alejar"
          onClick={() => zoomApi.current?.(-1)}
        >
          −
        </button>
        <span className="map-zoom-value">{Math.round(canvasView.scale * 100)}%</span>
        <button
          type="button"
          className="map-zoom-button"
          aria-label="Acercar"
          onClick={() => zoomApi.current?.(1)}
        >
          +
        </button>
      </div>

      {!isGameMaster && viewerId !== null && mySheet !== null && panels.sheet.open ? (
        <FloatingPanel
          title={PANEL_TITLES.sheet}
          layout={panels.sheet}
          onLayoutChange={(l) => movePanel('sheet', l)}
          onFocus={() => focusPanel('sheet')}
          onClose={() => closePanel('sheet')}
          wide
        >
          <MapSheetPanel sheet={mySheet} characterId={viewerId} send={send} sharedLog={room.rollLog} />
        </FloatingPanel>
      ) : null}

      {isGameMaster && scene !== null && panels.scenes.open ? (
        <FloatingPanel
          title={PANEL_TITLES.scenes}
          layout={panels.scenes}
          onLayoutChange={(l) => movePanel('scenes', l)}
          onFocus={() => focusPanel('scenes')}
          onClose={() => closePanel('scenes')}
        >
          <SceneList room={room} send={send} />
        </FloatingPanel>
      ) : null}

      {isGameMaster && scene !== null && panels.battlemap.open ? (
        <FloatingPanel
          title={PANEL_TITLES.battlemap}
          layout={panels.battlemap}
          onLayoutChange={(l) => movePanel('battlemap', l)}
          onFocus={() => focusPanel('battlemap')}
          onClose={() => closePanel('battlemap')}
        >
          <input
            ref={fileInput}
            type="file"
            disabled={uploading}
            accept="image/png,image/jpeg,image/gif,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) void onUpload(file);
            }}
          />
          {uploading ? <p className="muted">Subiendo…</p> : null}
          {uploadError !== null ? <p className="field-error">{uploadError}</p> : null}
          {scene.image === null ? (
            <p className="muted">Todavía no hay imagen.</p>
          ) : (
            <p className="muted">
              {scene.image.width}×{scene.image.height}
            </p>
          )}
        </FloatingPanel>
      ) : null}

      {isGameMaster && scene !== null && panels.grid.open ? (
        <FloatingPanel
          title={PANEL_TITLES.grid}
          layout={panels.grid}
          onLayoutChange={(l) => movePanel('grid', l)}
          onFocus={() => focusPanel('grid')}
          onClose={() => closePanel('grid')}
        >
          <GridControls
            grid={scene.grid}
            onChange={(grid) => send({ type: 'setSceneGrid', sceneId: scene.id, grid })}
          />
        </FloatingPanel>
      ) : null}

      {isGameMaster && scene !== null && panels.tokens.open ? (
        <FloatingPanel
          title={PANEL_TITLES.tokens}
          layout={panels.tokens}
          onLayoutChange={(l) => movePanel('tokens', l)}
          onFocus={() => focusPanel('tokens')}
          onClose={() => closePanel('tokens')}
        >
          <TokenTools
            room={room}
            onAdd={(token) => send({ type: 'addToken', sceneId: scene.id, token })}
            onDeploy={deployAdversary}
          />
        </FloatingPanel>
      ) : null}

      {isGameMaster && scene !== null && panels.fog.open ? (
        <FloatingPanel
          title={PANEL_TITLES.fog}
          layout={panels.fog}
          onLayoutChange={(l) => movePanel('fog', l)}
          onFocus={() => focusPanel('fog')}
          onClose={() => closePanel('fog')}
        >
          {scene.visionMode === 'manual' ? (
            <>
              <button
                type="button"
                aria-pressed={scene.fog.enabled}
                onClick={() => send({ type: 'setFogEnabled', sceneId: scene.id, enabled: !scene.fog.enabled })}
              >
                {scene.fog.enabled ? 'Niebla activada' : 'Niebla desactivada'}
              </button>
              <div className="row mt-3">
                <button
                  type="button"
                  aria-pressed={fogBrush?.reveal === true}
                  onClick={() => setFogBrush(fogBrush?.reveal === true ? null : { radius: 120, reveal: true })}
                >
                  Pincel de revelar
                </button>
                <button
                  type="button"
                  aria-pressed={fogBrush?.reveal === false}
                  onClick={() => setFogBrush(fogBrush?.reveal === false ? null : { radius: 120, reveal: false })}
                >
                  Pincel de ocultar
                </button>
              </div>
              <p className="muted">Los jugadores solo ven las áreas reveladas — el resto nunca se les envía.</p>
            </>
          ) : (
            <p className="muted">
              Visión automática activa (panel "Muros y puertas") — el pincel manual está desactivado para esta
              escena.
            </p>
          )}
        </FloatingPanel>
      ) : null}

      {isGameMaster && scene !== null && panels.walls.open ? (
        <FloatingPanel
          title={PANEL_TITLES.walls}
          layout={panels.walls}
          onLayoutChange={(l) => movePanel('walls', l)}
          onFocus={() => focusPanel('walls')}
          onClose={() => {
            closePanel('walls');
            setDrawingWall(false);
          }}
        >
          <button type="button" aria-pressed={drawingWall} onClick={() => setDrawingWall((d) => !d)}>
            {drawingWall ? 'Dibujando muro…' : 'Dibujar muro'}
          </button>
          <p className="muted mt-2">
            {scene.visionMode === 'auto'
              ? 'Visión automática: la niebla se revela sola según lo que cada PJ puede ver.'
              : 'Niebla manual: usa el pincel del panel de niebla.'}
          </p>
          <button
            type="button"
            className="mt-2"
            onClick={() =>
              send({
                type: 'setSceneVisionMode',
                sceneId: scene.id,
                visionMode: scene.visionMode === 'auto' ? 'manual' : 'auto',
              })
            }
          >
            Cambiar a {scene.visionMode === 'auto' ? 'manual' : 'automática'}
          </button>

          {scene.walls.length === 0 ? (
            <p className="muted mt-3">Todavía no hay muros en esta escena.</p>
          ) : (
            <ul className="log mt-3">
              {scene.walls.map((wall) => (
                <li key={wall.id}>
                  <div className="row spread">
                    <span>{wall.kind === 'door' ? 'Puerta' : 'Muro'}</span>
                    <div className="row">
                      {wall.kind === 'door' ? (
                        <button
                          type="button"
                          onClick={() =>
                            send({ type: 'updateWall', sceneId: scene.id, wall: { ...wall, open: !wall.open } })
                          }
                        >
                          {wall.open ? 'Abierta' : 'Cerrada'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            send({ type: 'updateWall', sceneId: scene.id, wall: { ...wall, kind: 'door' } })
                          }
                        >
                          Convertir en puerta
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => send({ type: 'removeWall', sceneId: scene.id, wallId: wall.id })}
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </FloatingPanel>
      ) : null}
    </div>
  );
}

function SceneList({ room, send }: { room: RoomState; send: (event: RoomEvent) => void }) {
  return (
    <div className="panel">
      <h2>Escenas</h2>
      {room.map.scenes.map((scene) => (
        <div className="card" key={scene.id}>
          <div className="card-head">
            <strong>{scene.name}</strong>
            <div className="row">
              {room.map.activeSceneId === scene.id ? (
                <span className="badge">Activa</span>
              ) : (
                <button
                  type="button"
                  onClick={() => send({ type: 'setActiveScene', id: scene.id })}
                >
                  Mostrar a jugadores
                </button>
              )}
              <button type="button" onClick={() => send({ type: 'removeScene', id: scene.id })}>
                Eliminar
              </button>
            </div>
          </div>
          <span className="option-meta">
            {scene.tokens.length} fichas{scene.image === null ? ' · sin imagen' : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

function GridControls({ grid, onChange }: { grid: Grid; onChange: (grid: Grid) => void }) {
  return (
    <div className="panel">
      <h2>Cuadrícula y escala</h2>
      <label htmlFor="grid-mode">Modo</label>
      <select
        id="grid-mode"
        value={grid.mode}
        onChange={(event) =>
          onChange({ ...grid, mode: event.target.value === 'square' ? 'square' : 'none' })
        }
      >
        <option value="none">Sin cuadrícula (teatro de la mente)</option>
        <option value="square">Cuadrícula cuadrada</option>
      </select>

      <div className="grid cols-2 mt-3">
        <div>
          <label htmlFor="grid-size">{grid.mode === 'square' ? 'Tamaño de casilla (px)' : 'Píxeles por pulgada'}</label>
          <input
            id="grid-size"
            type="number"
            min={5}
            max={500}
            value={grid.size}
            onChange={(event) =>
              onChange({ ...grid, size: Math.max(5, Number(event.target.value)) })
            }
          />
        </div>
        <div>
          <label htmlFor="grid-feet">Pies por pulgada</label>
          <input
            id="grid-feet"
            type="number"
            min={1}
            max={100}
            value={grid.feetPerInch}
            onChange={(event) =>
              onChange({ ...grid, feetPerInch: Math.max(1, Number(event.target.value)) })
            }
          />
        </div>
        <div>
          <label htmlFor="grid-x">Desplazamiento X</label>
          <input
            id="grid-x"
            type="number"
            value={grid.offsetX}
            onChange={(event) => onChange({ ...grid, offsetX: Number(event.target.value) })}
          />
        </div>
        <div>
          <label htmlFor="grid-y">Desplazamiento Y</label>
          <input
            id="grid-y"
            type="number"
            value={grid.offsetY}
            onChange={(event) => onChange({ ...grid, offsetY: Number(event.target.value) })}
          />
        </div>
        <div>
          <label htmlFor="grid-color">Color</label>
          <input
            id="grid-color"
            type="color"
            value={grid.color}
            onChange={(event) => onChange({ ...grid, color: event.target.value })}
          />
        </div>
        <div>
          <label htmlFor="grid-line-width">Grosor (px)</label>
          <input
            id="grid-line-width"
            type="number"
            min={1}
            max={10}
            value={grid.lineWidth}
            onChange={(event) =>
              onChange({ ...grid, lineWidth: Math.max(1, Number(event.target.value)) })
            }
          />
        </div>
      </div>
      <button type="button" onClick={() => onChange(DEFAULT_GRID)}>
        Restablecer cuadrícula
      </button>
    </div>
  );
}

interface TokenToolsProps {
  room: RoomState;
  onAdd: (token: Token) => void;
  /** Deploys a bestiary adversary into `room.adversaryInstances` and returns its
   * new instance id, so the caller can place a token for it in the same click. */
  onDeploy: (adversaryId: string, name: string) => string;
}

/**
 * Just the "add" tools — sizing, image, visibility, and adversary stats for the
 * selected token live in the on-map `TokenPopover` instead, so this panel doesn't
 * turn into a single crowded box.
 */
function TokenTools({ room, onAdd, onDeploy }: TokenToolsProps) {
  const characters = Object.entries(room.characters);
  const [query, setQuery] = useState('');

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return [];
    return adversaries
      .filter((a) => a.name.toLowerCase().includes(needle) || a.type.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [query]);

  const base = (name: string, color: string): Omit<Token, 'kind' | 'refId' | 'ownerId'> => ({
    id: nextId('tok'),
    name,
    x: 200,
    y: 200,
    width: 50,
    height: 50,
    rotation: 0,
    hidden: false,
    showRings: false,
    color,
    image: null,
    colorFrame: false,
    visionRadius: 720,
  });

  return (
    <div className="panel">
      <h2>Fichas</h2>

      <h3>Agregar un PJ</h3>
      {characters.length === 0 ? <p className="muted">Todavía no se ha reclamado ningún personaje.</p> : null}
      <div className="row">
        {characters.map(([id, sheet], index) => {
          const owner = room.players.find((p) => p.characterId === id) ?? null;
          return (
            <button
              key={id}
              type="button"
              onClick={() =>
                onAdd({
                  ...base(sheet.character.name ?? 'PJ', tokenColorAt(index)),
                  kind: 'pc',
                  refId: id,
                  // The controlling player may drag their own token.
                  ownerId: owner?.id ?? null,
                })
              }
            >
              {sheet.character.name ?? 'PJ'}
            </button>
          );
        })}
      </div>

      <h3 className="mt-4">Agregar un adversario</h3>
      {room.adversaryInstances.length === 0 ? (
        <p className="muted">Primero despliega adversarios desde el panel del DJ.</p>
      ) : null}
      <div className="row">
        {room.adversaryInstances.map((instance) => (
          <button
            key={instance.instanceId}
            type="button"
            onClick={() =>
              onAdd({
                ...base(instance.name, adversaryTokenColor()),
                kind: 'adversary',
                refId: instance.instanceId,
                ownerId: null,
              })
            }
          >
            {instance.name}
          </button>
        ))}
      </div>

      <h3 className="mt-4">Agregar desde el bestiario</h3>
      <label htmlFor="token-adversary-search">Buscar</label>
      <input
        id="token-adversary-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="limo, matón, dragón…"
      />
      <div className="row">
        {matches.map((adversary) => (
          <button
            key={adversary.id}
            type="button"
            onClick={() => {
              const instanceId = onDeploy(adversary.id, adversary.name);
              onAdd({ ...base(adversary.name, adversaryTokenColor()), kind: 'adversary', refId: instanceId, ownerId: null });
              setQuery('');
            }}
          >
            {adversary.name}
          </button>
        ))}
      </div>

      <p className="muted mt-4">Selecciona una ficha en el mapa para editarla ahí mismo.</p>
    </div>
  );
}
