import { useState } from 'react';

import { t } from '../../i18n/index.js';
import { SectionHead } from '../SectionHead.js';

export interface TagTeam {
  initiatorId: string;
  partnerId: string;
  rolls: Record<string, { outcome: string; total: number }>;
}

interface TagTeamPanelProps {
  /** This sheet's character id. */
  characterId: string;
  /** Everyone at the table who has claimed a character. */
  party: readonly { id: string; name: string }[];
  /** The Tag Team Roll in progress, or null. */
  tagTeam: TagTeam | null;
  onStart: (partnerCharacterId: string) => void;
  onChoose: (rollOf: string) => void;
}

/**
 * Tag Team Rolls (SRD 2.0 p.49).
 *
 * Three Hope opens one. Both characters then roll as usual, but neither roll pays
 * out until the initiator picks the one that applies to both actions, which is why
 * the choice lives here rather than in the roll dialog.
 */
export function TagTeamPanel({
  characterId,
  party,
  tagTeam,
  onStart,
  onChoose,
}: TagTeamPanelProps) {
  const others = party.filter((member) => member.id !== characterId);
  const [partner, setPartner] = useState(others[0]?.id ?? '');
  const nameOf = (id: string) => party.find((member) => member.id === id)?.name ?? id;

  if (others.length === 0) return null;

  const open = tagTeam !== null;
  const mine = tagTeam !== null && tagTeam.initiatorId === characterId;
  const involved =
    tagTeam !== null && (tagTeam.initiatorId === characterId || tagTeam.partnerId === characterId);
  const rolled = tagTeam === null ? [] : Object.keys(tagTeam.rolls);

  return (
    <div className="panel">
      <SectionHead>{t('sheet.tagTeam.title')}</SectionHead>

      {!open ? (
        <>
          <p className="muted">{t('sheet.tagTeam.cost')}</p>
          <label htmlFor="tag-team-partner">{t('sheet.tagTeam.partner')}</label>
          <select
            id="tag-team-partner"
            value={partner}
            onChange={(event) => setPartner(event.target.value)}
          >
            {others.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
          <button type="button" disabled={partner === ''} onClick={() => onStart(partner)}>
            {t('sheet.tagTeam.start')}
          </button>
        </>
      ) : (
        <>
          <p>
            {t('sheet.tagTeam.open', {
              initiator: nameOf(tagTeam.initiatorId),
              partner: nameOf(tagTeam.partnerId),
            })}
          </p>
          {involved && rolled.length < 2 ? (
            <p className="muted">{t('sheet.tagTeam.waiting')}</p>
          ) : null}
          {mine && rolled.length === 2 ? (
            <>
              <p className="muted">{t('sheet.tagTeam.choose')}</p>
              {rolled.map((id) => (
                <button key={id} type="button" onClick={() => onChoose(id)}>
                  {t('sheet.tagTeam.useRoll', {
                    who: nameOf(id),
                    total: tagTeam.rolls[id]?.total ?? 0,
                  })}
                </button>
              ))}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
