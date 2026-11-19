import {
  CAMPAIGN_PREP_EVENT_TYPES,
  type CampaignDetail,
  type CampaignPrepEvent,
  type CampaignStatus,
  type ManagedPlayer,
  type RoomEvent,
  type UpdateCampaignRequest,
} from '@daggerheart/protocol';
import { srd, type Adversary } from '@daggerheart/srd-data';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { JournalPanel } from '../components/journal/JournalPanel.js';
import { t } from '../i18n/index.js';
import {
  CAMPAIGN_STATUSES,
  filterAdversaries,
  invitablePlayers,
  parseCampaignDetail,
  parseManagedPlayers,
} from '../state/gmHome.js';
import { label as prettify } from '../state/selectors.js';
import { SERVER_URL } from '../state/useCampaign.js';

export type CampaignPageTab = 'story' | 'notes' | 'monsters' | 'players';
const TABS: readonly CampaignPageTab[] = ['story', 'notes', 'monsters', 'players'];

interface CampaignPageRouteProps {
  token: string;
  onSessionExpired: () => void;
  onUpdate: (campaignId: string, update: UpdateCampaignRequest) => Promise<boolean>;
  onEnter: (campaignId: string) => void;
  onInvite: (campaignId: string, username: string) => Promise<boolean>;
  onCancelInvite: (campaignId: string, userId: string) => Promise<boolean>;
  onRemove: (campaignId: string, userId: string) => Promise<boolean>;
}

/**
 * The GM's page for one campaign, away from the live table: its story, its
 * journal, the adversaries planned for it, and who plays. It reads
 * `GET /campaigns/:id` and changes the story, prep and journal through
 * `POST /campaigns/:id/prep`, which runs the same reducer the table does — so a
 * paused campaign can be prepared without anyone sitting down.
 */
export function CampaignPageRoute({
  token,
  onSessionExpired,
  onUpdate,
  onEnter,
  onInvite,
  onCancelInvite,
  onRemove,
}: CampaignPageRouteProps) {
  const campaignId = useParams().id ?? '';
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [players, setPlayers] = useState<readonly ManagedPlayer[]>([]);
  const [tab, setTab] = useState<CampaignPageTab>('story');
  const headers = useMemo(() => ({ authorization: `Bearer ${token}` }), [token]);

  const reload = useCallback(async (): Promise<void> => {
    const response = await fetch(`${SERVER_URL}/campaigns/${campaignId}`, { headers }).catch(() => null);
    if (response?.status === 401) return onSessionExpired();
    const parsed = response?.ok === true ? parseCampaignDetail(await response.json()) : null;
    setFailed(parsed === null);
    if (parsed !== null) setDetail(parsed);
  }, [campaignId, headers, onSessionExpired]);

  useEffect(() => {
    void reload();
    void fetch(`${SERVER_URL}/players`, { headers })
      .then((response) => (response.ok ? response.json() : []))
      .then((body: unknown) => setPlayers(parseManagedPlayers(body)))
      .catch(() => undefined);
  }, [reload, headers]);

  const sendPrep = useCallback(
    async (event: CampaignPrepEvent): Promise<boolean> => {
      const response = await fetch(`${SERVER_URL}/campaigns/${campaignId}/prep`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(event),
      }).catch(() => null);
      if (response?.status === 401) onSessionExpired();
      const parsed = response?.ok === true ? parseCampaignDetail(await response.json()) : null;
      if (parsed !== null) setDetail(parsed);
      return parsed !== null;
    },
    [campaignId, headers, onSessionExpired],
  );

  const after = (action: Promise<boolean>): void => {
    void action.then(() => reload());
  };

  if (detail === null) {
    return (
      <section>
        <Link to="/campaigns">{t('campaignPage.back')}</Link>
        <p className={failed ? 'errors' : 'muted'} role={failed ? 'alert' : undefined}>
          {failed ? t('campaignPage.loadFailed') : t('common.loading')}
        </p>
      </section>
    );
  }

  return (
    <CampaignPageView
      detail={detail}
      players={players}
      tab={tab}
      onTab={setTab}
      authToken={token}
      sendPrep={sendPrep}
      onUpdate={(update) => after(onUpdate(campaignId, update))}
      onEnter={() => onEnter(campaignId)}
      onInvite={(username) => after(onInvite(campaignId, username))}
      onCancelInvite={(userId) => after(onCancelInvite(campaignId, userId))}
      onRemove={(userId) => after(onRemove(campaignId, userId))}
    />
  );
}

interface CampaignPageViewProps {
  detail: CampaignDetail;
  /** The players this GM manages, for the invite picker. */
  players: readonly ManagedPlayer[];
  tab: CampaignPageTab;
  onTab: (tab: CampaignPageTab) => void;
  authToken: string | null;
  sendPrep: (event: CampaignPrepEvent) => Promise<boolean>;
  onUpdate: (update: UpdateCampaignRequest) => void;
  onEnter: () => void;
  onInvite: (username: string) => void;
  onCancelInvite: (userId: string) => void;
  onRemove: (userId: string) => void;
}

export function CampaignPageView({
  detail,
  players,
  tab,
  onTab,
  authToken,
  sendPrep,
  onUpdate,
  onEnter,
  onInvite,
  onCancelInvite,
  onRemove,
}: CampaignPageViewProps) {
  const { campaign } = detail;
  const [name, setName] = useState(campaign.name);

  return (
    <section className="campaign-page">
      <Link to="/campaigns">{t('campaignPage.back')}</Link>
      <div className="hero campaign-page-head">
        <h1>{campaign.name}</h1>
        <div className="row campaign-page-controls">
          <form
            className="row"
            onSubmit={(event) => {
              event.preventDefault();
              const next = name.trim();
              if (next !== '' && next !== campaign.name) onUpdate({ name: next });
            }}
          >
            <label className="sr-only" htmlFor="campaign-rename">
              {t('campaigns.name')}
            </label>
            <input id="campaign-rename" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            <button type="submit" className="btn-ghost" disabled={name.trim() === '' || name.trim() === campaign.name}>
              {t('campaignPage.rename')}
            </button>
          </form>
          <label htmlFor="campaign-status">{t('campaignPage.status')}</label>
          <select
            id="campaign-status"
            value={campaign.status}
            onChange={(event) => onUpdate({ status: event.target.value as CampaignStatus })}
          >
            {CAMPAIGN_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`status.${status}`)}
              </option>
            ))}
          </select>
          <button type="button" className="btn-primary" onClick={onEnter}>
            {t('gmCampaigns.enterTable')}
          </button>
        </div>
        {campaign.status === 'active' ? null : <p className="muted">{t('campaignPage.notActiveHint')}</p>}
      </div>

      <nav className="sheet-tabs mb-4" role="tablist" aria-label={t('campaignPage.tabsAria')}>
        {TABS.map((entry) => (
          <button
            key={entry}
            type="button"
            className="sheet-tab"
            role="tab"
            aria-selected={tab === entry}
            onClick={() => onTab(entry)}
          >
            {t(`campaignPage.tab.${entry}`)}
          </button>
        ))}
      </nav>

      {tab === 'story' ? <StoryTab detail={detail} sendPrep={sendPrep} /> : null}
      {tab === 'notes' ? <NotesTab detail={detail} sendPrep={sendPrep} authToken={authToken} /> : null}
      {tab === 'monsters' ? <MonstersTab detail={detail} sendPrep={sendPrep} /> : null}
      {tab === 'players' ? (
        <PlayersTab
          detail={detail}
          players={players}
          onInvite={onInvite}
          onCancelInvite={onCancelInvite}
          onRemove={onRemove}
        />
      ) : null}
    </section>
  );
}

function StoryTab({ detail, sendPrep }: Pick<CampaignPageViewProps, 'detail' | 'sendPrep'>) {
  const [pitch, setPitch] = useState(detail.story.pitch);
  const [body, setBody] = useState(detail.story.body);
  const [status, setStatus] = useState<'idle' | 'saved' | 'failed'>('idle');
  const dirty = pitch !== detail.story.pitch || body !== detail.story.body;

  return (
    <form
      className="panel"
      onSubmit={(event) => {
        event.preventDefault();
        void sendPrep({ type: 'setStory', story: { pitch, body } }).then((ok) => setStatus(ok ? 'saved' : 'failed'));
      }}
    >
      <label htmlFor="story-pitch">{t('story.pitch')}</label>
      <textarea
        id="story-pitch"
        rows={2}
        maxLength={500}
        value={pitch}
        aria-describedby="story-pitch-hint"
        onChange={(e) => {
          setPitch(e.target.value);
          setStatus('idle');
        }}
      />
      <p className="muted" id="story-pitch-hint">
        {t('story.pitchHint')}
      </p>
      <label htmlFor="story-body" className="mt-3">
        {t('story.body')}
      </label>
      <textarea
        id="story-body"
        rows={14}
        maxLength={50_000}
        value={body}
        aria-describedby="story-body-hint"
        onChange={(e) => {
          setBody(e.target.value);
          setStatus('idle');
        }}
      />
      <p className="muted" id="story-body-hint">
        {t('story.bodyHint')}
      </p>
      <div className="row mt-3">
        <button type="submit" className="btn-primary" disabled={!dirty}>
          {t('story.save')}
        </button>
        {dirty ? <span className="muted">{t('story.unsaved')}</span> : null}
        {status === 'saved' && !dirty ? (
          <span className="muted" role="status">
            {t('campaignPage.saved')}
          </span>
        ) : null}
        {status === 'failed' ? (
          <span className="errors" role="alert">
            {t('campaignPage.saveFailed')}
          </span>
        ) : null}
      </div>
    </form>
  );
}

const isPrepEvent = (event: RoomEvent): event is CampaignPrepEvent =>
  (CAMPAIGN_PREP_EVENT_TYPES as readonly string[]).includes(event.type);

/** The room's journal, the same panel the table uses, edited over HTTP here. */
function NotesTab({
  detail,
  sendPrep,
  authToken,
}: Pick<CampaignPageViewProps, 'detail' | 'sendPrep' | 'authToken'>) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="panel">
      <p className="muted">{t('notes.hint')}</p>
      <JournalPanel
        journal={detail.journal}
        isGameMaster
        openId={openId}
        onOpen={setOpenId}
        send={(event) => {
          if (isPrepEvent(event)) void sendPrep(event);
        }}
        authToken={authToken}
        notes={[]}
      />
    </div>
  );
}

let prepCounter = 0;
const nextPrepId = (): string => {
  prepCounter += 1;
  return `prep-${Date.now().toString(36)}-${prepCounter.toString(36)}`;
};

/** How many search results are drawn at once; the filters narrow the rest. */
const MAX_RESULTS = 30;
const TIERS = [1, 2, 3, 4] as const;

function MonstersTab({ detail, sendPrep }: Pick<CampaignPageViewProps, 'detail' | 'sendPrep'>) {
  const [query, setQuery] = useState('');
  const [tier, setTier] = useState<number | null>(null);
  const [type, setType] = useState<Adversary['type'] | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const all = srd().adversaries;
  const types = useMemo(() => [...new Set(all.map((a) => a.type))].sort(), [all]);
  const matches = useMemo(() => filterAdversaries(all, { query, tier, type }), [all, query, tier, type]);
  const byId = (id: string) => all.find((a) => a.id === id);

  const prepare = (adversary: Adversary): void => {
    // Preparing one already on the list adds to its count rather than a second row.
    const existing = detail.prepAdversaries.find((p) => p.adversaryId === adversary.id);
    void sendPrep({
      type: 'upsertPrepAdversary',
      entry:
        existing === undefined
          ? { id: nextPrepId(), adversaryId: adversary.id, quantity, note: note.trim() }
          : {
              ...existing,
              quantity: Math.min(20, existing.quantity + quantity),
              note: note.trim() === '' ? existing.note : note.trim(),
            },
    });
    setNote('');
  };

  return (
    <div className="grid cols-2 campaign-monsters">
      <div className="panel">
        <h2>{t('monsters.prepared')}</h2>
        {detail.prepAdversaries.length === 0 ? <p className="muted">{t('monsters.none')}</p> : null}
        {detail.prepAdversaries.map((entry) => {
          const stat = byId(entry.adversaryId);
          return (
            <div className="card" key={entry.id}>
              <div className="card-head">
                <strong>{stat?.name ?? entry.adversaryId}</strong>
                <div className="row">
                  <label className="sr-only" htmlFor={`prep-qty-${entry.id}`}>
                    {t('monsters.quantity')}
                  </label>
                  <input
                    id={`prep-qty-${entry.id}`}
                    type="number"
                    min={1}
                    max={20}
                    className="prep-qty"
                    value={entry.quantity}
                    onChange={(e) => {
                      const next = Math.max(1, Math.min(20, Number(e.target.value) || 1));
                      void sendPrep({ type: 'upsertPrepAdversary', entry: { ...entry, quantity: next } });
                    }}
                  />
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => void sendPrep({ type: 'removePrepAdversary', id: entry.id })}
                  >
                    {t('monsters.remove')}
                  </button>
                </div>
              </div>
              {stat === undefined ? null : (
                <span className="option-meta">
                  {t('monsters.meta', {
                    tier: stat.tier,
                    type: prettify(stat.type),
                    difficulty: stat.difficulty,
                    hp: stat.hp,
                  })}
                </span>
              )}
              {entry.note === '' ? null : <p>{entry.note}</p>}
            </div>
          );
        })}
      </div>

      <div className="panel">
        <label htmlFor="monster-search">{t('monsters.searchLabel')}</label>
        <input
          id="monster-search"
          value={query}
          placeholder={t('monsters.searchPlaceholder')}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="row mt-3">
          <label className="sr-only" htmlFor="monster-tier">
            {t('monsters.tier')}
          </label>
          <select
            id="monster-tier"
            value={tier ?? ''}
            onChange={(e) => setTier(e.target.value === '' ? null : Number(e.target.value))}
          >
            <option value="">{t('monsters.anyTier')}</option>
            {TIERS.map((n) => (
              <option key={n} value={n}>
                {t('monsters.tier')} {n}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="monster-type">
            {t('monsters.type')}
          </label>
          <select
            id="monster-type"
            value={type ?? ''}
            onChange={(e) => setType(e.target.value === '' ? null : (e.target.value as Adversary['type']))}
          >
            <option value="">{t('monsters.anyType')}</option>
            {types.map((value) => (
              <option key={value} value={value}>
                {prettify(value)}
              </option>
            ))}
          </select>
        </div>
        <div className="row mt-3">
          <label htmlFor="monster-qty">{t('monsters.quantity')}</label>
          <input
            id="monster-qty"
            type="number"
            min={1}
            max={20}
            className="prep-qty"
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
          />
          <label htmlFor="monster-note">{t('monsters.note')}</label>
          <input
            id="monster-note"
            maxLength={300}
            value={note}
            placeholder={t('monsters.notePlaceholder')}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <p className="muted mt-3">{t('monsters.results', { shown: Math.min(MAX_RESULTS, matches.length), count: matches.length })}</p>
        {matches.slice(0, MAX_RESULTS).map((adversary) => (
          <div className="card" key={adversary.id}>
            <div className="card-head">
              <strong>{adversary.name}</strong>
              <button type="button" onClick={() => prepare(adversary)}>
                {t('monsters.add')}
              </button>
            </div>
            <span className="option-meta">
              {t('monsters.meta', {
                tier: adversary.tier,
                type: prettify(adversary.type),
                difficulty: adversary.difficulty,
                hp: adversary.hp,
              })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlayersTab({
  detail,
  players,
  onInvite,
  onCancelInvite,
  onRemove,
}: Pick<CampaignPageViewProps, 'detail' | 'players' | 'onInvite' | 'onCancelInvite' | 'onRemove'>) {
  const [username, setUsername] = useState('');
  const [removing, setRemoving] = useState<{ id: string; username: string } | null>(null);
  const candidates = invitablePlayers(players, detail.campaign);
  const className = (classId: string) => srd().classes.find((c) => c.id === classId)?.name ?? classId;

  return (
    <div className="grid cols-2">
      <div className="panel">
        <h2>{t('members.title')}</h2>
        {detail.members.length === 0 ? <p className="muted">{t('members.none')}</p> : null}
        <ul className="member-list">
          {detail.members.map((member) => (
            <li key={member.id} className="row spread">
              <span>
                <strong>{member.username}</strong>
                <br />
                <span className="muted">
                  {member.character === null
                    ? t('members.noCharacter')
                    : t('members.character', {
                        name: member.character.name ?? t('library.unnamed'),
                        className: className(member.character.classId),
                        level: member.character.level,
                      })}
                </span>
              </span>
              <button type="button" className="btn-ghost" onClick={() => setRemoving(member)}>
                {t('members.remove')}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="panel">
        <h2>{t('invite.title')}</h2>
        {candidates.length === 0 ? (
          <p className="muted">{t('invite.none')}</p>
        ) : (
          <form
            className="row"
            onSubmit={(event) => {
              event.preventDefault();
              if (username === '') return;
              onInvite(username);
              setUsername('');
            }}
          >
            <label className="sr-only" htmlFor="invite-player">
              {t('common.username')}
            </label>
            <select id="invite-player" value={username} onChange={(e) => setUsername(e.target.value)}>
              <option value="">{t('campaigns.choosePlayer')}</option>
              {candidates.map((player) => (
                <option key={player.id} value={player.username}>
                  {player.username}
                </option>
              ))}
            </select>
            <button type="submit" disabled={username === ''}>
              {t('campaigns.add')}
            </button>
          </form>
        )}
        {detail.invited.length > 0 ? (
          <div className="pending-invites mt-4">
            <p className="muted">{t('campaigns.pendingInvites')}</p>
            <ul>
              {detail.invited.map((invitee) => (
                <li key={invitee.id} className="row spread">
                  <span>{invitee.username}</span>
                  <button
                    type="button"
                    className="btn-ghost"
                    aria-label={t('campaigns.cancelInviteLabel', { username: invitee.username })}
                    onClick={() => onCancelInvite(invitee.id)}
                  >
                    {t('campaigns.cancelInvite')}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {removing !== null ? (
        <ConfirmDialog
          title={t('members.remove')}
          body={t('members.removeConfirm', { username: removing.username })}
          confirmLabel={t('members.remove')}
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            onRemove(removing.id);
            setRemoving(null);
          }}
        />
      ) : null}
    </div>
  );
}
