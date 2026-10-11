import {describe, expect, it, vi} from 'vitest';

const FIXTURE = `
<div id="app">
  <div id="background-layer"></div><div id="scrim"></div>
  <div class="launcher"></div>
  <div id="app-grid-shell"><div id="app-grid"></div></div>
  <span id="track-title"></span><button id="mute-btn"></button>
  <input id="volume-slider" type="range"><audio id="ambient-audio"></audio>
  <div id="custom-screensaver"></div><div id="settings-panel"></div>
</div>`;

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

describe('app lifecycle', () => {
  it('clears the clock interval on stop', async () => {
    document.body.innerHTML = FIXTURE;
    const {createApp} = await import('../src/ts/main.js');
    const app = createApp();

    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    app.start();

    await vi.waitFor(function () {
      expect(setIntervalSpy).toHaveBeenCalled();
    });
    const clockTimer = setIntervalSpy.mock.results[0].value;

    app.stop();
    expect(clearIntervalSpy).toHaveBeenCalledWith(clockTimer);

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
    document.body.innerHTML = '';
  });
});
