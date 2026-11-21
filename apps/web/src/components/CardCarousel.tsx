import {
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';

import { t } from '../i18n/index.js';
import { ringOffset, wrapIndex } from '../state/carousel.js';

export interface CarouselItem {
  id: string;
  name: string;
  /** Full-bleed art. Omit for an item with no picture. */
  image?: string | undefined;
  /** One or two lines of SRD text, already shortened (see `flavorText`). */
  flavor?: string | undefined;
  /** CSS custom properties for the card frame, e.g. `--card-accent`. */
  accent?: CSSProperties | undefined;
  /** Key stats, shown as chips on the card face. */
  chips?: ReactNode;
  /** Long-form text shown under the carousel by "Show details". */
  detail?: ReactNode;
}

interface CardCarouselProps {
  legend: string;
  items: readonly CarouselItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  emptyMessage?: string;
}

/** Neighbours drawn each side of the centre card; anything further is hidden. */
const RADIUS = 2;
/** Art is fetched once a card comes this close to the centre, and kept after. */
const PRELOAD = RADIUS + 1;
/** Horizontal travel, in px, that counts as a swipe rather than a tap. */
const SWIPE = 40;

/**
 * A coverflow of tall cards. Centring a card only browses; the "Choose" button on
 * the centre card (or Enter) is what calls `onSelect`. The ring is a single-select
 * listbox whose selection does not follow focus: arrow keys move the centre
 * (`aria-activedescendant`), `aria-selected` marks the chosen card.
 */
export function CardCarousel({
  legend,
  items,
  selectedId,
  onSelect,
  emptyMessage = t('common.noOptionsAvailable'),
}: CardCarouselProps) {
  const baseId = useId();
  const legendId = `${baseId}-legend`;
  const detailId = `${baseId}-detail`;
  const count = items.length;

  const [current, setCurrent] = useState(() =>
    Math.max(
      0,
      items.findIndex((item) => item.id === selectedId),
    ),
  );
  const [detailOpen, setDetailOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const seen = useRef(new Set<string>());
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);

  if (count === 0) {
    return (
      <fieldset>
        <legend>{legend}</legend>
        <p className="muted">{emptyMessage}</p>
      </fieldset>
    );
  }

  // The option list can shrink under us (a locale switch, a filtered list).
  const index = wrapIndex(current, count);
  const centre = items[index];
  if (centre === undefined) return null;

  const positionLabel = (i: number) =>
    t('carousel.position', { name: items[i]?.name ?? '', index: i + 1, total: count });

  const goTo = (next: number, announce: boolean) => {
    const target = wrapIndex(next, count);
    setCurrent(target);
    // With focus on the listbox, the active-descendant change is announced by the
    // screen reader itself; the live region covers the buttons and swipes.
    setAnnouncement(announce ? positionLabel(target) : '');
  };

  const choose = () => {
    onSelect(centre.id);
    setAnnouncement(t('carousel.announceChosen', { name: centre.name }));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const moves: Record<string, number> = {
      ArrowLeft: index - 1,
      ArrowRight: index + 1,
      Home: 0,
      End: count - 1,
    };
    const move = moves[event.key];
    if (move !== undefined) {
      event.preventDefault();
      goTo(move, false);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose();
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    swipe.current = { x: event.clientX, y: event.clientY };
    swiped.current = false;
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = swipe.current;
    swipe.current = null;
    if (start === null) return;
    const dx = event.clientX - start.x;
    if (Math.abs(dx) < SWIPE || Math.abs(dx) < Math.abs(event.clientY - start.y)) return;
    swiped.current = true;
    goTo(index + (dx < 0 ? 1 : -1), true);
  };

  return (
    <fieldset className="carousel" aria-roledescription={t('carousel.roleDescription')}>
      <legend id={legendId}>{legend}</legend>

      <div
        className="carousel-stage"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (swipe.current = null)}
      >
        <button
          type="button"
          className="carousel-arrow carousel-arrow-prev"
          aria-label={t('carousel.prev')}
          onClick={() => goTo(index - 1, true)}
        >
          <span aria-hidden="true">‹</span>
        </button>

        <ul
          className="carousel-track"
          role="listbox"
          tabIndex={0}
          aria-labelledby={legendId}
          aria-activedescendant={`${baseId}-opt-${index}`}
          aria-describedby={`${baseId}-hint`}
          onKeyDown={onKeyDown}
        >
          {items.map((item, i) => {
            const offset = ringOffset(i, index, count);
            const distance = Math.abs(offset);
            const chosen = item.id === selectedId;
            if (distance <= PRELOAD) seen.current.add(item.id);
            // Cards fan out quickly at first and then close up, like a held hand.
            const position = Math.sign(offset) * (distance <= 1 ? distance : 1 + (distance - 1) * 0.72);
            const style = {
              ...item.accent,
              '--offset': Math.sign(offset) * Math.min(distance, RADIUS + 1),
              '--abs': Math.min(distance, RADIUS + 1),
              '--pos': position,
              zIndex: 10 - distance,
            } as CSSProperties;
            const classes = ['carousel-card'];
            if (distance === 0) classes.push('is-centre');
            if (distance > RADIUS) classes.push('is-offstage');
            if (chosen) classes.push('is-chosen');
            return (
              <li
                key={item.id}
                id={`${baseId}-opt-${i}`}
                className={classes.join(' ')}
                style={style}
                data-abs={Math.min(distance, RADIUS + 1)}
                role="option"
                aria-selected={chosen}
                aria-label={positionLabel(i)}
                aria-setsize={count}
                aria-posinset={i + 1}
                onClick={() => {
                  if (swiped.current || distance === 0) return;
                  goTo(i, true);
                }}
              >
                {item.image !== undefined && seen.current.has(item.id) ? (
                  <img
                    className="carousel-card-art"
                    src={item.image}
                    alt=""
                    loading={distance <= RADIUS ? 'eager' : 'lazy'}
                    decoding="async"
                    draggable={false}
                  />
                ) : null}
                <span className="carousel-card-shade" aria-hidden="true" />
                {chosen ? (
                  <span className="carousel-card-check" aria-hidden="true">
                    ✓
                  </span>
                ) : null}
                <span className="carousel-card-body">
                  <span className="carousel-card-name">{item.name}</span>
                  {item.flavor ? <span className="carousel-card-flavor">{item.flavor}</span> : null}
                  {item.chips ? <span className="carousel-card-chips">{item.chips}</span> : null}
                </span>
              </li>
            );
          })}
        </ul>

        {/* Outside the listbox: an option may not contain buttons. Laid over the
            foot of the centre card. */}
        <div className="carousel-actions">
          <button
            type="button"
            className={selectedId === centre.id ? 'carousel-choose is-chosen' : 'carousel-choose'}
            aria-pressed={selectedId === centre.id}
            aria-label={t('carousel.chooseNamed', { name: centre.name })}
            onClick={choose}
          >
            {selectedId === centre.id ? `✓ ${t('carousel.chosen')}` : t('carousel.choose')}
          </button>
          {centre.detail !== undefined ? (
            <button
              type="button"
              className="carousel-detail-toggle"
              aria-expanded={detailOpen}
              aria-controls={detailId}
              onClick={() => setDetailOpen((open) => !open)}
            >
              {detailOpen ? t('carousel.hideDetail') : t('carousel.showDetail')}
            </button>
          ) : null}
        </div>

        <button
          type="button"
          className="carousel-arrow carousel-arrow-next"
          aria-label={t('carousel.next')}
          onClick={() => goTo(index + 1, true)}
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>

      {/* A pointer shortcut; the listbox already gives keyboard users every item. */}
      <ol className="carousel-index" aria-hidden="true">
        {items.map((item, i) => (
          <li key={item.id}>
            <button
              type="button"
              tabIndex={-1}
              className={[
                'carousel-index-item',
                i === index ? 'is-current' : '',
                item.id === selectedId ? 'is-chosen' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              title={`${t('carousel.jumpTo')} ${item.name}`}
              onClick={() => goTo(i, true)}
            >
              {item.name}
            </button>
          </li>
        ))}
      </ol>

      <p id={`${baseId}-hint`} className="sr-only">
        {t('carousel.hint')}
      </p>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      {centre.detail !== undefined ? (
        <div
          id={detailId}
          className="carousel-detail"
          role="region"
          aria-label={centre.name}
          hidden={!detailOpen}
          style={centre.accent}
        >
          <h3 className="carousel-detail-title">{centre.name}</h3>
          {centre.detail}
        </div>
      ) : null}
    </fieldset>
  );
}
