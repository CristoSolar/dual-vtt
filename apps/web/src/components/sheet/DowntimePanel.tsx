import { DOWNTIME_MOVES, MOVES_PER_REST, isMoveAvailable, type DowntimeMove } from '@daggerheart/rules';
import type { Rest } from '@daggerheart/protocol';
import { useState } from 'react';

import { t, type MessageKey } from '../../i18n/index.js';
import { SectionHead } from '../SectionHead.js';

interface DowntimePanelProps {
  rest: Rest;
  /** This character's id, which is also the key its move budget is kept under. */
  characterId: string;
  /** Everyone at the table who could be tended to, this character included. */
  party: readonly { id: string; name: string }[];
  onMove: (move: DowntimeMove, targetId: string, withParty: boolean) => void;
}

/**
 * The two downtime moves a character spends during a rest.
 *
 * Tending wounds and repairing armor can be aimed at an ally, so those carry a
 * target; the rest act on whoever is holding the sheet.
 */
export function DowntimePanel({ rest, characterId, party, onMove }: DowntimePanelProps) {
  const left = rest.movesLeft[characterId] ?? 0;
  const [target, setTarget] = useState(characterId);
  const [withParty, setWithParty] = useState(false);

  const targeted = (move: DowntimeMove) => move === 'tendToWounds' || move === 'repairArmor';

  return (
    <div className="panel">
      <SectionHead>{t('sheet.downtime.title')}</SectionHead>
      <p className="muted">
        {t(rest.kind === 'long' ? 'sheet.downtime.longRest' : 'sheet.downtime.shortRest', {
          left,
          max: MOVES_PER_REST,
        })}
      </p>

      {party.length > 1 ? (
        <>
          <label htmlFor="downtime-target">{t('sheet.downtime.target')}</label>
          <select
            id="downtime-target"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          >
            {party.map((member) => (
              <option key={member.id} value={member.id}>
                {member.id === characterId ? t('sheet.downtime.self') : member.name}
              </option>
            ))}
          </select>
        </>
      ) : null}

      <div className="mt-3">
        <button type="button" aria-pressed={withParty} onClick={() => setWithParty((v) => !v)}>
          {withParty ? t('sheet.downtime.together') : t('sheet.downtime.alone')}
        </button>
      </div>

      <div className="row mt-3">
        {DOWNTIME_MOVES.filter((move) => isMoveAvailable(move, rest.kind)).map((move) => (
          <button
            key={move}
            type="button"
            disabled={left <= 0}
            title={t(`sheet.downtime.move.${move}.hint` as MessageKey)}
            onClick={() => onMove(move, targeted(move) ? target : characterId, withParty)}
          >
            {t(`sheet.downtime.move.${move}` as MessageKey)}
          </button>
        ))}
      </div>
    </div>
  );
}
