import { DICE_SIDES, formatDiceTray, type RoomEvent, type Visibility } from '@daggerheart/protocol';
import { useId, useState } from 'react';

import { t } from '../../i18n/index.js';
import { addDie, clampModifier, removeDie, trayDice, trayIntent, type TrayCounts } from '../../state/diceTray.js';
import { SectionHead } from '../SectionHead.js';

interface DiceTrayPanelProps {
  send: (event: RoomEvent) => void;
  /** The roller's own character, for a duality roll; null hides it (the GM rolls d20s). */
  characterId: string | null;
  /** False during a Tag Team or as a group action's collaborator, which the table must see. */
  canRollDualityPrivately: boolean;
  /** The token the roller is targeting, whose Difficulty the server then uses. */
  targetTokenId: string | null;
  diceOn: boolean;
  onToggleDice?: (() => void) | undefined;
}

type Edge = 'none' | 'advantage' | 'disadvantage';

/**
 * The map's dice menu, as in Foundry: a duality roll for a player's own character,
 * loose dice of every other size for anybody, and the 3D dice switch. It sends
 * intents only; every die is rolled on the server.
 */
export function DiceTrayPanel({
  send,
  characterId,
  canRollDualityPrivately,
  targetTokenId,
  diceOn,
  onToggleDice,
}: DiceTrayPanelProps) {
  const id = useId();
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [dualityModifier, setDualityModifier] = useState(0);
  const [edge, setEdge] = useState<Edge>('none');
  const [tray, setTray] = useState<TrayCounts>({});
  const [modifier, setModifier] = useState(0);
  const [label, setLabel] = useState('');

  const dice = trayDice(tray);

  const rollDuality = () => {
    if (characterId === null) return;
    send({
      type: 'rollDuality',
      characterId,
      request: {
        label: t('tray.dualityLabel'),
        modifiers: Math.max(-20, Math.min(20, dualityModifier)),
        // The GM keeps the Difficulty and calls success; a target still supplies its own.
        difficulty: null,
        advantage: edge === 'advantage' ? 1 : 0,
        disadvantage: edge === 'disadvantage' ? 1 : 0,
        helpDice: 0,
        reaction: false,
        experiences: [],
      },
      visibility: canRollDualityPrivately ? visibility : 'public',
      ...(targetTokenId === null ? {} : { targetTokenId }),
    });
  };

  const rollTray = () => {
    const intent = trayIntent(tray, modifier, visibility);
    if (intent === null) return;
    const named = label.trim();
    send(named === '' || intent.type !== 'rollDice' ? intent : { ...intent, label: named.slice(0, 60) });
  };

  const number = (value: string) => clampModifier(Number(value));

  return (
    <div className="dice-tray">
      {characterId === null ? null : (
        <section>
          <SectionHead>{t('tray.dualityTitle')}</SectionHead>
          <div className="dice-tray-fields">
            <label htmlFor={`${id}-dmod`}>
              {t('tray.modifier')}
              <input
                id={`${id}-dmod`}
                type="number"
                min={-20}
                max={20}
                value={dualityModifier}
                onChange={(event) => setDualityModifier(number(event.target.value))}
              />
            </label>
            <label htmlFor={`${id}-edge`}>
              {t('tray.edge')}
              <select id={`${id}-edge`} value={edge} onChange={(event) => setEdge(event.target.value as Edge)}>
                <option value="none">{t('tray.edgeNone')}</option>
                <option value="advantage">{t('tray.edgeAdvantage')}</option>
                <option value="disadvantage">{t('tray.edgeDisadvantage')}</option>
              </select>
            </label>
          </div>
          <button type="button" className="btn-primary" onClick={rollDuality}>
            {t('tray.rollDuality')}
          </button>
          {canRollDualityPrivately ? null : <p className="muted">{t('tray.privateDualityBlocked')}</p>}
        </section>
      )}

      <section>
        <SectionHead>{t('tray.diceTitle')}</SectionHead>
        <div className="dice-tray-dice">
          {DICE_SIDES.map((sides) => {
            const count = tray[sides] ?? 0;
            return (
              <button
                type="button"
                key={sides}
                className="dice-tray-die"
                aria-label={t('tray.addDie', { sides, count })}
                aria-pressed={count > 0}
                onClick={() => setTray((current) => addDie(current, sides))}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setTray((current) => removeDie(current, sides));
                }}
              >
                <span>d{sides}</span>
                {count > 0 ? <span className="dice-tray-count">{count}</span> : null}
              </button>
            );
          })}
        </div>
        <p className="muted">{t('tray.diceHint')}</p>
        <div className="dice-tray-fields">
          <label htmlFor={`${id}-mod`}>
            {t('tray.modifier')}
            <input
              id={`${id}-mod`}
              type="number"
              min={-99}
              max={99}
              value={modifier}
              onChange={(event) => setModifier(number(event.target.value))}
            />
          </label>
          <label htmlFor={`${id}-label`}>
            {t('tray.label')}
            <input
              id={`${id}-label`}
              type="text"
              maxLength={60}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
        </div>
        <div className="row">
          <button type="button" className="btn-primary" disabled={dice.length === 0} onClick={rollTray}>
            {dice.length === 0 ? t('tray.empty') : t('tray.roll', { dice: formatDiceTray(dice, modifier) })}
          </button>
          <button
            type="button"
            disabled={dice.length === 0 && modifier === 0 && label === ''}
            onClick={() => {
              setTray({});
              setModifier(0);
              setLabel('');
            }}
          >
            {t('tray.clear')}
          </button>
        </div>
      </section>

      <div className="row mt-2">
        <label htmlFor={`${id}-private`}>
          <input
            id={`${id}-private`}
            type="checkbox"
            checked={visibility === 'private'}
            onChange={(event) => setVisibility(event.target.checked ? 'private' : 'public')}
          />{' '}
          {t('roll.privateToggle')}
        </label>
        {onToggleDice === undefined ? null : (
          <label htmlFor={`${id}-3d`}>
            <input id={`${id}-3d`} type="checkbox" checked={diceOn} onChange={onToggleDice} />{' '}
            {t('map.dice3d')}
          </label>
        )}
      </div>
    </div>
  );
}
