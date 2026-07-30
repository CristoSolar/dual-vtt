import {
  DEFAULT_GRID,
  type Grid,
  type RoomEvent,
  type RoomState,
  type Token,
} from '@daggerheart/protocol';
import { adversaries } from '@daggerheart/srd-data';
import { useCallback, useMemo, useRef, useState } from 'react';

import { MapCanvas } from '../components/map/MapCanvas.js';
import { uploadMapImage } from '../state/uploadMap.js';
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

/** The tactical map: canvas plus, for the GM, the tools that drive it. */
export function MapRoute({ room, isGameMaster, viewerId, send }: MapRouteProps) {
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [fogBrush, setFogBrush] = useState<{ radius: number; reveal: boolean } | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const scene = useMemo(
    () => room.map.scenes.find((s) => s.id === room.map.activeSceneId) ?? room.map.scenes[0] ?? null,
    [room.map],
  );
  const selected = scene?.tokens.find((t) => t.id === selectedTokenId) ?? null;

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
    try {
      const image = await uploadMapImage(file);
      send({ type: 'setSceneImage', sceneId: scene.id, image });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Upload failed');
    }
  };

  return (
    <section>
      <div className="card-head">
        <div>
          <h1>Map</h1>
          <p className="muted">
            {scene === null
              ? 'No scene yet.'
              : `${scene.name}${scene.grid.mode === 'square' ? ' · grid' : ' · gridless'}`}
          </p>
        </div>
        {isGameMaster ? (
          <div className="row">
            <button
              type="button"
              onClick={() => send({ type: 'addScene', id: nextId('scene'), name: 'New scene' })}
            >
              New scene
            </button>
          </div>
        ) : null}
      </div>

      <div className="map-layout">
        <div className="map-stage">
          {scene === null ? (
            <div className="panel">
              <p className="muted">
                {isGameMaster
                  ? 'Create a scene to start building the map.'
                  : 'The GM has not shared a scene yet.'}
              </p>
            </div>
          ) : (
            <MapCanvas
              scene={scene}
              isGameMaster={isGameMaster}
              viewerId={viewerId}
              width={900}
              height={620}
              selectedTokenId={selectedTokenId}
              onSelectToken={setSelectedTokenId}
              onMoveToken={moveToken}
              fogBrush={fogBrush}
              onPaintFog={paintFog}
              measuring={measuring}
            />
          )}

          <div className="row mt-3">
            <button type="button" aria-pressed={measuring} onClick={() => setMeasuring((m) => !m)}>
              {measuring ? 'Measuring — drag A to B' : 'Measure range'}
            </button>
            {selected !== null ? (
              <button
                type="button"
                aria-pressed={selected.showRings}
                onClick={() => updateSelected({ showRings: !selected.showRings })}
              >
                {selected.showRings ? 'Hide range rings' : 'Show range rings'}
              </button>
            ) : null}
            <span className="muted">Scroll to zoom · drag the background to pan</span>
          </div>
        </div>

        {isGameMaster && scene !== null ? (
          <aside>
            <SceneList room={room} send={send} />

            <div className="panel">
              <h2>Battle map</h2>
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file !== undefined) void onUpload(file);
                }}
              />
              {uploadError !== null ? <p className="field-error">{uploadError}</p> : null}
              {scene.image === null ? (
                <p className="muted">No image yet.</p>
              ) : (
                <p className="muted">
                  {scene.image.width}×{scene.image.height}
                </p>
              )}
            </div>

            <GridControls
              grid={scene.grid}
              onChange={(grid) => send({ type: 'setSceneGrid', sceneId: scene.id, grid })}
            />

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

            <div className="panel">
              <h2>Fog of war</h2>
              <button
                type="button"
                aria-pressed={scene.fog.enabled}
                onClick={() =>
                  send({ type: 'setFogEnabled', sceneId: scene.id, enabled: !scene.fog.enabled })
                }
              >
                {scene.fog.enabled ? 'Fog on' : 'Fog off'}
              </button>
              <div className="row mt-3">
                <button
                  type="button"
                  aria-pressed={fogBrush?.reveal === true}
                  onClick={() =>
                    setFogBrush(fogBrush?.reveal === true ? null : { radius: 120, reveal: true })
                  }
                >
                  Reveal brush
                </button>
                <button
                  type="button"
                  aria-pressed={fogBrush?.reveal === false}
                  onClick={() =>
                    setFogBrush(fogBrush?.reveal === false ? null : { radius: 120, reveal: false })
                  }
                >
                  Hide brush
                </button>
              </div>
              <p className="muted">
                Players see only revealed areas — the rest is never sent to them.
              </p>
            </div>
          </aside>
        ) : null}
      </div>
    </section>
  );
}

function SceneList({ room, send }: { room: RoomState; send: (event: RoomEvent) => void }) {
  return (
    <div className="panel">
      <h2>Scenes</h2>
      {room.map.scenes.map((scene) => (
        <div className="card" key={scene.id}>
          <div className="card-head">
            <strong>{scene.name}</strong>
            <div className="row">
              {room.map.activeSceneId === scene.id ? (
                <span className="badge">Active</span>
              ) : (
                <button
                  type="button"
                  onClick={() => send({ type: 'setActiveScene', id: scene.id })}
                >
                  Show players
                </button>
              )}
              <button type="button" onClick={() => send({ type: 'removeScene', id: scene.id })}>
                Delete
              </button>
            </div>
          </div>
          <span className="option-meta">
            {scene.tokens.length} tokens{scene.image === null ? ' · no image' : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

function GridControls({ grid, onChange }: { grid: Grid; onChange: (grid: Grid) => void }) {
  return (
    <div className="panel">
      <h2>Grid &amp; scale</h2>
      <label htmlFor="grid-mode">Mode</label>
      <select
        id="grid-mode"
        value={grid.mode}
        onChange={(event) =>
          onChange({ ...grid, mode: event.target.value === 'square' ? 'square' : 'none' })
        }
      >
        <option value="none">Gridless (theater of the mind)</option>
        <option value="square">Square grid</option>
      </select>

      <div className="grid cols-2 mt-3">
        <div>
          <label htmlFor="grid-size">{grid.mode === 'square' ? 'Square size (px)' : 'Pixels per inch'}</label>
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
          <label htmlFor="grid-feet">Feet per inch</label>
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
          <label htmlFor="grid-x">Offset X</label>
          <input
            id="grid-x"
            type="number"
            value={grid.offsetX}
            onChange={(event) => onChange({ ...grid, offsetX: Number(event.target.value) })}
          />
        </div>
        <div>
          <label htmlFor="grid-y">Offset Y</label>
          <input
            id="grid-y"
            type="number"
            value={grid.offsetY}
            onChange={(event) => onChange({ ...grid, offsetY: Number(event.target.value) })}
          />
        </div>
      </div>
      <button type="button" onClick={() => onChange(DEFAULT_GRID)}>
        Reset grid
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
  });

  return (
    <div className="panel">
      <h2>Tokens</h2>

      <h3>Add a PC</h3>
      {characters.length === 0 ? <p className="muted">No characters claimed yet.</p> : null}
      <div className="row">
        {characters.map(([id, sheet], index) => {
          const owner = room.players.find((p) => p.characterId === id) ?? null;
          return (
            <button
              key={id}
              type="button"
              onClick={() =>
                onAdd({
                  ...base(sheet.character.name ?? 'PC', tokenColorAt(index)),
                  kind: 'pc',
                  refId: id,
                  // The controlling player may drag their own token.
                  ownerId: owner?.id ?? null,
                })
              }
            >
              {sheet.character.name ?? 'PC'}
            </button>
          );
        })}
      </div>

      <h3 className="mt-4">Add an adversary</h3>
      {room.adversaryInstances.length === 0 ? (
        <p className="muted">Field adversaries from the GM panel first.</p>
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
        onClick={() => onAdd({ ...base('Marker', markerTokenColor()), kind: 'marker', refId: null, ownerId: null })}
      >
        Add marker
      </button>

      {selected === null ? (
        <p className="muted mt-4">
          Select a token to edit it.
        </p>
      ) : (
        <fieldset className="mt-4">
          <legend>{selected.name}</legend>
          <div className="grid cols-2">
            <div>
              <label htmlFor="token-size">Size</label>
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
              <label htmlFor="token-rotation">Rotation</label>
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
              {selected.hidden ? 'GM only' : 'Visible to players'}
            </button>
            <button type="button" onClick={onRemove}>
              Delete token
            </button>
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
        HP {sheet.hpMarked}/{sheet.character.hpSlots} · Stress {sheet.stressMarked}/
        {sheet.character.stressSlots} · Evasion {sheet.character.evasion}
      </p>
    );
  }

  if (token.kind === 'adversary' && token.refId !== null) {
    const instance = room.adversaryInstances.find((a) => a.instanceId === token.refId);
    if (instance === undefined) return null;
    const stat = adversaries.find((a) => a.id === instance.adversaryId);
    return (
      <p className="muted">
        HP {instance.hpMarked}/{stat?.hp ?? '?'} · Stress {instance.stressMarked}/
        {stat?.stress ?? '?'} · Difficulty {stat?.difficulty ?? '?'}
      </p>
    );
  }

  return null;
}
