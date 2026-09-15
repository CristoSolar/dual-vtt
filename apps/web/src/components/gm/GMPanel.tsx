import {
  outcomeTone,
  type Countdown,
  type RoomEvent,
  type RoomState,
} from '@daggerheart/protocol';
import { MAX_FEAR } from '@daggerheart/rules';
import { srd } from '@daggerheart/srd-data';
import { useMemo, useState } from 'react';

import { t, type MessageKey } from '../../i18n/index.js';
import { label as prettify } from '../../state/selectors.js';
import { SectionHead } from '../SectionHead.js';

interface GMPanelProps {
  room: RoomState;
  campaignName: string;
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
export function GMPanel({ room, campaignName, send }: GMPanelProps) {
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

function Adversaries({
  room,
  send,
}: {
  room: RoomState;
  send: (event: RoomEvent) => void;
}) {
  const [query, setQuery] = useState('');

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

      <label htmlFor="adversary-search">{t('gm.adversaries.searchLabel')}</label>
      <input
        id="adversary-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('gm.adversaries.searchPlaceholder')}
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
              <button
                type="button"
                onClick={() => send({ type: 'removeAdversary', instanceId: instance.instanceId })}
              >
                {t('gm.remove')}
              </button>
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
                    <p className="card-text" key={feature.name}>
                      <strong>
                        {feature.name} — {prettify(feature.type)}
                        {feature.costsFear ? t('gm.fearSuffix') : ''}:
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
            <p className="card-text" key={feature.name}>
              <strong>
                {feature.name} — {prettify(feature.type)}
                {feature.costsFear ? t('gm.fearSuffix') : ''}:
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

function SharedRollLog({ room }: { room: RoomState }) {
  return (
    <div className="panel">
      <SectionHead>{t('sheet.log.title')}</SectionHead>
      {room.rollLog.length === 0 ? <p className="muted">{t('gm.rollLog.empty')}</p> : null}
      <ul className="log">
        {room.rollLog.map((entry) => (
          <li key={entry.id}>
            <div className="row spread">
              <strong>
                {entry.by} — {entry.label}
              </strong>
              {entry.kind === 'duality' ? (
                <span className="outcome" data-tone={outcomeTone(entry.outcome)}>
                  {t(`roll.outcome.${entry.outcome}` as MessageKey)}
                </span>
              ) : (
                <span>
                  {entry.roll.total}
                  {t('gm.rollLog.damageSuffix')}
                </span>
              )}
            </div>
            <span className="muted">
              {entry.kind === 'duality'
                ? t('gm.rollLog.dualityMeta', {
                    hope: entry.roll.hope,
                    fear: entry.roll.fear,
                    total: entry.roll.total,
                    difficulty: entry.difficulty,
                  })
                : t('gm.rollLog.damageMeta', {
                    rolls: entry.roll.rolls.join(', '),
                    critical: entry.critical
                      ? t('gm.rollLog.criticalSuffix', { bonus: entry.roll.criticalBonus })
                      : '',
                  })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
