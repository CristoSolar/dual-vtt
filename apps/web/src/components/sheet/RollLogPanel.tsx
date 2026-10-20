import type { PrivateEntry } from '@daggerheart/protocol';
import { useId, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';

import { t, type MessageKey } from '../../i18n/index.js';
import { mergeFeed } from '../../state/feed.js';
import { effectCopy, outcomeTone, type RollEntry } from '../../state/rollLog.js';
import { SectionHead } from '../SectionHead.js';

/** Who a chat line can go to, and how to send it. Present only in a campaign. */
export interface ChatProps {
  /** The GM's account, offered as a whisper target; null when the GM is the one writing. */
  gmId: string | null;
  /** The other players, by account. */
  players: readonly { id: string; name: string }[];
  /** `whisperTo` empty says it to the whole table. */
  onSend: (text: string, whisperTo: string[]) => void;
}

interface RollLogPanelProps {
  entries: readonly RollEntry[];
  /** Whispers and private rolls this account may see. */
  privateEntries?: readonly PrivateEntry[] | undefined;
  chat?: ChatProps | undefined;
}

const NO_PRIVATE: readonly PrivateEntry[] = [];

/** What a filter narrows the log to. */
type LogFilter = 'all' | 'duality' | 'attack' | 'damage' | 'dice' | 'effect' | 'fate' | 'message' | 'table';

/**
 * The session's rolls and chat, most recent first.
 *
 * A long fight fills this with damage rolls, and the one action roll somebody
 * wants to look back at scrolls away, so the kinds can be narrowed and the whole
 * thing collapsed when the table is doing something else.
 */
export function RollLogPanel({ entries, privateEntries = NO_PRIVATE, chat }: RollLogPanelProps) {
  const [filter, setFilter] = useState<LogFilter>('all');
  const [collapsed, setCollapsed] = useState(false);

  const feed = useMemo(() => mergeFeed(entries, privateEntries), [entries, privateEntries]);
  const shown = useMemo(
    () => (filter === 'all' ? feed : feed.filter((item) => item.entry.kind === filter)),
    [feed, filter],
  );

  if (feed.length === 0) {
    return (
      <div className="panel">
        <SectionHead>{t('sheet.log.title')}</SectionHead>
        <p className="muted">{t('sheet.log.empty')}</p>
        {/* Keyed so the first line logged does not remount it and drop the recipient. */}
        {chat === undefined ? null : <ChatBox key="chat" {...chat} />}
      </div>
    );
  }

  return (
    <div className="panel">
      <SectionHead>{t('sheet.log.title')}</SectionHead>
      <div className="row">
        <label className="sr-only" htmlFor="log-filter">
          {t('sheet.log.filterLabel')}
        </label>
        <select
          id="log-filter"
          value={filter}
          onChange={(event) => setFilter(event.target.value as LogFilter)}
        >
          {(['all', 'duality', 'attack', 'damage', 'dice', 'effect', 'fate', 'message', 'table'] as const).map((kind) => (
            <option key={kind} value={kind}>
              {t(`sheet.log.filter.${kind}` as MessageKey)}
            </option>
          ))}
        </select>
        <button type="button" aria-expanded={!collapsed} onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? t('sheet.log.expand') : t('sheet.log.collapse')}
        </button>
      </div>
      {collapsed ? null : shown.length === 0 ? (
        <p className="muted">{t('sheet.log.noneOfThatKind')}</p>
      ) : (
      <ul className="log">
        {shown.map(({ entry, private: isPrivate }) => (
          <li key={entry.id}>
            {isPrivate ? <PrivateBadge /> : null}
            {entry.kind === 'message' ? (
              <MessageLine by={entry.by} text={entry.text} />
            ) : entry.kind === 'effect' ? (
              <EffectLine entry={entry} />
            ) : entry.kind === 'dice' ? (
              <DiceLine entry={entry} />
            ) : entry.kind === 'duality' ? (
              <>
                <div className="row spread">
                  <strong>{entry.label}</strong>
                  <span className="outcome" data-tone={outcomeTone(entry.outcome)}>
                    {t(`roll.outcome.${entry.outcome}` as MessageKey)}
                  </span>
                </div>
                <span className="muted">
                  {t('sheet.log.dualityMeta', { hope: entry.roll.hope, fear: entry.roll.fear })}
                  {entry.roll.modifiers !== 0
                    ? t('sheet.log.modifier', { mod: entry.roll.modifiers })
                    : ''}
                  {t('sheet.log.totalVs', { total: entry.roll.total, difficulty: entry.difficulty })}
                  {entry.target === null ? '' : t('sheet.log.target', { target: entry.target })}
                  {entry.experiences.length > 0 ? ` · ${entry.experiences.join(', ')}` : ''}
                </span>
              </>
            ) : entry.kind === 'attack' ? (
              <>
                <div className="row spread">
                  <strong>
                    {entry.by} · {entry.label}
                  </strong>
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
                </div>
                <span className="muted">
                  {t('sheet.log.attackDice', { dice: entry.roll.dice.join(', ') })}
                  {entry.roll.modifier !== 0
                    ? t('sheet.log.modifier', { mod: entry.roll.modifier })
                    : ''}
                  {entry.roll.experience !== 0
                    ? t('sheet.log.modifier', { mod: entry.roll.experience })
                    : ''}
                  {entry.evasion === null
                    ? t('sheet.log.attackNoTarget', { total: entry.roll.total })
                    : t('sheet.log.attackVs', {
                        total: entry.roll.total,
                        evasion: entry.evasion,
                        target: entry.target ?? '',
                      })}
                </span>
              </>
            ) : entry.kind === 'fate' ? (
              <div className="row spread">
                <strong>{entry.label}</strong>
                <span>{entry.value}</span>
              </div>
            ) : entry.kind === 'table' ? (
              <div className="row spread">
                <strong>{entry.label}</strong>
                <span>{entry.result}</span>
              </div>
            ) : (
              <>
                <div className="row spread">
                  <strong>{entry.label}</strong>
                  <span>{t('sheet.log.damageTotal', { total: entry.roll.total })}</span>
                </div>
                <span className="muted">
                  {t('sheet.log.dice', { rolls: entry.roll.rolls.join(', ') })}
                  {entry.roll.modifier !== 0
                    ? t('sheet.log.modifier', { mod: entry.roll.modifier })
                    : ''}
                  {entry.critical
                    ? t('sheet.log.criticalBonus', { bonus: entry.roll.criticalBonus })
                    : ''}
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      )}
      {chat === undefined ? null : <ChatBox key="chat" {...chat} />}
    </div>
  );
}

/** A feature or spell somebody used, with its text in the reader's language. */
export function EffectLine({ entry }: { entry: Extract<RollEntry, { kind: 'effect' }> }) {
  const { title, text } = effectCopy(entry);
  return (
    <>
      <div className="row spread">
        <strong>
          {entry.by} · {title}
        </strong>
        <span className="muted">{t(`sheet.log.effect.${entry.source}` as MessageKey)}</span>
      </div>
      {/* A card's text runs long; folded, a cast spell does not bury the chat. */}
      {text === null ? null : (
        <details>
          <summary className="muted">{t('sheet.log.effectText')}</summary>
          <p className="chat-text">{text}</p>
        </details>
      )}
    </>
  );
}

/** Loose dice from the tray: the total, then each size's faces. */
export function DiceLine({ entry }: { entry: Extract<RollEntry, { kind: 'dice' }> }) {
  return (
    <>
      <div className="row spread">
        <strong>
          {entry.by} · {entry.label}
        </strong>
        <span>{entry.total}</span>
      </div>
      <span className="muted">
        {entry.groups
          .map((group) => t('sheet.log.diceGroup', { sides: group.sides, rolls: group.rolls.join(', ') }))
          .join(' · ')}
        {entry.modifier !== 0 ? t('sheet.log.modifier', { mod: entry.modifier }) : ''}
      </span>
    </>
  );
}

export function PrivateBadge() {
  return <span className="badge">{t('log.private')}</span>;
}

/** A chat line: plain text, line breaks kept, nothing interpreted as markup. */
export function MessageLine({ by, text }: { by: string; text: string }) {
  return (
    <>
      <strong>{by}</strong>
      <p className="chat-text">{text}</p>
    </>
  );
}

/** Where a line goes: the whole table, the GM, or one player. */
export function ChatBox({ gmId, players, onSend }: ChatProps) {
  const id = useId();
  const [text, setText] = useState('');
  /** '' is everyone; otherwise the account whispered to. */
  const [to, setTo] = useState('');

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const trimmed = text.trim();
    if (trimmed === '') return;
    onSend(trimmed, to === '' ? [] : [to]);
    setText('');
  };

  // Enter sends, as in any chat; Shift+Enter is still a line break.
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) submit(event);
  };

  return (
    <form className="chat-box mt-2" onSubmit={submit}>
      <label className="sr-only" htmlFor={`${id}-text`}>
        {t('chat.label')}
      </label>
      <textarea
        id={`${id}-text`}
        rows={2}
        maxLength={500}
        value={text}
        placeholder={t('chat.placeholder')}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="row">
        <label htmlFor={`${id}-to`}>{t('chat.to')}</label>
        <select id={`${id}-to`} value={to} onChange={(event) => setTo(event.target.value)}>
          <option value="">{t('chat.toAll')}</option>
          {gmId === null ? null : <option value={gmId}>{t('chat.toGm')}</option>}
          {players.map((player) => (
            <option key={player.id} value={player.id}>
              {player.name}
            </option>
          ))}
        </select>
        <button type="submit" disabled={text.trim() === ''}>
          {t('chat.send')}
        </button>
      </div>
    </form>
  );
}
