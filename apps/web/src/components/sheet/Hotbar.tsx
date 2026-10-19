import { srd } from '@daggerheart/srd-data';
import { useEffect, useRef, useState, type DragEvent } from 'react';

import { t } from '../../i18n/index.js';
import {
  emptyHotbar,
  HOTBAR_SIZE,
  HotbarSlotSchema,
  rollRequestFor,
  setSlot,
  type Hotbar as HotbarModel,
  type HotbarSlot,
} from '../../state/hotbar.js';
import { label as prettify } from '../../state/selectors.js';
import type { SheetState } from '../../state/sheet.js';
import { loadHotbar, saveHotbar } from '../../state/storage.js';

const DRAG_TYPE = 'application/x-daggerheart-hotbar';

/** Makes a piece of the sheet draggable onto the hotbar as `slot`. */
export const hotbarDrag = (slot: HotbarSlot) => ({
  draggable: true,
  onDragStart: (event: DragEvent) => {
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(slot));
    event.dataTransfer.effectAllowed = 'copy';
  },
});

/** The slot a drop carries, validated: the drag payload is as untrusted as storage. */
function droppedSlot(event: DragEvent): HotbarSlot | null {
  try {
    const parsed = HotbarSlotSchema.safeParse(JSON.parse(event.dataTransfer.getData(DRAG_TYPE)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** True while a field has focus, so typing never fires a shortcut. */
export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/** The key that uses slot `index`: 1–9, then 0 for the tenth. */
const keyFor = (index: number) => String((index + 1) % HOTBAR_SIZE);

/**
 * This account's bar in this campaign, saved on every change. Null ids (no
 * campaign joined) give an empty bar that is never written.
 */
export function useHotbar(campaignId: string | null, accountId: string | null) {
  const [bar, setBar] = useState<HotbarModel>(() =>
    campaignId === null || accountId === null
      ? emptyHotbar()
      : loadHotbar(window.localStorage, campaignId, accountId),
  );
  const assign = (index: number, slot: HotbarSlot | null) => {
    const next = setSlot(bar, index, slot);
    setBar(next);
    if (campaignId !== null && accountId !== null) {
      saveHotbar(window.localStorage, campaignId, accountId, next);
    }
  };
  return { bar, assign };
}

/**
 * Number keys 1–0 use the matching slot. Ignored while typing and while a dialog
 * is open, so a Difficulty of 12 is never a roll from slots 1 and 2.
 */
export function useHotbarKeys(onUse: (index: number) => void) {
  // The latest handler, so the listener is bound once rather than every render.
  const handler = useRef(onUse);
  handler.current = onUse;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (isTypingTarget(event.target)) return;
      if (event.target instanceof Element && event.target.closest('[role="dialog"]') !== null) return;
      if (!/^[0-9]$/.test(event.key)) return;
      const digit = Number(event.key);
      handler.current(digit === 0 ? HOTBAR_SIZE - 1 : digit - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** What a filled slot is called on this sheet. */
function slotName(slot: HotbarSlot, sheet: SheetState): string {
  switch (slot.kind) {
    case 'trait':
      return prettify(slot.trait);
    case 'weapon': {
      const id =
        slot.slot === 'primary'
          ? sheet.character.equipment.primaryWeaponId
          : sheet.character.equipment.secondaryWeaponId;
      return (
        srd().weapons.find((w) => w.id === id)?.name ??
        (slot.slot === 'primary' ? t('hotbar.primaryWeapon') : t('hotbar.secondaryWeapon'))
      );
    }
    case 'card':
      return srd().domainCards.find((c) => c.id === slot.cardId)?.name ?? slot.cardId;
    case 'experience':
      return slot.name;
  }
}

interface HotbarProps {
  bar: HotbarModel;
  sheet: SheetState;
  onAssign: (index: number, slot: HotbarSlot | null) => void;
  onUse: (index: number) => void;
}

/**
 * Ten slots along the bottom: drop a trait, weapon, card, or Experience from the
 * sheet onto one; click it or press its number to open the roll; right-click to
 * clear it. A slot whose card went to the vault stays, greyed, until cleared.
 */
export function Hotbar({ bar, sheet, onAssign, onUse }: HotbarProps) {
  return (
    <nav className="hotbar" aria-label={t('hotbar.label')}>
      {bar.map((slot, index) => {
        const n = index + 1;
        const key = keyFor(index);
        const drop = {
          onDragOver: (event: DragEvent) => {
            if (event.dataTransfer.types.includes(DRAG_TYPE)) event.preventDefault();
          },
          onDrop: (event: DragEvent) => {
            event.preventDefault();
            const dropped = droppedSlot(event);
            if (dropped !== null) onAssign(index, dropped);
          },
        };

        if (slot === null) {
          return (
            <div
              key={index}
              className="hotbar-slot"
              data-empty="true"
              aria-label={t('hotbar.emptySlot', { n })}
              title={t('hotbar.dropHint')}
              {...drop}
            >
              <span className="hotbar-key">{key}</span>
            </div>
          );
        }

        const name = slotName(slot, sheet);
        const available = rollRequestFor(slot, sheet) !== null;
        const description = available
          ? t('hotbar.slot', { n, name, key })
          : t('hotbar.unavailableSlot', { n, name });
        return (
          <button
            key={index}
            type="button"
            className="hotbar-slot"
            data-available={available}
            aria-label={description}
            title={description}
            onClick={() => onUse(index)}
            onContextMenu={(event) => {
              event.preventDefault();
              onAssign(index, null);
            }}
            {...drop}
          >
            <span className="hotbar-key">{key}</span>
            <span className="hotbar-name">{name}</span>
          </button>
        );
      })}
    </nav>
  );
}
