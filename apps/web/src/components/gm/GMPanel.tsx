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
        Vista del Director de Juego
      </p>
      <div className="card-head">
        <div>
          <h1>Panel del DJ</h1>
          <p className="muted">
            Código de acceso <span className="join-code">{room.code}</span>
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
      <SectionHead>Miedo</SectionHead>
      <div className="tracker-head">
        <span className="muted">La reserva del DJ</span>
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
                aria-label={`Miedo ${index + 1} de ${MAX_FEAR}`}
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
      <p className="muted">Clic en una ficha vacía para ganar Miedo, en una llena para gastarlo.</p>
    </div>
  );
}

function PartyOverview({ room, send }: GMPanelProps) {
  const entries = Object.entries(room.characters);

  return (
    <div className="panel">
      <SectionHead>Grupo</SectionHead>
      {entries.length === 0 ? (
        <p className="muted">Todavía no hay personajes reclamados.</p>
      ) : (
        <div className="grid cols-2">
          {entries.map(([id, sheet]) => {
            const player = room.players.find((p) => p.characterId === id);
            const spotlit = room.spotlight === (player?.id ?? id);
            return (
              <div className="card" key={id}>
                <div className="card-head">
                  <strong>{sheet.character.name ?? 'Sin nombre'}</strong>
                  <button
                    type="button"
                    aria-pressed={spotlit}
                    onClick={() =>
                      send({ type: 'setSpotlight', spotlight: spotlit ? null : player?.id ?? id })
                    }
                  >
                    {spotlit ? 'En el foco' : 'Dar foco'}
                  </button>
                </div>
                <span className="option-meta">
                  {player?.name ?? 'sin reclamar'} · Nivel {sheet.character.level}
                </span>
                <p className="card-text">
                  PV {sheet.hpMarked}/{sheet.character.hpSlots} · Estrés {sheet.stressMarked}/
                  {sheet.character.stressSlots} · Esperanza {sheet.hope} · Armadura{' '}
                  {sheet.armorSlotsMarked}/{sheet.character.armorScore}
                  <br />
                  Evasión {sheet.character.evasion} · Umbrales {sheet.character.major}/
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
      <SectionHead>Cuentas atrás</SectionHead>

      {countdowns.length === 0 ? <p className="muted">No hay cuentas atrás en marcha.</p> : null}
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
                aria-label={`Avanzar ${countdown.name}`}
                onClick={() => send({ type: 'advanceCountdown', id: countdown.id, amount: 1 })}
              >
                −1
              </button>
              <button
                type="button"
                onClick={() => send({ type: 'removeCountdown', id: countdown.id })}
              >
                Quitar
              </button>
            </div>
          </div>
          {countdown.triggered ? <span className="badge warn">Activada</span> : null}
          {countdown.kind === 'progress' || countdown.kind === 'consequence' ? (
            <p className="card-text">
              Avanza automáticamente con las tiradas de acción, según la tabla de cuentas atrás dinámicas.
            </p>
          ) : null}
          {countdown.kind === 'longTerm' ? (
            <p className="card-text">Avanza con los descansos, no con las tiradas de acción.</p>
          ) : null}
        </div>
      ))}

      <fieldset>
        <legend>Nueva cuenta atrás</legend>
        <div className="grid cols-2">
          <div>
            <label htmlFor="cd-name">Nombre</label>
            <input id="cd-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label htmlFor="cd-start">Valor inicial</label>
            <input
              id="cd-start"
              type="number"
              min={1}
              value={startingValue}
              onChange={(e) => setStartingValue(Math.max(1, Number(e.target.value)))}
            />
          </div>
          <div>
            <label htmlFor="cd-kind">Tipo</label>
            <select
              id="cd-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as Countdown['kind'])}
            >
              <option value="standard">Estándar</option>
              <option value="progress">Progreso (dinámica)</option>
              <option value="consequence">Consecuencia (dinámica)</option>
              <option value="longTerm">Largo plazo</option>
            </select>
          </div>
          <div>
            <label htmlFor="cd-loop">Al activarse</label>
            <select
              id="cd-loop"
              value={loop}
              onChange={(e) => setLoop(e.target.value as Countdown['loop'])}
            >
              <option value="none">Detener</option>
              <option value="loop">Reiniciar</option>
              <option value="increasing">Reiniciar, aumentando</option>
              <option value="decreasing">Reiniciar, disminuyendo</option>
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
          Añadir cuenta atrás
        </button>
      </fieldset>

      <button type="button" onClick={() => send({ type: 'advanceCountdownsForRest', amount: 1 })}>
        Avanzar cuentas atrás de largo plazo (descanso)
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
      <SectionHead>Adversarios</SectionHead>

      <label htmlFor="adversary-search">Buscar en el SRD</label>
      <input
        id="adversary-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="limo, matón, dragón…"
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
              Añadir al encuentro
            </button>
          </div>
          <span className="option-meta">
            Nivel {adversary.tier} · {prettify(adversary.type)} · Dificultad{' '}
            {adversary.difficulty} · PV {adversary.hp} · Estrés {adversary.stress}
          </span>
        </div>
      ))}

      <h3 className="mt-5">En el encuentro</h3>
      {room.adversaryInstances.length === 0 ? (
        <p className="muted">Todavía no hay nada en la mesa.</p>
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
                Quitar
              </button>
            </div>
            {stat === undefined ? null : (
              <>
                <span className="option-meta">
                  Dificultad {stat.difficulty} · Umbrales{' '}
                  {stat.thresholds === null
                    ? 'ninguno'
                    : `${stat.thresholds.major}/${stat.thresholds.severe ?? '—'}`}{' '}
                  · ATQ{' '}
                  {stat.attackModifier.flat === null
                    ? `${stat.attackModifier.roll?.count}d${stat.attackModifier.roll?.die}`
                    : stat.attackModifier.flat}
                </span>

                <div className="row mt-2">
                  <span className="muted">
                    PV {instance.hpMarked}/{stat.hp}
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
                    +PV
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
                    −PV
                  </button>
                  <span className="muted">
                    Estrés {instance.stressMarked}/{stat.stress}
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
                    +Estrés
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
                    −Estrés
                  </button>
                </div>

                <details>
                  <summary>Rasgos y ataque</summary>
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
                        {feature.costsFear ? ' (Miedo)' : ''}:
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
      <SectionHead>Entorno</SectionHead>
      <label htmlFor="environment">Entorno activo</label>
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
        <option value="">Ninguno</option>
        {environments.map((environment) => (
          <option key={environment.id} value={environment.id}>
            Nivel {environment.tier} — {environment.name}
          </option>
        ))}
      </select>

      {active === null ? null : (
        <div className="card mt-3">
          <strong>{active.name}</strong>
          <span className="option-meta">
            {' '}
            Nivel {active.tier} · {prettify(active.type)} · Dificultad {active.difficulty}
          </span>
          <p className="card-text">{active.description}</p>
          <p className="card-text">
            <strong>Impulsos:</strong> {active.impulses}
          </p>
          <p className="card-text">
            <strong>Posibles adversarios:</strong> {active.potentialAdversaries}
          </p>
          {active.features.map((feature) => (
            <p className="card-text" key={feature.name}>
              <strong>
                {feature.name} — {prettify(feature.type)}
                {feature.costsFear ? ' (Miedo)' : ''}:
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
      <SectionHead>En la mesa</SectionHead>
      <ul className="log">
        <li>
          <span className={room.gm.connected ? 'badge' : 'badge warn'}>
            {room.gm.connected ? 'conectado' : 'desconectado'}
          </span>{' '}
          {room.gm.name} <span className="muted">(DJ)</span>
        </li>
        {room.players.map((player) => (
          <li key={player.id}>
            <span className={player.connected ? 'badge' : 'badge warn'}>
              {player.connected ? 'conectado' : 'desconectado'}
            </span>{' '}
            {player.name}{' '}
            <span className="muted">
              {player.characterId === null
                ? 'sin personaje todavía'
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
      <SectionHead>Registro de tiradas</SectionHead>
      {room.rollLog.length === 0 ? <p className="muted">Todavía no hay tiradas.</p> : null}
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
                <span>{entry.roll.total} de daño</span>
              )}
            </div>
            <span className="muted">
              {entry.kind === 'duality'
                ? `Esperanza ${entry.roll.hope} · Miedo ${entry.roll.fear} · total ${entry.roll.total} vs ${entry.difficulty}`
                : `Dados ${entry.roll.rolls.join(', ')}${entry.critical ? ` · crítico +${entry.roll.criticalBonus}` : ''}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
