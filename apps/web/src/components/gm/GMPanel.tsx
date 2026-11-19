import {
  MAX_TABLES,
  MAX_TRACKS,
  outcomeTone,
  type AdversaryInstance,
  type Countdown,
  type RollTable,
  type RoomEvent,
  type RoomState,
  type Visibility,
} from '@daggerheart/protocol';
import {
  MAX_FEAR,
  MOVES_PER_REST,
  battlePointBudget,
  battlePointsSpent,
  mustRestLong,
  type AdversaryType,
  type BattlePointAdjustments,
} from '@daggerheart/rules';
import {
  formatDice,
  formatModifier,
  srd,
  type Adversary,
  type StatBlockFeature,
} from '@daggerheart/srd-data';
import { useId, useMemo, useState, type ChangeEvent } from 'react';

import { t, type MessageKey } from '../../i18n/index.js';
import { chatRecipients, mergeFeed } from '../../state/feed.js';
import { encounterEvents } from '../../state/gmHome.js';
import { label as prettify } from '../../state/selectors.js';
import { adversaryTargetOf, newestDamageIds, pcTargetOf } from '../../state/targets.js';
import { uploadAudio } from '../../state/uploadMap.js';
import { SectionHead } from '../SectionHead.js';
import { ChatBox, DiceLine, EffectLine, MessageLine, PrivateBadge } from '../sheet/RollLogPanel.js';

interface GMPanelProps {
  room: RoomState;
  campaignName: string;
  /** The session token, for uploading playlist tracks. */
  authToken: string | null;
  send: (event: RoomEvent) => void;
}

let counter = 0;
const nextId = (prefix: string) => {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
};

/**
 * Group action rolls (SRD 2.0 p.48). The GM opens one and names the lead; every
 * other PC who rolls while it is open is collaborating, and their reaction rolls
 * shift the lead roll by one each way.
 */
function GroupAction({ room, send }: { room: RoomState; send: (event: RoomEvent) => void }) {
  const party = room.players.filter((player) => player.characterId !== null);
  const [lead, setLead] = useState(party[0]?.characterId ?? '');
  const open = room.groupAction;
  const nameOf = (id: string) =>
    room.players.find((player) => player.characterId === id)?.name ?? id;

  if (party.length < 2) return null;

  return (
    <div className="panel">
      <SectionHead>{t('gm.groupAction.title')}</SectionHead>
      <p className="muted">{t('gm.groupAction.hint')}</p>
      {open === null ? (
        <div className="row">
          <label htmlFor="group-lead">{t('gm.groupAction.lead')}</label>
          <select id="group-lead" value={lead} onChange={(event) => setLead(event.target.value)}>
            {party.map((player) => (
              <option key={player.id} value={player.characterId ?? ''}>
                {player.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={lead === ''}
            onClick={() => send({ type: 'startGroupAction', leadCharacterId: lead })}
          >
            {t('gm.groupAction.start')}
          </button>
        </div>
      ) : (
        <div className="row">
          <p>
            {t('gm.groupAction.open', {
              name: nameOf(open.leadCharacterId),
              count: Object.keys(open.reactions).length,
            })}
          </p>
          <button type="button" onClick={() => send({ type: 'cancelGroupAction' })}>
            {t('gm.groupAction.cancel')}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Downtime is the GM's to open and close: the party rests together, the GM is paid
 * in Fear for it, and each PC then spends their own two moves from their sheet.
 */
function Downtime({ room, send }: { room: RoomState; send: (event: RoomEvent) => void }) {
  const resting = room.rest !== null;
  const owesLong = mustRestLong(room.consecutiveShortRests);
  const spent = Object.values(room.rest?.movesLeft ?? {}).reduce(
    (total, left) => total + (MOVES_PER_REST - left),
    0,
  );
  const budget = Object.keys(room.rest?.movesLeft ?? {}).length * MOVES_PER_REST;

  return (
    <div className="panel">
      <SectionHead>{t('gm.downtime.title')}</SectionHead>
      {resting ? (
        <>
          <p className="muted">
            {t(room.rest?.kind === 'long' ? 'gm.downtime.inLong' : 'gm.downtime.inShort', {
              spent,
              budget,
            })}
          </p>
          <button type="button" onClick={() => send({ type: 'endRest' })}>
            {t('gm.downtime.end')}
          </button>
        </>
      ) : (
        <>
          <p className="muted">
            {owesLong
              ? t('gm.downtime.owesLong')
              : t('gm.downtime.shortsTaken', { count: room.consecutiveShortRests })}
          </p>
          <div className="row">
            <button
              type="button"
              disabled={owesLong}
              onClick={() => send({ type: 'beginRest', kind: 'short' })}
            >
              {t('gm.downtime.beginShort')}
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => send({ type: 'beginRest', kind: 'long' })}
            >
              {t('gm.downtime.beginLong')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The GM's screen. Every control emits an intent; the server validates it, applies
 * it, and broadcasts the result — nothing here changes state directly.
 */
export function GMPanel({ room, campaignName, authToken, send }: GMPanelProps) {
  return (
    <section className="gm-scope">
      <p className="gm-banner">
        <GmMark />
        {t('gm.viewerBanner')}
      </p>
      <div className="card-head">
        <div>
          <h1>{t('app.gmPanel')}</h1>
          <p className="muted">{campaignName}</p>
        </div>
      </div>

      <div className="sheet-layout">
        <div>
          <FearTrack fear={room.fear} send={send} />
          <Downtime room={room} send={send} />
          <GroupAction room={room} send={send} />
          <PartyOverview room={room} send={send} />
          <SpotlightTracker room={room} send={send} />
          <Countdowns countdowns={room.countdowns} send={send} />
          <BattlePoints room={room} />
          <AdversaryPools room={room} send={send} />
          <Hazards send={send} />
          <Tables room={room} send={send} />
          <Adversaries room={room} send={send} />
          <EnvironmentPicker activeEnvironment={room.activeEnvironment} send={send} />
          <Playlist audio={room.audio} authToken={authToken} send={send} />
        </div>

        <aside>
          <Presence room={room} />
          <SharedRollLog room={room} send={send} />
        </aside>
      </div>
    </section>
  );
}

/**
 * The GM's music. Playing a track only names it and whether it loops; the server
 * stamps when it started, and every tab seeks to that. The table volume is sent
 * when the slider is let go, not on every step of the drag.
 */
function Playlist({
  audio,
  authToken,
  send,
}: {
  audio: RoomState['audio'];
  authToken: string | null;
  send: (event: RoomEvent) => void;
}) {
  const [loop, setLoop] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [volumeDraft, setVolumeDraft] = useState<number | null>(null);
  const { tracks, playing } = audio;

  const onUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file === undefined) return;
    setUploadError(null);
    setUploading(true);
    try {
      const url = await uploadAudio(file, authToken);
      const stem = file.name.replace(/\.[^.]+$/, '').trim();
      const name = (stem === '' ? file.name : stem).slice(0, 80);
      send({ type: 'addTrack', track: { id: nextId('track'), name, url } });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : t('map.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const commitVolume = () => {
    if (volumeDraft === null) return;
    send({ type: 'setTrackVolume', volume: volumeDraft });
    setVolumeDraft(null);
  };

  return (
    <div className="panel">
      <SectionHead>{t('gm.playlist.title')}</SectionHead>
      <p className="muted">{t('gm.playlist.hint')}</p>
      {tracks.length === 0 ? <p className="muted">{t('gm.playlist.empty')}</p> : null}
      {tracks.map((track) => {
        const isPlaying = playing?.trackId === track.id;
        return (
          <div className="card-head" key={track.id}>
            <strong>
              {track.name}{' '}
              {isPlaying ? <span className="badge">{t('gm.playlist.playing')}</span> : null}
            </strong>
            <div className="row">
              {isPlaying ? (
                <button type="button" onClick={() => send({ type: 'stopTrack' })}>
                  {t('gm.playlist.stop')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => send({ type: 'playTrack', trackId: track.id, loop })}
                >
                  {t('gm.playlist.play')}
                </button>
              )}
              <button type="button" onClick={() => send({ type: 'removeTrack', id: track.id })}>
                {t('gm.remove')}
              </button>
            </div>
          </div>
        );
      })}
      <div className="row mt-3">
        <label>
          <input
            type="checkbox"
            checked={loop}
            onChange={(event) => setLoop(event.target.checked)}
          />{' '}
          {t('gm.playlist.loop')}
        </label>
        <label>
          {t('gm.playlist.volume')}{' '}
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            disabled={playing === null}
            value={volumeDraft ?? playing?.volume ?? 1}
            onChange={(event) => setVolumeDraft(Number(event.target.value))}
            onPointerUp={commitVolume}
            onKeyUp={commitVolume}
            onBlur={commitVolume}
          />
        </label>
      </div>
      <div className="row mt-3">
        <label htmlFor="playlist-upload">{t('gm.playlist.upload')}</label>
        <input
          id="playlist-upload"
          type="file"
          accept="audio/ogg,audio/mpeg,.ogg,.mp3"
          disabled={uploading || tracks.length >= MAX_TRACKS}
          onChange={(event) => void onUpload(event)}
        />
        {uploading ? <span className="muted">{t('map.uploading')}</span> : null}
      </div>
      {uploadError === null ? null : <p className="field-error">{uploadError}</p>}
    </div>
  );
}

/** A small mask mark for the GM banner, drawn inline rather than shipped as an icon. */
function GmMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path
        d="M2 4h14v4a6 6 0 0 1-7 6 6 6 0 0 1-7-6z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <circle cx="6.5" cy="8" r="1.1" fill="currentColor" />
      <circle cx="11.5" cy="8" r="1.1" fill="currentColor" />
    </svg>
  );
}

function FearTrack({ fear, send }: { fear: number; send: (event: RoomEvent) => void }) {
  return (
    <div className="panel">
      <SectionHead>{t('sheet.roll.fearLabel')}</SectionHead>
      <div className="tracker-head">
        <span className="muted">{t('gm.fearPool')}</span>
        <span className="muted">
          {fear} / {MAX_FEAR}
        </span>
      </div>
      <ul className="pips">
        {Array.from({ length: MAX_FEAR }, (_, index) => {
          const filled = index < fear;
          const description = t('gm.fearAriaLabel', { n: index + 1, max: MAX_FEAR });
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
      <p className="muted">{t('gm.fearHint')}</p>
    </div>
  );
}

/**
 * The optional Spotlight Tracker (SRD 2.0 p.47). Off by default, because the SRD
 * prints it as a tool for groups that want a more traditional action economy.
 * Tokens are spent by the reducer on each action roll, not by anything here.
 */
function SpotlightTracker({ room, send }: { room: RoomState; send: (event: RoomEvent) => void }) {
  const tracker = room.spotlightTokens;
  const nameOf = (id: string) =>
    room.players.find((player) => player.characterId === id)?.name ?? id;

  return (
    <div className="panel">
      <SectionHead>{t('gm.spotlightTokens.title')}</SectionHead>
      {tracker === null ? (
        <>
          <p className="muted">{t('gm.spotlightTokens.hint')}</p>
          <button
            type="button"
            onClick={() => send({ type: 'setSpotlightTracker', tokensPerPlayer: 3 })}
          >
            {t('gm.spotlightTokens.turnOn')}
          </button>
        </>
      ) : (
        <>
          <ul>
            {Object.entries(tracker.left).map(([id, left]) => (
              <li key={id}>
                {t('gm.spotlightTokens.left', {
                  name: nameOf(id),
                  left,
                  total: tracker.perPlayer,
                })}
              </li>
            ))}
          </ul>
          <div className="row">
            <button
              type="button"
              onClick={() =>
                send({ type: 'setSpotlightTracker', tokensPerPlayer: tracker.perPlayer })
              }
            >
              {t('gm.spotlightTokens.refill')}
            </button>
            <button
              type="button"
              onClick={() => send({ type: 'setSpotlightTracker', tokensPerPlayer: null })}
            >
              {t('gm.spotlightTokens.turnOff')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function PartyOverview({
  room,
  send,
}: {
  room: RoomState;
  send: (event: RoomEvent) => void;
}) {
  const entries = Object.entries(room.characters);

  return (
    <div className="panel">
      <SectionHead>{t('gm.party.title')}</SectionHead>
      {entries.length === 0 ? (
        <p className="muted">{t('gm.party.none')}</p>
      ) : (
        <div className="grid cols-2">
          {entries.map(([id, sheet]) => {
            const player = room.players.find((p) => p.characterId === id);
            const spotlit = room.spotlight === (player?.id ?? id);
            return (
              <div className="card" key={id}>
                <div className="card-head">
                  <strong>{sheet.character.name ?? t('gm.party.unnamed')}</strong>
                  <button
                    type="button"
                    aria-pressed={spotlit}
                    onClick={() =>
                      send({ type: 'setSpotlight', spotlight: spotlit ? null : player?.id ?? id })
                    }
                  >
                    {spotlit ? t('gm.party.spotlit') : t('gm.party.giveSpotlight')}
                  </button>
                </div>
                <span className="option-meta">
                  {t('gm.party.meta', {
                    name: player?.name ?? t('gm.party.unclaimed'),
                    level: sheet.character.level,
                  })}
                </span>
                <p className="card-text">
                  {t('gm.party.stats1', {
                    hpMarked: sheet.hpMarked,
                    hpSlots: sheet.character.hpSlots,
                    stressMarked: sheet.stressMarked,
                    stressSlots: sheet.character.stressSlots,
                    hope: sheet.hope,
                    armorMarked: sheet.armorSlotsMarked,
                    armorScore: sheet.character.armorScore,
                  })}
                  <br />
                  {t('gm.party.stats2', {
                    evasion: sheet.character.evasion,
                    major: sheet.character.major,
                    severe: sheet.character.severe,
                  })}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Countdowns({
  countdowns,
  send,
}: {
  countdowns: readonly Countdown[];
  send: (event: RoomEvent) => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Countdown['kind']>('standard');
  const [loop, setLoop] = useState<Countdown['loop']>('none');
  const [startingValue, setStartingValue] = useState(4);

  return (
    <div className="panel">
      <SectionHead>{t('gm.countdowns.title')}</SectionHead>

      {countdowns.length === 0 ? <p className="muted">{t('gm.countdowns.none')}</p> : null}
      {countdowns.map((countdown) => (
        <div className="card" key={countdown.id}>
          <div className="card-head">
            <strong>
              {countdown.name}{' '}
              <span className="muted">
                {prettify(countdown.kind)}
                {countdown.loop === 'none' ? '' : ` · ${prettify(countdown.loop)}`}
              </span>
            </strong>
            <div className="row">
              <span className="stat-value">{countdown.value}</span>
              <button
                type="button"
                aria-label={t('gm.countdowns.advanceAria', { name: countdown.name })}
                onClick={() => send({ type: 'advanceCountdown', id: countdown.id, amount: 1 })}
              >
                −1
              </button>
              <button
                type="button"
                aria-label={t('gm.countdowns.backOffAria', { name: countdown.name })}
                onClick={() =>
                  send({
                    type: 'setCountdownValue',
                    id: countdown.id,
                    value: Math.min(99, countdown.value + 1),
                  })
                }
              >
                +1
              </button>
              <button
                type="button"
                disabled={countdown.value === 0}
                onClick={() =>
                  send({ type: 'advanceCountdown', id: countdown.id, amount: countdown.value })
                }
              >
                {t('gm.countdowns.triggerNow')}
              </button>
              <button
                type="button"
                disabled={countdown.value === countdown.startingValue && !countdown.triggered}
                onClick={() =>
                  send({
                    type: 'setCountdownValue',
                    id: countdown.id,
                    value: countdown.startingValue,
                  })
                }
              >
                {t('gm.countdowns.reset')}
              </button>
              <button
                type="button"
                onClick={() => send({ type: 'removeCountdown', id: countdown.id })}
              >
                {t('gm.remove')}
              </button>
            </div>
          </div>
          {countdown.triggered ? <span className="badge warn">{t('gm.countdowns.triggered')}</span> : null}
          {countdown.kind === 'progress' || countdown.kind === 'consequence' ? (
            <p className="card-text">{t('gm.countdowns.autoAdvanceHint')}</p>
          ) : null}
          {countdown.kind === 'longTerm' ? (
            <p className="card-text">{t('gm.countdowns.longTermHint')}</p>
          ) : null}
        </div>
      ))}

      <fieldset>
        <legend>{t('gm.countdowns.newLegend')}</legend>
        <div className="grid cols-2">
          <div>
            <label htmlFor="cd-name">{t('gm.countdowns.nameLabel')}</label>
            <input id="cd-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label htmlFor="cd-start">{t('gm.countdowns.startingValueLabel')}</label>
            <input
              id="cd-start"
              type="number"
              min={1}
              value={startingValue}
              onChange={(e) => setStartingValue(Math.max(1, Number(e.target.value)))}
            />
          </div>
          <div>
            <label htmlFor="cd-kind">{t('gm.countdowns.kindLabel')}</label>
            <select
              id="cd-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as Countdown['kind'])}
            >
              <option value="standard">{t('gm.countdowns.kindStandard')}</option>
              <option value="progress">{t('gm.countdowns.kindProgress')}</option>
              <option value="consequence">{t('gm.countdowns.kindConsequence')}</option>
              <option value="longTerm">{t('gm.countdowns.kindLongTerm')}</option>
            </select>
          </div>
          <div>
            <label htmlFor="cd-loop">{t('gm.countdowns.loopLabel')}</label>
            <select
              id="cd-loop"
              value={loop}
              onChange={(e) => setLoop(e.target.value as Countdown['loop'])}
            >
              <option value="none">{t('gm.countdowns.loopNone')}</option>
              <option value="loop">{t('gm.countdowns.loopLoop')}</option>
              <option value="increasing">{t('gm.countdowns.loopIncreasing')}</option>
              <option value="decreasing">{t('gm.countdowns.loopDecreasing')}</option>
            </select>
          </div>
        </div>
        <button
          type="button"
          disabled={name.trim() === ''}
          onClick={() => {
            send({
              type: 'addCountdown',
              id: nextId('cd'),
              name: name.trim(),
              kind,
              startingValue,
              loop,
            });
            setName('');
          }}
        >
          {t('gm.countdowns.add')}
        </button>
      </fieldset>

      <button type="button" onClick={() => send({ type: 'advanceCountdownsForRest', amount: 1 })}>
        {t('gm.countdowns.advanceLongTerm')}
      </button>
    </div>
  );
}

/**
 * One feature off a stat block, with the button that uses it.
 *
 * A feature's own text says what it costs, so the Fear is typed rather than
 * guessed; an Evolution is one-shot and the button says so once it is spent.
 */
function FeatureRow({
  feature,
  instance,
  send,
}: {
  feature: StatBlockFeature;
  instance: AdversaryInstance;
  send: (event: RoomEvent) => void;
}) {
  const [fearCost, setFearCost] = useState(feature.costsFear ? 1 : 0);
  const [visibility, setVisibility] = useState<Visibility>('public');
  const spent = feature.type === 'evolution' && instance.usedFeatures.includes(feature.name);

  return (
    <div className="card-text">
      <p>
        <strong>
          {feature.name} — {prettify(feature.type)}
          {feature.costsFear ? t('gm.fearSuffix') : ''}:
        </strong>{' '}
        {feature.text}
      </p>
      <div className="row">
        {feature.costsFear ? (
          <>
            <label htmlFor={`fear-${instance.instanceId}-${feature.name}`}>
              {t('gm.adversaries.featureFear')}
            </label>
            <input
              id={`fear-${instance.instanceId}-${feature.name}`}
              type="number"
              min={0}
              max={MAX_FEAR}
              value={fearCost}
              onChange={(event) =>
                setFearCost(Math.max(0, Math.min(MAX_FEAR, Number(event.target.value) || 0)))
              }
            />
          </>
        ) : null}
        <button
          type="button"
          disabled={spent}
          onClick={() =>
            send({
              type: 'useAdversaryFeature',
              instanceId: instance.instanceId,
              featureName: feature.name,
              fearCost,
              visibility,
            })
          }
        >
          {spent ? t('gm.adversaries.featureSpent') : t('gm.adversaries.useFeature')}
        </button>
        <PrivateToggle value={visibility} onChange={setVisibility} />
      </div>
    </div>
  );
}

/**
 * The GM's dice for one adversary. Attacks used to be rolled off-app while every
 * player's roll was audited; these put both sides in the same log.
 */
function AttackControls({
  room,
  instance,
  stat,
  send,
}: {
  room: RoomState;
  instance: AdversaryInstance;
  stat: Adversary;
  send: (event: RoomEvent) => void;
}) {
  /** Null until the GM picks one: until then it follows the GM's PC target on the map. */
  const [picked, setPicked] = useState<string | null>(null);
  const [swing, setSwing] = useState<'none' | 'advantage' | 'disadvantage'>('none');
  const [experience, setExperience] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('public');

  const targets = room.players.filter((player) => player.characterId !== null);
  const aimedAt = pcTargetOf(room, room.gm.id);
  const targetId =
    picked ?? (targets.some((player) => player.characterId === aimedAt) ? aimedAt ?? '' : '');

  return (
    <div className="mt-2">
      <div className="row">
        <select value={targetId} onChange={(event) => setPicked(event.target.value)}>
          <option value="">{t('gm.adversaries.noTarget')}</option>
          {targets.map((player) => (
            <option key={player.id} value={player.characterId ?? ''}>
              {player.name}
            </option>
          ))}
        </select>

        <select
          value={swing}
          onChange={(event) =>
            setSwing(
              event.target.value === 'advantage'
                ? 'advantage'
                : event.target.value === 'disadvantage'
                  ? 'disadvantage'
                  : 'none',
            )
          }
        >
          <option value="none">{t('gm.adversaries.straight')}</option>
          <option value="advantage">{t('gm.adversaries.withAdvantage')}</option>
          <option value="disadvantage">{t('gm.adversaries.withDisadvantage')}</option>
        </select>

        {stat.experiences.length > 0 ? (
          <select value={experience} onChange={(event) => setExperience(event.target.value)}>
            <option value="">{t('gm.adversaries.noExperience')}</option>
            {stat.experiences.map((known) => (
              <option key={known.name} value={known.name}>
                {known.name} {formatModifier(known.modifier)} ({t('gm.adversaries.costsFear')})
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <div className="row mt-2">
        <button
          type="button"
          className="btn-primary"
          onClick={() =>
            send({
              type: 'rollAdversaryAttack',
              instanceId: instance.instanceId,
              advantage: swing === 'advantage',
              disadvantage: swing === 'disadvantage',
              visibility,
              ...(targetId === '' ? {} : { targetId }),
              ...(experience === '' ? {} : { experience }),
            })
          }
        >
          {t('gm.adversaries.rollAttack')}
        </button>
        <button
          type="button"
          onClick={() =>
            send({
              type: 'rollAdversaryDamage',
              instanceId: instance.instanceId,
              critical: false,
              visibility,
            })
          }
        >
          {t('gm.adversaries.rollDamage', {
            // Minions deal flat damage with no dice, which formatDice cannot take.
            damage:
              stat.standardAttack.damage.die === null
                ? String(stat.standardAttack.damage.modifier)
                : formatDice({ ...stat.standardAttack.damage, die: stat.standardAttack.damage.die }),
          })}
        </button>
        <button
          type="button"
          onClick={() =>
            send({
              type: 'rollAdversaryDamage',
              instanceId: instance.instanceId,
              critical: true,
              visibility,
            })
          }
        >
          {t('gm.adversaries.rollCriticalDamage')}
        </button>
        <PrivateToggle value={visibility} onChange={setVisibility} />
      </div>
    </div>
  );
}

/**
 * Fate rolls and the printed hazards (SRD 2.0 p.92), plus the per-scene Fear budget
 * the SRD suggests. Nothing here is applied to anyone: it rolls a number into the
 * shared log and leaves the adjudication to the GM, which is how the SRD prints it.
 */
function Hazards({ send }: { send: (event: RoomEvent) => void }) {
  const [label, setLabel] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('public');
  const kinds = ['fate', 'fallVeryClose', 'fallClose', 'fallFar', 'collision'] as const;

  return (
    <div className="panel">
      <SectionHead>{t('gm.hazards.title')}</SectionHead>
      <label htmlFor="hazard-label">{t('gm.hazards.label')}</label>
      <input
        id="hazard-label"
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        placeholder={t('gm.hazards.placeholder')}
      />
      <div className="row">
        {kinds.map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() =>
              send({
                type: 'rollFate',
                kind,
                label: label.trim() === '' ? t(`gm.hazards.${kind}`) : label.trim(),
                visibility,
              })
            }
          >
            {t(`gm.hazards.${kind}`)}
          </button>
        ))}
        <PrivateToggle value={visibility} onChange={setVisibility} />
      </div>
      <details>
        <summary>{t('gm.hazards.more')}</summary>
        <p className="card-text">{t('gm.hazards.underwater')}</p>
        <p className="card-text">{t('gm.hazards.pcVsPc')}</p>
        <p className="card-text">{t('gm.hazards.fearBudget')}</p>
      </details>
    </div>
  );
}

/**
 * Adversary pools (SRD 2.0 p.94): tokens shared by several adversaries instead of
 * sitting on one stat block. They are empty when a scene begins and cleared when it
 * ends, so clearing them all is one button.
 */
function AdversaryPools({ room, send }: { room: RoomState; send: (event: RoomEvent) => void }) {
  const [name, setName] = useState('');

  return (
    <div className="panel">
      <SectionHead>{t('gm.pools.title')}</SectionHead>
      <p className="muted">{t('gm.pools.hint')}</p>

      {room.adversaryPools.map((pool) => (
        <div className="row" key={pool.name}>
          <strong>{pool.name}</strong>
          <span>{pool.tokens}</span>
          <button
            type="button"
            onClick={() =>
              send({ type: 'setAdversaryPool', name: pool.name, tokens: pool.tokens + 1 })
            }
          >
            +1
          </button>
          <button
            type="button"
            disabled={pool.tokens === 0}
            onClick={() =>
              send({ type: 'setAdversaryPool', name: pool.name, tokens: pool.tokens - 1 })
            }
          >
            −1
          </button>
          <button
            type="button"
            onClick={() => send({ type: 'setAdversaryPool', name: pool.name, tokens: null })}
          >
            {t('gm.pools.remove')}
          </button>
        </div>
      ))}

      <div className="row">
        <label htmlFor="pool-name">{t('gm.pools.name')}</label>
        <input id="pool-name" value={name} onChange={(event) => setName(event.target.value)} />
        <button
          type="button"
          disabled={name.trim() === ''}
          onClick={() => {
            send({ type: 'setAdversaryPool', name: name.trim(), tokens: 0 });
            setName('');
          }}
        >
          {t('gm.pools.add')}
        </button>
        {room.adversaryPools.length > 0 ? (
          <button type="button" onClick={() => send({ type: 'clearAdversaryPools' })}>
            {t('gm.pools.clear')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The Battle Points readout for the adversaries on the table (SRD 2.0 p.94).
 *
 * It reports rather than refuses: an encounter over budget is a legal encounter,
 * just a harder one. The two line-up adjustments are derived from what is already
 * on the table; the rest are the GM's to tick.
 */
function BattlePoints({ room }: { room: RoomState }) {
  const [adjustments, setAdjustments] = useState<BattlePointAdjustments>({});

  const types = useMemo(
    () =>
      room.adversaryInstances
        .map((instance) => srd().adversaries.find((a) => a.id === instance.adversaryId)?.type)
        .filter((type): type is AdversaryType => type !== undefined),
    [room.adversaryInstances],
  );
  const pcCount = room.players.filter((player) => player.characterId !== null).length;
  const budget = battlePointBudget(pcCount, types, adjustments);
  const spent = battlePointsSpent(types, pcCount);

  const toggle = (key: keyof BattlePointAdjustments) => (event: ChangeEvent<HTMLInputElement>) =>
    setAdjustments((current) => ({ ...current, [key]: event.target.checked }));

  return (
    <div className="panel">
      <SectionHead>{t('gm.battlePoints.title')}</SectionHead>
      <p>
        {t('gm.battlePoints.spent', { spent, budget })}{' '}
        {spent > budget ? <strong>{t('gm.battlePoints.over')}</strong> : null}
      </p>
      <p className="muted">{t('gm.battlePoints.hint')}</p>
      {(['easier', 'harder', 'strongerDamage', 'lowerTier'] as const).map((key) => (
        <label key={key} htmlFor={`bp-${key}`}>
          <input
            id={`bp-${key}`}
            type="checkbox"
            checked={adjustments[key] === true}
            onChange={toggle(key)}
          />{' '}
          {t(`gm.battlePoints.${key}`)}
        </label>
      ))}
    </div>
  );
}

function Adversaries({
  room,
  send,
}: {
  room: RoomState;
  send: (event: RoomEvent) => void;
}) {
  const [query, setQuery] = useState('');
  const [quantity, setQuantity] = useState(1);

  /** Adds `count` of an adversary at once, lettered (see `encounterEvents`). */
  const addAdversaries = (adversaryId: string, baseName: string, count: number) => {
    for (const event of encounterEvents(room.adversaryInstances, adversaryId, baseName, count, () => nextId('adv'))) {
      send(event);
    }
  };

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return [];
    return srd()
      .adversaries.filter(
        (a) => a.name.toLowerCase().includes(needle) || a.type.toLowerCase().includes(needle),
      )
      .slice(0, 12);
  }, [query]);

  return (
    <div className="panel">
      <SectionHead>{t('gm.adversaries.title')}</SectionHead>

      {/* The campaign page's prep list, one click from the encounter. GM-only:
          `roomForRole` never sends it to a player. */}
      <h3>{t('gm.prep.title')}</h3>
      {room.prepAdversaries.length === 0 ? <p className="muted">{t('gm.prep.empty')}</p> : null}
      {room.prepAdversaries.map((entry) => {
        const stat = srd().adversaries.find((a) => a.id === entry.adversaryId);
        const name = stat?.name ?? entry.adversaryId;
        return (
          <div className="card" key={entry.id}>
            <div className="card-head">
              <strong>
                {name} <span className="option-meta">{t('gm.prep.count', { count: entry.quantity })}</span>
              </strong>
              <button type="button" onClick={() => addAdversaries(entry.adversaryId, name, entry.quantity)}>
                {t('gm.prep.add')}
              </button>
            </div>
            {entry.note === '' ? null : <span className="option-meta">{entry.note}</span>}
          </div>
        );
      })}

      <div className="mt-5" />

      <label htmlFor="adversary-search">{t('gm.adversaries.searchLabel')}</label>
      <input
        id="adversary-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('gm.adversaries.searchPlaceholder')}
      />
      <div className="row">
        <label htmlFor="adversary-quantity">{t('gm.adversaries.quantity')}</label>
        <input
          id="adversary-quantity"
          type="number"
          min={1}
          max={12}
          value={quantity}
          onChange={(event) =>
            setQuantity(Math.max(1, Math.min(12, Number(event.target.value) || 1)))
          }
        />
      </div>

      {matches.map((adversary) => (
        <div className="card" key={adversary.id}>
          <div className="card-head">
            <strong>{adversary.name}</strong>
            <button
              type="button"
              onClick={() => addAdversaries(adversary.id, adversary.name, quantity)}
            >
              {t('gm.adversaries.addToEncounter')}
            </button>
          </div>
          <span className="option-meta">
            {t('gm.adversaries.meta', {
              tier: adversary.tier,
              type: prettify(adversary.type),
              difficulty: adversary.difficulty,
              hp: adversary.hp,
              stress: adversary.stress,
            })}
          </span>
        </div>
      ))}

      <h3 className="mt-5">{t('gm.adversaries.inEncounter')}</h3>
      {room.adversaryInstances.length === 0 ? (
        <p className="muted">{t('gm.adversaries.empty')}</p>
      ) : null}

      {room.adversaryInstances.map((instance) => {
        const stat = srd().adversaries.find((a) => a.id === instance.adversaryId);
        return (
          <div className="card" key={instance.instanceId}>
            <div className="card-head">
              <strong>{instance.name}</strong>
              <div className="row">
                <button
                  type="button"
                  onClick={() => addAdversaries(instance.adversaryId, stat?.name ?? instance.name, 1)}
                >
                  {t('gm.adversaries.duplicate')}
                </button>
                <button
                  type="button"
                  onClick={() => send({ type: 'removeAdversary', instanceId: instance.instanceId })}
                >
                  {t('gm.remove')}
                </button>
              </div>
            </div>
            {stat === undefined ? null : (
              <>
                <span className="option-meta">
                  {t('gm.adversaries.meta2', {
                    difficulty: stat.difficulty,
                    thresholds:
                      stat.thresholds === null
                        ? t('gm.adversaries.thresholdsNone')
                        : `${stat.thresholds.major}/${stat.thresholds.severe ?? '—'}`,
                    atk:
                      stat.attackModifier.flat === null
                        ? `${stat.attackModifier.roll?.count}d${stat.attackModifier.roll?.die}`
                        : stat.attackModifier.flat,
                  })}
                </span>

                <AttackControls room={room} instance={instance} stat={stat} send={send} />

                <div className="row mt-2">
                  <span className="muted">
                    {t('gm.adversaries.hpLine', { marked: instance.hpMarked, total: stat.hp })}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      send({
                        type: 'updateAdversary',
                        instanceId: instance.instanceId,
                        hpMarked: Math.min(stat.hp, instance.hpMarked + 1),
                        stressMarked: instance.stressMarked,
                      })
                    }
                  >
                    {t('gm.adversaries.plusHp')}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      send({
                        type: 'updateAdversary',
                        instanceId: instance.instanceId,
                        hpMarked: Math.max(0, instance.hpMarked - 1),
                        stressMarked: instance.stressMarked,
                      })
                    }
                  >
                    {t('gm.adversaries.minusHp')}
                  </button>
                  <span className="muted">
                    {t('gm.adversaries.stressLine', { marked: instance.stressMarked, total: stat.stress })}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      send({
                        type: 'updateAdversary',
                        instanceId: instance.instanceId,
                        hpMarked: instance.hpMarked,
                        stressMarked: Math.min(stat.stress, instance.stressMarked + 1),
                      })
                    }
                  >
                    {t('gm.adversaries.plusStress')}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      send({
                        type: 'updateAdversary',
                        instanceId: instance.instanceId,
                        hpMarked: instance.hpMarked,
                        stressMarked: Math.max(0, instance.stressMarked - 1),
                      })
                    }
                  >
                    {t('gm.adversaries.minusStress')}
                  </button>
                </div>

                <details>
                  <summary>{t('gm.adversaries.featuresSummary')}</summary>
                  <p className="card-text">
                    <strong>{stat.standardAttack.name}</strong> · {prettify(stat.standardAttack.range)}{' '}
                    ·{' '}
                    {stat.standardAttack.damage.die === null
                      ? stat.standardAttack.damage.modifier
                      : `${stat.standardAttack.damage.count}d${stat.standardAttack.damage.die}+${stat.standardAttack.damage.modifier}`}{' '}
                    {prettify(stat.standardAttack.damageType)}
                  </p>
                  {stat.features.map((feature) => (
                    <FeatureRow
                      key={feature.name}
                      feature={feature}
                      instance={instance}
                      send={send}
                    />
                  ))}
                </details>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function EnvironmentPicker({
  activeEnvironment,
  send,
}: {
  activeEnvironment: string | null;
  send: (event: RoomEvent) => void;
}) {
  const active = srd().environments.find((e) => e.id === activeEnvironment) ?? null;

  return (
    <div className="panel">
      <SectionHead>{t('gm.environment.title')}</SectionHead>
      <label htmlFor="environment">{t('gm.environment.activeLabel')}</label>
      <select
        id="environment"
        value={activeEnvironment ?? ''}
        onChange={(event) =>
          send({
            type: 'setEnvironment',
            environmentId: event.target.value === '' ? null : event.target.value,
          })
        }
      >
        <option value="">{t('gm.environment.none')}</option>
        {srd().environments.map((environment) => (
          <option key={environment.id} value={environment.id}>
            {t('gm.environment.optionLabel', { tier: environment.tier, name: environment.name })}
          </option>
        ))}
      </select>

      {active === null ? null : (
        <div className="card mt-3">
          <strong>{active.name}</strong>
          <span className="option-meta">
            {' '}
            {t('gm.environment.meta', {
              tier: active.tier,
              type: prettify(active.type),
              difficulty: active.difficulty,
            })}
          </span>
          <p className="card-text">{active.description}</p>
          <p className="card-text">
            <strong>{t('gm.environment.impulses')}</strong> {active.impulses}
          </p>
          <p className="card-text">
            <strong>{t('gm.environment.potentialAdversaries')}</strong> {active.potentialAdversaries}
          </p>
          {active.features.map((feature) => (
            <EnvironmentFeatureRow key={feature.name} feature={feature} send={send} />
          ))}
        </div>
      )}
    </div>
  );
}

/** One environment feature, with the Fear its own text asks for. */
function EnvironmentFeatureRow({
  feature,
  send,
}: {
  feature: StatBlockFeature;
  send: (event: RoomEvent) => void;
}) {
  const [fearCost, setFearCost] = useState(feature.costsFear ? 1 : 0);
  const [visibility, setVisibility] = useState<Visibility>('public');

  return (
    <div className="card-text">
      <p>
        <strong>
          {feature.name} — {prettify(feature.type)}
          {feature.costsFear ? t('gm.fearSuffix') : ''}:
        </strong>{' '}
        {feature.text}
      </p>
      <div className="row">
        {feature.costsFear ? (
          <>
            <label htmlFor={`env-fear-${feature.name}`}>{t('gm.adversaries.featureFear')}</label>
            <input
              id={`env-fear-${feature.name}`}
              type="number"
              min={0}
              max={MAX_FEAR}
              value={fearCost}
              onChange={(event) =>
                setFearCost(Math.max(0, Math.min(MAX_FEAR, Number(event.target.value) || 0)))
              }
            />
          </>
        ) : null}
        <button
          type="button"
          onClick={() =>
            send({ type: 'useEnvironmentFeature', featureName: feature.name, fearCost, visibility })
          }
        >
          {t('gm.adversaries.useFeature')}
        </button>
        <PrivateToggle value={visibility} onChange={setVisibility} />
      </div>
    </div>
  );
}

/**
 * The GM's random tables: a name and rows, one per line. Rolling one picks a row
 * uniformly at random on the server and logs it, same as a fate roll.
 */
function Tables({ room, send }: { room: RoomState; send: (event: RoomEvent) => void }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [rowsText, setRowsText] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('public');

  const startNew = () => {
    setEditingId('');
    setName('');
    setRowsText('');
  };

  const startEdit = (table: RollTable) => {
    setEditingId(table.id);
    setName(table.name);
    setRowsText(table.rows.join('\n'));
  };

  const save = () => {
    const rows = rowsText
      .split('\n')
      .map((row) => row.trim())
      .filter((row) => row !== '');
    if (name.trim() === '' || rows.length === 0 || editingId === null) return;
    const table: RollTable = { id: editingId === '' ? nextId('tbl') : editingId, name: name.trim(), rows };
    send({ type: 'upsertTable', table });
    setEditingId(null);
  };

  return (
    <div className="panel">
      <SectionHead>{t('gm.tables.title')}</SectionHead>
      {editingId === null ? (
        <>
          {room.tables.length === 0 ? (
            <p className="muted">{t('gm.tables.empty')}</p>
          ) : (
            <ul className="log">
              {room.tables.map((table) => (
                <li key={table.id} className="row spread">
                  <button type="button" onClick={() => startEdit(table)}>
                    {table.name}
                  </button>
                  <div className="row">
                    <button
                      type="button"
                      onClick={() => send({ type: 'rollTable', tableId: table.id, visibility })}
                    >
                      {t('gm.tables.roll')}
                    </button>
                    <button type="button" onClick={() => send({ type: 'removeTable', id: table.id })}>
                      {t('common.remove')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="row mt-3">
            <PrivateToggle value={visibility} onChange={setVisibility} />
            <button type="button" disabled={room.tables.length >= MAX_TABLES} onClick={startNew}>
              {t('gm.tables.new')}
            </button>
          </div>
        </>
      ) : (
        <>
          <label htmlFor="table-name">{t('gm.tables.nameLabel')}</label>
          <input id="table-name" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
          <label htmlFor="table-rows" className="mt-3">
            {t('gm.tables.rowsLabel')}
          </label>
          <textarea
            id="table-rows"
            rows={6}
            value={rowsText}
            placeholder={t('gm.tables.rowsPlaceholder')}
            onChange={(event) => setRowsText(event.target.value)}
          />
          <div className="row mt-3">
            <button
              type="button"
              disabled={name.trim() === '' || rowsText.trim() === ''}
              onClick={save}
            >
              {t('gm.tables.save')}
            </button>
            <button type="button" onClick={() => setEditingId(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Presence({ room }: { room: RoomState }) {
  return (
    <div className="panel">
      <SectionHead>{t('gm.presence.title')}</SectionHead>
      <ul className="log">
        <li>
          <span className={room.gm.connected ? 'badge' : 'badge warn'}>
            {room.gm.connected ? t('gm.presence.connected') : t('gm.presence.disconnected')}
          </span>{' '}
          {room.gm.name} <span className="muted">({t('campaigns.gmChip')})</span>
        </li>
        {room.players.map((player) => (
          <li key={player.id}>
            <span className={player.connected ? 'badge' : 'badge warn'}>
              {player.connected ? t('gm.presence.connected') : t('gm.presence.disconnected')}
            </span>{' '}
            {player.name}{' '}
            <span className="muted">
              {player.characterId === null
                ? t('gm.presence.noCharacterYet')
                : room.characters[player.characterId]?.character.name ?? ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A GM roll that only the GM sees: a hidden check, an attack kept off the table. */
function PrivateToggle({
  value,
  onChange,
}: {
  value: Visibility;
  onChange: (next: Visibility) => void;
}) {
  const id = useId();
  return (
    <label htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={value === 'private'}
        onChange={(event) => onChange(event.target.checked ? 'private' : 'public')}
      />{' '}
      {t('roll.privateToggle')}
    </label>
  );
}

/**
 * Marks a damage roll on the adversary its roller is targeting now. Read at click
 * time from the roller's targets, not from the entry, so retargeting before
 * applying is enough to redirect it; the server turns the amount into HP.
 */
function ApplyToTarget({
  room,
  by,
  amount,
  applied,
  onApply,
  send,
}: {
  room: RoomState;
  by: string;
  amount: number;
  applied: boolean;
  onApply: () => void;
  send: (event: RoomEvent) => void;
}) {
  const target = adversaryTargetOf(room, by);
  if (target === null) return null;
  return (
    <button
      type="button"
      className="mt-1"
      disabled={applied}
      onClick={() => {
        // A double click would otherwise mark the same damage twice.
        if (applied) return;
        onApply();
        send({ type: 'applyDamageToAdversary', instanceId: target.instanceId, amount });
      }}
    >
      {t('gm.rollLog.applyToTarget', { name: target.name })}
    </button>
  );
}

function SharedRollLog({ room, send }: { room: RoomState; send: (event: RoomEvent) => void }) {
  // The GM is sent every private entry, so the whole private log belongs here.
  const feed = useMemo(() => mergeFeed(room.rollLog, room.privateLog), [room.rollLog, room.privateLog]);
  const applicable = useMemo(() => newestDamageIds(feed.map((item) => item.entry)), [feed]);
  // Entries already applied from this panel; local, so a reload forgets them.
  const [applied, setApplied] = useState<ReadonlySet<string>>(() => new Set());
  return (
    <div className="panel">
      <SectionHead>{t('sheet.log.title')}</SectionHead>
      {feed.length === 0 ? <p className="muted">{t('gm.rollLog.empty')}</p> : null}
      <ul className="log">
        {feed.map(({ entry, private: isPrivate }) => (
          <li key={entry.id}>
            {isPrivate ? <PrivateBadge /> : null}
            {entry.kind === 'message' ? (
              <MessageLine by={entry.by} text={entry.text} />
            ) : entry.kind === 'effect' ? (
              <EffectLine entry={entry} />
            ) : entry.kind === 'dice' ? (
              <DiceLine entry={entry} />
            ) : (
              <>
                <div className="row spread">
                  <strong>
                    {entry.by} — {entry.label}
                  </strong>
                  {entry.kind === 'duality' ? (
                    <span className="outcome" data-tone={outcomeTone(entry.outcome)}>
                      {t(`roll.outcome.${entry.outcome}` as MessageKey)}
                    </span>
                  ) : entry.kind === 'attack' ? (
                    <span
                      className="outcome"
                      data-tone={
                        entry.roll.critical
                          ? 'critical'
                          : entry.roll.success === null
                            ? undefined
                            : entry.roll.success
                              ? 'success'
                              : 'failure'
                      }
                    >
                      {entry.roll.critical
                        ? t('sheet.log.attackCritical')
                        : entry.roll.success === null
                          ? t('sheet.log.attackTotal', { total: entry.roll.total })
                          : t(entry.roll.success ? 'sheet.log.attackHit' : 'sheet.log.attackMiss')}
                    </span>
                  ) : entry.kind === 'fate' ? (
                    <span>{entry.value}</span>
                  ) : entry.kind === 'table' ? (
                    <span>{entry.result}</span>
                  ) : (
                    <span>
                      {entry.roll.total}
                      {t('gm.rollLog.damageSuffix')}
                    </span>
                  )}
                </div>
                <span className="muted">
                  {entry.kind === 'duality'
                    ? `${t('gm.rollLog.dualityMeta', {
                        hope: entry.roll.hope,
                        fear: entry.roll.fear,
                        total: entry.roll.total,
                        difficulty: entry.difficulty,
                      })}${entry.target === null ? '' : t('sheet.log.target', { target: entry.target })}`
                    : entry.kind === 'attack'
                      ? `${t('sheet.log.attackDice', { dice: entry.roll.dice.join(', ') })}${
                          entry.evasion === null
                            ? t('sheet.log.attackNoTarget', { total: entry.roll.total })
                            : t('sheet.log.attackVs', {
                                total: entry.roll.total,
                                evasion: entry.evasion,
                                target: entry.target ?? '',
                              })
                        }`
                      : entry.kind === 'fate'
                        ? t('gm.rollLog.fateMeta')
                        : entry.kind === 'table'
                          ? ''
                          : t('gm.rollLog.damageMeta', {
                            rolls: entry.roll.rolls.join(', '),
                            critical: entry.critical
                              ? t('gm.rollLog.criticalSuffix', { bonus: entry.roll.criticalBonus })
                              : '',
                          })}
                </span>
                {entry.kind === 'damage' && applicable.has(entry.id) ? (
                  <ApplyToTarget
                    room={room}
                    by={entry.by}
                    amount={entry.roll.total}
                    applied={applied.has(entry.id)}
                    onApply={() => setApplied((current) => new Set(current).add(entry.id))}
                    send={send}
                  />
                ) : null}
              </>
            )}
          </li>
        ))}
      </ul>
      <ChatBox
        {...chatRecipients(room, room.gm.id)}
        onSend={(text, whisperTo) => send({ type: 'sendMessage', text, whisperTo })}
      />
    </div>
  );
}
