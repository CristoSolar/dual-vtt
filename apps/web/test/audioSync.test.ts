import { describe, expect, it } from 'vitest';

import { offsetSeconds } from '../src/state/audioSync.js';
import { loadAudioVolume, saveAudioVolume } from '../src/state/storage.js';

import { fakeStorage } from './helpers.js';

const START = 1_700_000_000_000;
const playing = (loop: boolean) => ({ trackId: 't-1', startedAt: START, loop, volume: 1 });

describe('offsetSeconds', () => {
  it('wraps a looping track around its duration', () => {
    expect(offsetSeconds(playing(true), START + 130_000, 60)).toBe(10);
  });

  it('places a track still playing at the time since it started', () => {
    expect(offsetSeconds(playing(false), START + 42_500, 60)).toBe(42.5);
  });

  it('says a finished track is over, rather than replaying its end', () => {
    expect(offsetSeconds(playing(false), START + 60_000, 60)).toBeNull();
    expect(offsetSeconds(playing(false), START + 90_000, 60)).toBeNull();
  });

  it('starts from zero when this clock is behind the server’s', () => {
    expect(offsetSeconds(playing(false), START - 3_000, 60)).toBe(0);
    expect(offsetSeconds(playing(true), START - 3_000, 60)).toBe(0);
  });
});

describe('local volume', () => {
  it('is full until set, and remembers what was set', () => {
    const storage = fakeStorage();
    expect(loadAudioVolume(storage)).toBe(1);
    saveAudioVolume(storage, 0.25);
    expect(loadAudioVolume(storage)).toBe(0.25);
  });

  it('falls back to full on anything unreadable or out of range', () => {
    const storage = fakeStorage();
    storage.setItem('daggerheart-vtt:audio-volume', '7');
    expect(loadAudioVolume(storage)).toBe(1);
    storage.setItem('daggerheart-vtt:audio-volume', '{not json');
    expect(loadAudioVolume(storage)).toBe(1);
  });
});
