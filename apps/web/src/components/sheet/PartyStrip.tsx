import type { SheetState } from '@daggerheart/protocol';
import { MAX_FEAR } from '@daggerheart/rules';

import { t } from '../../i18n/index.js';
import { SectionHead } from '../SectionHead.js';

export interface PartyMember {
  id: string;
  name: string;
  sheet: SheetState;
}

interface PartyStripProps {
  /** Everyone at the table, this character included. */
  members: readonly PartyMember[];
  /** The character this sheet belongs to, which is drawn differently. */
  characterId: string | null;
  /** The GM's Fear pool, which players can see. */
  fear: number | null;
  /** True while the spotlight is on this character. */
  spotlit: boolean;
}

/** How much of a track is left, as "used / total". */
function Track({ label, used, total }: { label: string; used: number; total: number }) {
  return (
    <span className="muted">
      {label} {Math.max(0, total - used)}/{total}
    </span>
  );
}

/**
 * What the rest of the table looks like from a player's seat: the Fear the GM is
 * sitting on, whose turn it is, and how the party is holding up. All of it already
 * travels in room state; until now none of it was drawn on the sheet.
 */
export function PartyStrip({ members, characterId, fear, spotlit }: PartyStripProps) {
  if (members.length === 0 && fear === null) return null;

  return (
    <div className="panel">
      <SectionHead>{t('sheet.party.title')}</SectionHead>

      {fear === null ? null : (
        <p>
          <strong>{t('sheet.party.fear', { fear, max: MAX_FEAR })}</strong>
        </p>
      )}
      {spotlit ? <p className="spotlit">{t('sheet.party.yourTurn')}</p> : null}

      <div className="grid cols-2">
        {members.map((member) => (
          <div className="card" key={member.id}>
            <div className="card-head">
              <strong>
                {member.sheet.character.name ?? member.name}
                {member.id === characterId ? t('sheet.party.you') : ''}
              </strong>
            </div>
            <div className="row">
              <Track
                label={t('sheet.party.hp')}
                used={member.sheet.hpMarked}
                total={member.sheet.character.hpSlots}
              />
              <Track
                label={t('sheet.party.stress')}
                used={member.sheet.stressMarked}
                total={member.sheet.character.stressSlots}
              />
              <span className="muted">
                {t('sheet.party.hope')} {member.sheet.hope}
              </span>
            </div>
            {member.sheet.unconscious ? <p className="muted">{t('sheet.party.down')}</p> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
