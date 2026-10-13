import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {resetSdkVersionCache} from '@luna/platform.js';
import {setLunaAdapter} from '@luna/luna-transport.js';
import type {WebOSServiceRequestOptions} from '@lib/types.js';

const FIXTURE = `
<div id="app">
  <div id="background-layer"></div><div id="scrim"></div>
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

beforeEach(() => {
  resetSdkVersionCache();
});

afterEach(() => {
  setLunaAdapter(null);
  delete (window as {webOS?: unknown}).webOS;
  document.body.innerHTML = '';
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
