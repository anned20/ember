import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {resetSdkVersionCache} from '@luna/platform.js';
import {setLunaAdapter} from '@luna/luna-transport.js';
import {BRAND} from '@lib/brand.js';
import {APP_VERSION} from '@lib/version.js';
import type {WebOSServiceRequestOptions} from '@lib/types.js';

// The wallpaper and the music player do real media work (image probes, decoders)
// that never settles in jsdom. Startup's job here is to reach the idle pass, so
// stand in for the two modules that would stall it.
vi.mock('@background/background.js', () => ({
  createBackgroundController: vi.fn(() => ({
    refresh: vi.fn(async () => {}),
    isPresentingAerial: vi.fn(() => false),
    stepAerial: vi.fn(),
    destroy: vi.fn()
  }))
}));

vi.mock('@music/music.js', () => ({
  createMusicPlayer: vi.fn(() => ({
    applyConfig: vi.fn(),
    loadTracks: vi.fn(async () => {}),
    stop: vi.fn(),
    unlockAutoplay: vi.fn(),
    fadeInAndResume: vi.fn(),
    fadeOutAndPause: vi.fn(),
    nudgeVolume: vi.fn(),
    togglePause: vi.fn(),
    nextTrack: vi.fn()
  }))
}));

const FIXTURE = `
<div id="app">
  <div id="background-layer"></div><div id="scrim"></div>
  <nav id="channel-strip" hidden></nav>
  <nav id="input-row"></nav>
  <section id="weather-panel" hidden></section>
  <div class="launcher"></div>
  <div id="app-grid-shell"><div id="app-grid"></div></div>
  <span id="track-title"></span><button id="mute-btn"></button>
  <input id="volume-slider" type="range"><audio id="ambient-audio"></audio>
  <div id="custom-screensaver"></div><div id="settings-panel"></div>
</div>`;

/** Report a webOS sdkVersion as if `window.webOS.deviceInfo` answered. */
function setDeviceInfo(sdkVersion: string): void {
  (window as {webOS?: unknown}).webOS = {
    deviceInfo: function (cb: (info: {sdkVersion: string}) => void) {
      cb({sdkVersion: sdkVersion});
    }
  };
}

/**
 * A Luna bus that answers with an empty-but-valid reply, so startup walks its
 * whole chain (including the idle pass) instead of stalling on a silent bus.
 */
function answerEverything(sent: WebOSServiceRequestOptions[]): void {
  setLunaAdapter({
    request: function (_uri, options) {
      sent.push(options);
      const res = {returnValue: true, apps: [], launchPoints: [], devices: []};
      if (options.onSuccess) Promise.resolve().then(function () { options.onSuccess!(res); });
      return {cancel: vi.fn()};
    }
  });
}

/** Root commands that ran Ember's voice teardown. */
function cleanupCommands(sent: WebOSServiceRequestOptions[]): unknown[] {
  return sent.filter(function (options) {
    return String(options.parameters && options.parameters.command).indexOf('cleanup-voice.sh') >= 0;
  });
}

beforeEach(() => {
  resetSdkVersionCache();
});

afterEach(() => {
  setLunaAdapter(null);
  delete (window as {webOS?: unknown}).webOS;
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('main module', () => {
  it('exports a factory and does nothing on import', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const bodyBefore = document.body.innerHTML;

    const mod = await import('../src/ts/main.js');

    expect(typeof mod.createApp).toBe('function');
    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(document.body.innerHTML).toBe(bodyBefore);
    expect(document.body.querySelectorAll('*').length).toBe(0);

    setIntervalSpy.mockRestore();
  });
});

describe('platform gate', () => {
  it('renders the unsupported surface and starts nothing on an old TV', async () => {
    document.body.innerHTML = FIXTURE;
    setDeviceInfo('6');
    const sent: WebOSServiceRequestOptions[] = [];
    setLunaAdapter({
      request: function (_uri, options) {
        sent.push(options);
        return {cancel: vi.fn()};
      }
    });

    const {createApp} = await import('../src/ts/main.js');
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const app = createApp();
    app.start();

    await vi.waitFor(function () {
      expect(document.getElementById('unsupported-tv')).not.toBeNull();
    });
    const surface = document.getElementById('unsupported-tv')!;
    expect(surface.textContent).toContain('webOS 22');
    expect(surface.textContent).toContain('webOS sdk 6');

    // No timers, and no Luna/root work (so no init.d hooks or watcher).
    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);

    setIntervalSpy.mockRestore();
    app.stop();
  });

  it('runs the normal lifecycle on a supported TV', async () => {
    document.body.innerHTML = FIXTURE;
    setDeviceInfo('10');
    const {createApp} = await import('../src/ts/main.js');
    const app = createApp();

    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    app.start();

    await vi.waitFor(function () {
      expect(setIntervalSpy).toHaveBeenCalled();
    });
    expect(document.getElementById('unsupported-tv')).toBeNull();
    const clockTimer = setIntervalSpy.mock.results[0].value;

    app.stop();
    expect(clearIntervalSpy).toHaveBeenCalledWith(clockTimer);

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });
});

// The first start after an update tears down the voice assistant an earlier
// Ember installed. Same-version starts must not repeat the root work.
describe('after-update work', () => {
  it('runs the voice teardown once after a version change', async () => {
    document.body.innerHTML = FIXTURE;
    setDeviceInfo('10');
    localStorage.setItem(BRAND.storage.lastRunVersion, '0.0.1');
    const sent: WebOSServiceRequestOptions[] = [];
    answerEverything(sent);

    const {createApp} = await import('../src/ts/main.js');
    const app = createApp();
    app.start();

    await vi.waitFor(function () {
      expect(cleanupCommands(sent)).toHaveLength(1);
    }, {timeout: 5000});
    // The idle pass fires it once, not once per call site.
    await new Promise(function (resolve) { setTimeout(resolve, 400); });
    expect(cleanupCommands(sent)).toHaveLength(1);
    app.stop();
  });

  it('does not run the voice teardown again on the same version', async () => {
    document.body.innerHTML = FIXTURE;
    setDeviceInfo('10');
    localStorage.setItem(BRAND.storage.lastRunVersion, APP_VERSION);
    const sent: WebOSServiceRequestOptions[] = [];
    answerEverything(sent);

    const {createApp} = await import('../src/ts/main.js');
    const app = createApp();
    app.start();

    // Wait past the idle pass that would have run it.
    await new Promise(function (resolve) { setTimeout(resolve, 1500); });
    expect(cleanupCommands(sent)).toHaveLength(0);
    // Proof the idle pass did run: the terminal auto-pin writes this marker.
    const stored = JSON.parse(localStorage.getItem(BRAND.storage.config) || '{}');
    expect(stored.launcher && stored.launcher.terminalChecked).toBe(true);
    app.stop();
  });
});
