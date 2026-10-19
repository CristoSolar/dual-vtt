import type { AudioState } from '@daggerheart/protocol';
import { useEffect, useRef, useState } from 'react';

import { t } from '../../i18n/index.js';
import { offsetSeconds } from '../../state/audioSync.js';
import { loadAudioVolume, saveAudioVolume } from '../../state/storage.js';
import { SERVER_URL } from '../../state/useCampaign.js';

const sourceOf = (url: string) => (url.startsWith('http') ? url : `${SERVER_URL}${url}`);

/**
 * The tab's one `<audio>`, following the GM's playlist. Every change to what is
 * playing, and every load of a track's metadata, seeks to where the table is now,
 * so someone joining mid-song hears the same moment as everyone else.
 *
 * A browser refuses to start sound before the page has had a click. That refusal
 * is caught and turned into a button that retries, not left as a console error.
 */
export function AudioPlayer({ audio }: { audio: AudioState }) {
  const element = useRef<HTMLAudioElement>(null);
  const [blocked, setBlocked] = useState(false);
  const [localVolume, setLocalVolume] = useState(() => loadAudioVolume(window.localStorage));

  const { playing } = audio;
  const track =
    playing === null ? undefined : audio.tracks.find((entry) => entry.id === playing.trackId);
  const src = track === undefined ? null : sourceOf(track.url);

  /** Seeks to the table's position and plays, or stops if the track is over. */
  const sync = (): void => {
    const el = element.current;
    if (el === null || playing === null) return;
    const offset = offsetSeconds(playing, Date.now(), el.duration);
    if (offset === null) {
      el.pause();
      return;
    }
    el.currentTime = offset;
    el.play().then(
      () => setBlocked(false),
      (error: unknown) => {
        // A newer load interrupting this one rejects too; only a refusal to
        // autoplay needs the listener to do something.
        if (error instanceof DOMException && error.name === 'NotAllowedError') setBlocked(true);
      },
    );
  };

  // The volume is not a dependency: changing it should not seek.
  useEffect(() => {
    const el = element.current;
    if (el === null) return undefined;
    if (playing === null || src === null) {
      el.pause();
      el.removeAttribute('src');
      el.load();
      setBlocked(false);
      return undefined;
    }
    el.loop = playing.loop;
    if (el.getAttribute('src') !== src) el.setAttribute('src', src);
    if (el.readyState >= HTMLMediaElement.HAVE_METADATA) {
      sync();
      return undefined;
    }
    el.addEventListener('loadedmetadata', sync);
    return () => el.removeEventListener('loadedmetadata', sync);
  }, [src, playing?.trackId, playing?.startedAt, playing?.loop]);

  const tableVolume = playing?.volume ?? 1;
  useEffect(() => {
    if (element.current !== null) element.current.volume = tableVolume * localVolume;
  }, [tableVolume, localVolume]);

  const changeLocalVolume = (volume: number) => {
    setLocalVolume(volume);
    saveAudioVolume(window.localStorage, volume);
  };

  return (
    <>
      <audio ref={element} preload="auto" />
      {track === undefined ? null : (
        <div className="audio-player" role="region" aria-label={t('gm.playlist.title')}>
          <span className="audio-player-name">{t('audio.nowPlaying', { name: track.name })}</span>
          {blocked ? (
            <button type="button" className="btn-primary" onClick={sync}>
              {t('audio.enable')}
            </button>
          ) : null}
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={localVolume}
            aria-label={t('audio.volume')}
            onChange={(event) => changeLocalVolume(Number(event.target.value))}
          />
        </div>
      )}
    </>
  );
}
