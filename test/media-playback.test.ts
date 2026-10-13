import {afterEach, describe, expect, it, vi} from 'vitest';
import {createMediaPlayback} from '@background/media-playback.js';
import type {MediaPlayback} from '@background/media-playback.js';
import {AERIAL_BACKGROUNDS} from '@background/aerials.js';
import type {Config} from '@lib/types.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function aerialConfig(overrides: Record<string, unknown> = {}): Config {
  return {
    profile: 'default',
    launcher: {},
    background: Object.assign({
      source: 'aerial',
      mode: 'static',
      aerial: AERIAL_BACKGROUNDS[0].id,
      shuffle: false
    }, overrides)
  } as unknown as Config;
}

interface Harness {
  engine: MediaPlayback;
  play: ReturnType<typeof vi.fn>;
  fallbacks: string[];
  clipStarts: Array<{gradient: string; el: HTMLVideoElement}>;
  playings: HTMLVideoElement[];
  mount: HTMLElement;
  el: HTMLVideoElement;
}

function harness(config: Config): Harness {
  const mount = document.createElement('div');
  const el = document.createElement('video');
  const play = vi.fn(function () { return Promise.resolve(); });
  (el as unknown as {play: unknown}).play = play;
  (el as unknown as {pause: unknown}).pause = vi.fn();
  (el as unknown as {load: unknown}).load = vi.fn();
  const fallbacks: string[] = [];
  const clipStarts: Array<{gradient: string; el: HTMLVideoElement}> = [];
  const playings: HTMLVideoElement[] = [];
  const engine = createMediaPlayback({
    mount: mount,
    getConfig: function () { return config; },
    shouldAnimate: function () { return true; },
    videoClassName: 'test-video',
    createVideo: function () { return el; },
    onClipStart: function (gradient, video) { clipStarts.push({gradient: gradient, el: video}); },
    onPlaying: function (video) { playings.push(video); },
    onFallback: function (gradient) { fallbacks.push(gradient); }
  });
  return {
    engine: engine,
    play: play,
    fallbacks: fallbacks,
    clipStarts: clipStarts,
    playings: playings,
    mount: mount,
    el: el
  };
}

describe('media playback: the aerial video state machine', () => {
  it('retries a Single clip once, then falls back to the gradient', async () => {
    const h = harness(aerialConfig({}));
    h.play.mockRejectedValueOnce(new Error('nope'));
    h.play.mockRejectedValueOnce(new Error('nope'));

    const ok = await h.engine.play();

    expect(ok).toBe(false);
    expect(h.play).toHaveBeenCalledTimes(2);
    expect(h.fallbacks.length).toBe(1);
    expect(h.engine.hasFallenBack()).toBe(true);
  });

  it('plays a Single clip that starts on the first attempt', async () => {
    const h = harness(aerialConfig({}));
    const ok = await h.engine.play();
    expect(ok).toBe(true);
    expect(h.play).toHaveBeenCalledTimes(1);
    expect(h.fallbacks).toEqual([]);
    expect(h.engine.hasFallenBack()).toBe(false);
  });

  it('keeps the clip hidden until its first frame, then reveals it', async () => {
    const h = harness(aerialConfig({}));
    await h.engine.play();

    expect(h.el.classList.contains('is-revealed')).toBe(false);
    expect(h.playings).toEqual([]);

    h.el.dispatchEvent(new Event('playing'));

    expect(h.el.classList.contains('is-revealed')).toBe(true);
    expect(h.playings).toEqual([h.el]);
  });

  it('asks the host for its poster when a clip starts', async () => {
    const h = harness(aerialConfig({}));
    await h.engine.play();

    expect(h.clipStarts.length).toBe(1);
    expect(h.clipStarts[0].el).toBe(h.el);
    expect(typeof h.clipStarts[0].gradient).toBe('string');
    expect(h.clipStarts[0].gradient.length).toBeGreaterThan(0);
  });

  it('reveals a clip that never reports playing once the timeout expires', async () => {
    vi.useFakeTimers();
    try {
      const h = harness(aerialConfig({}));
      await h.engine.play();
      expect(h.el.classList.contains('is-revealed')).toBe(false);

      vi.advanceTimersByTime(5000);

      expect(h.el.classList.contains('is-revealed')).toBe(true);
      expect(h.playings).toEqual([h.el]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips a broken clip in Slideshow and plays the next without falling back', async () => {
    const h = harness(aerialConfig({mode: 'slideshow'}));
    h.play.mockRejectedValueOnce(new Error('nope'));

    await h.engine.play();

    expect(h.play).toHaveBeenCalledTimes(2);
    expect(h.fallbacks).toEqual([]);
  });

  it('advances the Slideshow when a clip ends', async () => {
    const h = harness(aerialConfig({mode: 'slideshow'}));
    await h.engine.play();
    expect(h.play).toHaveBeenCalledTimes(1);

    h.el.dispatchEvent(new Event('ended'));

    expect(h.play).toHaveBeenCalledTimes(2);
  });

  it('counts the element error event as a failed attempt (Single retries)', async () => {
    const h = harness(aerialConfig({}));
    await h.engine.play();
    expect(h.play).toHaveBeenCalledTimes(1);

    h.el.dispatchEvent(new Event('error'));

    expect(h.play).toHaveBeenCalledTimes(2);
    expect(h.fallbacks).toEqual([]);
  });

  it('falls back to the gradient when the source resolves no clip', async () => {
    const h = harness({
      profile: 'default',
      launcher: {},
      background: {source: 'usb', mode: 'static'}
    } as unknown as Config);

    const ok = await h.engine.play();

    expect(ok).toBe(false);
    expect(h.play).not.toHaveBeenCalled();
    expect(h.fallbacks.length).toBe(1);
  });

  it('clears the fallback flag on stop so a later paint can reuse', async () => {
    const h = harness(aerialConfig({}));
    h.play.mockRejectedValue(new Error('nope'));
    await h.engine.play();
    expect(h.engine.hasFallenBack()).toBe(true);

    h.engine.stop();

    expect(h.engine.hasFallenBack()).toBe(false);
  });

  it('holds the gradient while the TV is offline', async () => {
    const h = harness(aerialConfig({}));
    const original = window.navigator.onLine;
    Object.defineProperty(window.navigator, 'onLine', {value: false, configurable: true});
    try {
      const ok = await h.engine.play();
      expect(ok).toBe(false);
      expect(h.play).not.toHaveBeenCalled();
      expect(h.fallbacks.length).toBe(1);
    } finally {
      Object.defineProperty(window.navigator, 'onLine', {value: original, configurable: true});
    }
  });

  it('steps the Single catalog and reports the landed metadata', async () => {
    const h = harness(aerialConfig({}));
    await h.engine.play();

    const next = h.engine.step(1);
    expect(next).toEqual({
      id: AERIAL_BACKGROUNDS[1].id,
      title: AERIAL_BACKGROUNDS[1].title,
      mode: 'single'
    });
  });

  it('reports null when the source is not aerial', async () => {
    const h = harness({
      profile: 'default',
      launcher: {},
      background: {source: 'preset', mode: 'static', preset: 'warm-gradient'}
    } as unknown as Config);
    expect(h.engine.step(1)).toBeNull();
  });
});
