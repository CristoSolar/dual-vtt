import {
  DEFAULT_GRID,
  type Grid,
  type RoomEvent,
  type RoomState,
  type Token,
} from '@daggerheart/protocol';
import { adversaries } from '@daggerheart/srd-data';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { FloatingPanel } from '../components/map/FloatingPanel.js';
import { MapCanvas } from '../components/map/MapCanvas.js';
import { MapSheetPanel } from '../components/map/MapSheetPanel.js';
import type { PanelLayout } from '../state/floatingPanel.js';
import { useElementSize } from '../state/useElementSize.js';
import { uploadImage } from '../state/uploadMap.js';
import {
  adversaryTokenColor,
  markerTokenColor,
  tokenColorAt,
} from '../styles/canvasTokens.js';

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

type PanelId = 'scenes' | 'battlemap' | 'grid' | 'tokens' | 'fog' | 'sheet';

const PANEL_TITLES: Record<PanelId, string> = {
  scenes: 'Escenas',
  battlemap: 'Mapa de batalla',
  grid: 'Cuadrícula y escala',
  tokens: 'Fichas',
  fog: 'Niebla de guerra',
  sheet: 'Hoja de personaje',
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
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
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

  const toolButton = (id: PanelId, glyph: string, label: string) => (
    <button
      type="button"
      key={id}
      className="map-rail-button"
      aria-pressed={panels[id].open}
      aria-label={label}
      title={label}
      onClick={() => togglePanel(id)}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );

  return (
    <div className="map-fullscreen">
      <div className="map-scene-bar">
        <span className="map-scene-name">
          {scene === null
            ? 'Todavía no hay escena'
            : `${scene.name}${scene.grid.mode === 'square' ? ' · cuadrícula' : ' · sin cuadrícula'}`}
        </span>
        {isGameMaster ? (
          <button
            type="button"
            onClick={() => send({ type: 'addScene', id: nextId('scene'), name: 'Nueva escena' })}
          >
            Nueva escena
          </button>
        ) : null}
      </div>

      {isGameMaster || mySheet !== null ? (
        <div className="map-rail">
          {isGameMaster ? (
            <>
              {toolButton('scenes', '🗺', 'Escenas')}
              {toolButton('battlemap', '🖼', 'Mapa de batalla')}
              {toolButton('grid', '▦', 'Cuadrícula y escala')}
              {toolButton('tokens', '🧙', 'Fichas')}
              {toolButton('fog', '🌫', 'Niebla de guerra')}
              <button
                type="button"
                className="map-rail-button"
                aria-pressed={measuring}
                aria-label="Medir distancia"
                title="Medir distancia"
                onClick={() => setMeasuring((m) => !m)}
              >
                <span aria-hidden="true">📏</span>
              </button>
            </>
          ) : (
            toolButton('sheet', '📜', 'Hoja de personaje')
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

      {!isGameMaster && viewerId !== null && mySheet !== null && panels.sheet.open ? (
        <FloatingPanel
          title={PANEL_TITLES.sheet}
          layout={panels.sheet}
          onLayoutChange={(l) => movePanel('sheet', l)}
          onFocus={() => focusPanel('sheet')}
          onClose={() => closePanel('sheet')}
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
            sceneId={scene.id}
            selected={selected}
            onAdd={(token) => send({ type: 'addToken', sceneId: scene.id, token })}
            onUpdate={updateSelected}
            onRemove={() => {
              if (selected === null) return;
              send({ type: 'removeToken', sceneId: scene.id, tokenId: selected.id });
              setSelectedTokenId(null);
            }}
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
      </div>
      <button type="button" onClick={() => onChange(DEFAULT_GRID)}>
        Restablecer cuadrícula
      </button>
    </div>
  );
}

interface TokenToolsProps {
  room: RoomState;
  sceneId: string;
  selected: Token | null;
  onAdd: (token: Token) => void;
  onUpdate: (patch: Partial<Token>) => void;
  onRemove: () => void;
}

function TokenTools({ room, selected, onAdd, onUpdate, onRemove }: TokenToolsProps) {
  const characters = Object.entries(room.characters);

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
  });

  const [imageError, setImageError] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const onUploadTokenImage = async (file: File) => {
    setImageError(null);
    setUploadingImage(true);
    try {
      const image = await uploadImage(file);
      onUpdate({ image });
    } catch (error) {
      setImageError(error instanceof Error ? error.message : 'Falló la subida');
    } finally {
      setUploadingImage(false);
    }
  };

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

      <button
        type="button"
        className="mt-3"
        onClick={() => onAdd({ ...base('Marcador', markerTokenColor()), kind: 'marker', refId: null, ownerId: null })}
      >
        Agregar marcador
      </button>

      {selected === null ? (
        <p className="muted mt-4">
          Selecciona una ficha para editarla.
        </p>
      ) : (
        <fieldset className="mt-4">
          <legend>{selected.name}</legend>
          <div className="grid cols-2">
            <div>
              <label htmlFor="token-size">Tamaño</label>
              <input
                id="token-size"
                type="number"
                min={10}
                max={500}
                value={selected.width}
                onChange={(event) => {
                  const size = Math.max(10, Number(event.target.value));
                  onUpdate({ width: size, height: size });
                }}
              />
            </div>
            <div>
              <label htmlFor="token-rotation">Rotación</label>
              <input
                id="token-rotation"
                type="number"
                min={-360}
                max={360}
                value={selected.rotation}
                onChange={(event) => onUpdate({ rotation: Number(event.target.value) })}
              />
            </div>
          </div>
          <div className="row">
            <button
              type="button"
              aria-pressed={selected.hidden}
              onClick={() => onUpdate({ hidden: !selected.hidden })}
            >
              {selected.hidden ? 'Solo DJ' : 'Visible para jugadores'}
            </button>
            <button type="button" onClick={onRemove}>
              Eliminar ficha
            </button>
          </div>
          <div className="mt-3">
            <label htmlFor="token-image">Imagen</label>
            <input
              id="token-image"
              type="file"
              disabled={uploadingImage}
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file !== undefined) void onUploadTokenImage(file);
              }}
            />
            {uploadingImage ? <p className="muted">Subiendo…</p> : null}
            {imageError !== null ? <p className="field-error">{imageError}</p> : null}
            {selected.image !== null ? (
              <button type="button" onClick={() => onUpdate({ image: null })}>
                Quitar imagen
              </button>
            ) : null}
          </div>
        </fieldset>
      )}

      {selected !== null ? <TokenStatus room={room} token={selected} /> : null}
    </div>
  );
}

/** The live numbers behind a token, read from the room rather than duplicated. */
function TokenStatus({ room, token }: { room: RoomState; token: Token }) {
  if (token.kind === 'pc' && token.refId !== null) {
    const sheet = room.characters[token.refId];
    if (sheet === undefined) return null;
    return (
      <p className="muted">
        PV {sheet.hpMarked}/{sheet.character.hpSlots} · Estrés {sheet.stressMarked}/
        {sheet.character.stressSlots} · Evasión {sheet.character.evasion}
      </p>
    );
  }

  if (token.kind === 'adversary' && token.refId !== null) {
    const instance = room.adversaryInstances.find((a) => a.instanceId === token.refId);
    if (instance === undefined) return null;
    const stat = adversaries.find((a) => a.id === instance.adversaryId);
    return (
      <p className="muted">
        PV {instance.hpMarked}/{stat?.hp ?? '?'} · Estrés {instance.stressMarked}/
        {stat?.stress ?? '?'} · Dificultad {stat?.difficulty ?? '?'}
      </p>
    );
  }

  return null;
}
