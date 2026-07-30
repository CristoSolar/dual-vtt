import {
  OUTCOME_LABELS,
  outcomeTone,
  type Countdown,
  type RoomEvent,
  type RoomState,
} from '@daggerheart/protocol';
import { MAX_FEAR } from '@daggerheart/rules';
import { adversaries, environments } from '@daggerheart/srd-data';
import { useMemo, useState } from 'react';

import { label as prettify } from '../../state/selectors.js';
import { SectionHead } from '../SectionHead.js';

interface GMPanelProps {
  room: RoomState;
  send: (event: RoomEvent) => void;
}

let counter = 0;
const nextId = (prefix: string) => {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
};

/**
 * The GM's screen. Every control emits an intent; the server validates it, applies
 * it, and broadcasts the result — nothing here changes state directly.
 */
export function GMPanel({ room, send }: GMPanelProps) {
  return (
    <section className="gm-scope">
      <p className="gm-banner">
        <GmMark />
        Game Master view
      </p>
      <div className="card-head">
        <div>
          <h1>GM Panel</h1>
          <p className="muted">
            Join code <span className="join-code">{room.code}</span>
          </p>
        </div>
      </div>

      <div className="sheet-layout">
        <div>
          <FearTrack fear={room.fear} send={send} />
          <PartyOverview room={room} send={send} />
          <Countdowns countdowns={room.countdowns} send={send} />
          <Adversaries room={room} send={send} />
          <EnvironmentPicker activeEnvironment={room.activeEnvironment} send={send} />
        </div>

        <aside>
          <Presence room={room} />
          <SharedRollLog room={room} />
        </aside>
      </div>
    </section>
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
      <SectionHead>Fear</SectionHead>
      <div className="tracker-head">
        <span className="muted">The GM's pool</span>
        <span className="muted">
          {fear} / {MAX_FEAR}
        </span>
      </div>
      <ul className="pips">
        {Array.from({ length: MAX_FEAR }, (_, index) => {
          const filled = index < fear;
          return (
            <li key={index}>
              <button
                type="button"
                className="pip fear"
                data-filled={filled}
                aria-pressed={filled}
                aria-label={`Fear ${index + 1} of ${MAX_FEAR}`}
                onClick={() =>
                  send(filled ? { type: 'spendFear', amount: 1 } : { type: 'gainFear', amount: 1 })
                }
              >
                {index + 1}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="muted">Click an empty pip to gain Fear, a filled one to spend it.</p>
    </div>
  );
}

function PartyOverview({ room, send }: GMPanelProps) {
  const entries = Object.entries(room.characters);

  return (
    <div className="panel">
      <SectionHead>Party</SectionHead>
      {entries.length === 0 ? (
        <p className="muted">No characters claimed yet.</p>
      ) : (
        <div className="grid cols-2">
          {entries.map(([id, sheet]) => {
            const player = room.players.find((p) => p.characterId === id);
            const spotlit = room.spotlight === (player?.id ?? id);
            return (
              <div className="card" key={id}>
                <div className="card-head">
                  <strong>{sheet.character.name ?? 'Unnamed'}</strong>
                  <button
                    type="button"
                    aria-pressed={spotlit}
                    onClick={() =>
                      send({ type: 'setSpotlight', spotlight: spotlit ? null : player?.id ?? id })
                    }
                  >
                    {spotlit ? 'In spotlight' : 'Spotlight'}
                  </button>
                </div>
                <span className="option-meta">
                  {player?.name ?? 'unclaimed'} · Level {sheet.character.level}
                </span>
                <p className="card-text">
                  HP {sheet.hpMarked}/{sheet.character.hpSlots} · Stress {sheet.stressMarked}/
                  {sheet.character.stressSlots} · Hope {sheet.hope} · Armor{' '}
                  {sheet.armorSlotsMarked}/{sheet.character.armorScore}
                  <br />
                  Evasion {sheet.character.evasion} · Thresholds {sheet.character.major}/
                  {sheet.character.severe}
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
      <SectionHead>Countdowns</SectionHead>

      {countdowns.length === 0 ? <p className="muted">No countdowns running.</p> : null}
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
                aria-label={`Advance ${countdown.name}`}
                onClick={() => send({ type: 'advanceCountdown', id: countdown.id, amount: 1 })}
              >
                −1
              </button>
              <button
                type="button"
                onClick={() => send({ type: 'removeCountdown', id: countdown.id })}
              >
                Remove
              </button>
            </div>
          </div>
          {countdown.triggered ? <span className="badge warn">Triggered</span> : null}
          {countdown.kind === 'progress' || countdown.kind === 'consequence' ? (
            <p className="card-text">
              Advances automatically on action rolls, by the dynamic countdown chart.
            </p>
          ) : null}
          {countdown.kind === 'longTerm' ? (
            <p className="card-text">Advances on rests rather than action rolls.</p>
          ) : null}
        </div>
      ))}

      <fieldset>
        <legend>New countdown</legend>
        <div className="grid cols-2">
          <div>
            <label htmlFor="cd-name">Name</label>
            <input id="cd-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label htmlFor="cd-start">Starting value</label>
            <input
              id="cd-start"
              type="number"
              min={1}
              value={startingValue}
              onChange={(e) => setStartingValue(Math.max(1, Number(e.target.value)))}
            />
          </div>
          <div>
            <label htmlFor="cd-kind">Type</label>
            <select
              id="cd-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as Countdown['kind'])}
            >
              <option value="standard">Standard</option>
              <option value="progress">Progress (dynamic)</option>
              <option value="consequence">Consequence (dynamic)</option>
              <option value="longTerm">Long-term</option>
            </select>
          </div>
          <div>
            <label htmlFor="cd-loop">On trigger</label>
            <select
              id="cd-loop"
              value={loop}
              onChange={(e) => setLoop(e.target.value as Countdown['loop'])}
            >
              <option value="none">Stop</option>
              <option value="loop">Loop</option>
              <option value="increasing">Loop, increasing</option>
              <option value="decreasing">Loop, decreasing</option>
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
          Add countdown
        </button>
      </fieldset>

      <button type="button" onClick={() => send({ type: 'advanceCountdownsForRest', amount: 1 })}>
        Advance long-term countdowns (rest)
      </button>
    </div>
  );
}

function Adversaries({ room, send }: GMPanelProps) {
  const [query, setQuery] = useState('');

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return [];
    return adversaries
      .filter(
        (a) => a.name.toLowerCase().includes(needle) || a.type.toLowerCase().includes(needle),
      )
      .slice(0, 12);
  }, [query]);

  return (
    <div className="panel">
      <SectionHead>Adversaries</SectionHead>

      <label htmlFor="adversary-search">Search the SRD</label>
      <input
        id="adversary-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="ooze, bruiser, dragon…"
      />

      {matches.map((adversary) => (
        <div className="card" key={adversary.id}>
          <div className="card-head">
            <strong>{adversary.name}</strong>
            <button
              type="button"
              onClick={() =>
                send({
                  type: 'addAdversary',
                  instanceId: nextId('adv'),
                  adversaryId: adversary.id,
                  name: adversary.name,
                })
              }
            >
              Add to encounter
            </button>
          </div>
          <span className="option-meta">
            Tier {adversary.tier} · {prettify(adversary.type)} · Difficulty{' '}
            {adversary.difficulty} · HP {adversary.hp} · Stress {adversary.stress}
          </span>
        </div>
      ))}

      <h3 className="mt-5">In the encounter</h3>
      {room.adversaryInstances.length === 0 ? (
        <p className="muted">Nothing fielded yet.</p>
      ) : null}

      {room.adversaryInstances.map((instance) => {
        const stat = adversaries.find((a) => a.id === instance.adversaryId);
        return (
          <div className="card" key={instance.instanceId}>
            <div className="card-head">
              <strong>{instance.name}</strong>
              <button
                type="button"
                onClick={() => send({ type: 'removeAdversary', instanceId: instance.instanceId })}
              >
                Remove
              </button>
            </div>
            {stat === undefined ? null : (
              <>
                <span className="option-meta">
                  Difficulty {stat.difficulty} · Thresholds{' '}
                  {stat.thresholds === null
                    ? 'none'
                    : `${stat.thresholds.major}/${stat.thresholds.severe ?? '—'}`}{' '}
                  · ATK{' '}
                  {stat.attackModifier.flat === null
                    ? `${stat.attackModifier.roll?.count}d${stat.attackModifier.roll?.die}`
                    : stat.attackModifier.flat}
                </span>

                <div className="row mt-2">
                  <span className="muted">
                    HP {instance.hpMarked}/{stat.hp}
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
                    +HP
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
                    −HP
                  </button>
                  <span className="muted">
                    Stress {instance.stressMarked}/{stat.stress}
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
                    +Stress
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
                    −Stress
                  </button>
                </div>

                <details>
                  <summary>Features &amp; attack</summary>
                  <p className="card-text">
                    <strong>{stat.standardAttack.name}</strong> · {prettify(stat.standardAttack.range)}{' '}
                    ·{' '}
                    {stat.standardAttack.damage.die === null
                      ? stat.standardAttack.damage.modifier
                      : `${stat.standardAttack.damage.count}d${stat.standardAttack.damage.die}+${stat.standardAttack.damage.modifier}`}{' '}
                    {prettify(stat.standardAttack.damageType)}
                  </p>
                  {stat.features.map((feature) => (
                    <p className="card-text" key={feature.name}>
                      <strong>
                        {feature.name} — {prettify(feature.type)}
                        {feature.costsFear ? ' (Fear)' : ''}:
                      </strong>{' '}
                      {feature.text}
                    </p>
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
  const active = environments.find((e) => e.id === activeEnvironment) ?? null;

  return (
    <div className="panel">
      <SectionHead>Environment</SectionHead>
      <label htmlFor="environment">Active environment</label>
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
        <option value="">None</option>
        {environments.map((environment) => (
          <option key={environment.id} value={environment.id}>
            Tier {environment.tier} — {environment.name}
          </option>
        ))}
      </select>

      {active === null ? null : (
        <div className="card mt-3">
          <strong>{active.name}</strong>
          <span className="option-meta">
            {' '}
            Tier {active.tier} · {prettify(active.type)} · Difficulty {active.difficulty}
          </span>
          <p className="card-text">{active.description}</p>
          <p className="card-text">
            <strong>Impulses:</strong> {active.impulses}
          </p>
          <p className="card-text">
            <strong>Potential adversaries:</strong> {active.potentialAdversaries}
          </p>
          {active.features.map((feature) => (
            <p className="card-text" key={feature.name}>
              <strong>
                {feature.name} — {prettify(feature.type)}
                {feature.costsFear ? ' (Fear)' : ''}:
              </strong>{' '}
              {feature.text}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function Presence({ room }: { room: RoomState }) {
  return (
    <div className="panel">
      <SectionHead>At the table</SectionHead>
      <ul className="log">
        <li>
          <span className={room.gm.connected ? 'badge' : 'badge warn'}>
            {room.gm.connected ? 'online' : 'offline'}
          </span>{' '}
          {room.gm.name} <span className="muted">(GM)</span>
        </li>
        {room.players.map((player) => (
          <li key={player.id}>
            <span className={player.connected ? 'badge' : 'badge warn'}>
              {player.connected ? 'online' : 'offline'}
            </span>{' '}
            {player.name}{' '}
            <span className="muted">
              {player.characterId === null
                ? 'no character yet'
                : room.characters[player.characterId]?.character.name ?? ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SharedRollLog({ room }: { room: RoomState }) {
  return (
    <div className="panel">
      <SectionHead>Roll log</SectionHead>
      {room.rollLog.length === 0 ? <p className="muted">No rolls yet.</p> : null}
      <ul className="log">
        {room.rollLog.map((entry) => (
          <li key={entry.id}>
            <div className="row spread">
              <strong>
                {entry.by} — {entry.label}
              </strong>
              {entry.kind === 'duality' ? (
                <span className="outcome" data-tone={outcomeTone(entry.outcome)}>
                  {OUTCOME_LABELS[entry.outcome]}
                </span>
              ) : (
                <span>{entry.roll.total} damage</span>
              )}
            </div>
            <span className="muted">
              {entry.kind === 'duality'
                ? `Hope ${entry.roll.hope} · Fear ${entry.roll.fear} · total ${entry.roll.total} vs ${entry.difficulty}`
                : `Dice ${entry.roll.rolls.join(', ')}${entry.critical ? ` · critical +${entry.roll.criticalBonus}` : ''}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
