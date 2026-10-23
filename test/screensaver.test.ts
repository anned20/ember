import {afterEach, describe, expect, it, vi} from 'vitest';
import {createCustomScreensaver} from '@background/screensaver.js';
import type {CustomScreensaver} from '@background/screensaver.js';
import {AERIAL_BACKGROUNDS} from '@background/aerials.js';
import {setLanguage} from '@lib/i18n.js';
import type {Config} from '@lib/types.js';

const FIXTURE = `
  <div id="custom-screensaver" class="custom-screensaver" hidden aria-hidden="true">
    <div class="custom-screensaver-bg custom-screensaver-bg-a is-front" aria-hidden="true"></div>
    <div class="custom-screensaver-bg custom-screensaver-bg-b is-back" aria-hidden="true"></div>
    <div class="custom-screensaver-scrim" aria-hidden="true"></div>
    <div class="custom-screensaver-clock clock-stack">
      <div class="custom-screensaver-time clock"></div>
      <div class="custom-screensaver-date clock-date"></div>
      <div id="screensaver-weather" class="clock-weather"></div>
    </div>
  </div>`;

let saver: CustomScreensaver | null = null;

afterEach(() => {
  if (saver) saver.stop();
  saver = null;
  document.body.innerHTML = '';
  document.body.className = '';
  setLanguage('en');
});

function config(background: Record<string, unknown>, launcher: Record<string, unknown> = {}): Config {
  return {
    profile: 'default',
    launcher: Object.assign({
      showClock: true,
      showDate: true,
      clockFormat: '24',
      customScreensaverInfo: true
    }, launcher),
    background: background
  } as unknown as Config;
}

function aerialConfig(overrides: Record<string, unknown> = {}): Config {
  return config(Object.assign({
    source: 'aerial',
    mode: 'static',
    aerial: AERIAL_BACKGROUNDS[0].id,
    shuffle: false
  }, overrides));
}

function root(): HTMLElement {
  return document.getElementById('custom-screensaver')!;
}

function mount(cfg: Config, wallpaperAerial: boolean): CustomScreensaver {
  document.body.innerHTML = FIXTURE;
  saver = createCustomScreensaver({
    rootEl: root(),
    getConfig: function () { return cfg; },
    isWallpaperAerial: function () { return wallpaperAerial; }
  });
  saver.start();
  saver.preview();
  return saver;
}

describe('screensaver: the aerial reuse decision', () => {
  it('reuses the warm wallpaper aerial instead of mounting a video', async () => {
    mount(aerialConfig({}), true);

    await vi.waitFor(function () {
      expect(root().classList.contains('reuses-wallpaper')).toBe(true);
    });
    expect(root().querySelector('video')).toBeNull();
    expect(document.body.classList.contains('reuses-wallpaper')).toBe(true);
  });

  it('keeps its own decoder when the wallpaper is not presenting an aerial', async () => {
    mount(aerialConfig({}), false);

    await vi.waitFor(function () {
      expect(root().querySelector('video')).not.toBeNull();
    });
    expect(root().classList.contains('reuses-wallpaper')).toBe(false);
    expect(document.body.classList.contains('reuses-wallpaper')).toBe(false);
  });

  it('keeps the photo slideshow for a non-aerial source', async () => {
    mount(config({source: 'preset', preset: 'cool-gradient'}), true);

    await vi.waitFor(function () {
      expect(root().querySelector<HTMLElement>('.custom-screensaver-bg-a')!.style.backgroundImage)
        .toContain('linear-gradient');
    });
    expect(root().querySelector('video')).toBeNull();
    expect(root().classList.contains('reuses-wallpaper')).toBe(false);
  });

  it('writes the date in the chosen language', () => {
    setLanguage('nl');
    mount(config({source: 'preset', preset: 'cool-gradient'}), false);

    const date = root().querySelector('.custom-screensaver-date')!.textContent || '';
    expect(date).toMatch(/dag/);
    expect(date).toMatch(/januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december/);
  });

  it('hides the whole block when the saver info switch is off', () => {
    mount(config({source: 'preset', preset: 'cool-gradient'}, {customScreensaverInfo: false}), false);

    expect((root().querySelector('.custom-screensaver-clock') as HTMLElement).hidden).toBe(true);
  });

  it('mirrors the home clock and date switches', () => {
    mount(config({source: 'preset', preset: 'cool-gradient'}, {showClock: false, showDate: true}), false);

    expect(root().querySelector('.custom-screensaver-time')!.textContent).toBe('');
    expect(root().querySelector('.custom-screensaver-date')!.textContent).not.toBe('');
  });

  it('uses the home clock format in the saver', () => {
    mount(config({source: 'preset', preset: 'cool-gradient'}, {clockFormat: '12'}), false);

    expect(root().querySelector('.custom-screensaver-time')!.textContent).toMatch(/AM|PM/);
  });
});
