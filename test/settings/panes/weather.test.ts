import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@home/weather.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@home/weather.js')>();
  return Object.assign({}, actual, {
    normalizeWeatherConfig: vi.fn((raw: unknown) => raw),
    searchPlaces: vi.fn(async () => [])
  });
});

import {createWeatherPane} from '@settings/panes/weather.js';
import {createBinder} from '@settings/settings-binding.js';
import {searchPlaces} from '@home/weather.js';
import type {SettingsContext} from '@settings/pane.js';
import type {Config, WeatherLocation} from '@lib/types.js';

const PLACE: WeatherLocation = {
  name: 'Tokyo, Japan',
  latitude: 35.68,
  longitude: 139.69,
  countryCode: 'JP'
};

function makeConfig(): Config {
  return {
    weather: {
      enabled: true,
      units: 'c',
      location: {name: 'Berlin', latitude: 52.5, longitude: 13.4, countryCode: 'DE'}
    }
  } as unknown as Config;
}

function buildPane(): {pane: HTMLElement; config: Config; ctx: SettingsContext} {
  const config = makeConfig();
  const pane = document.createElement('div');
  const ctx: SettingsContext = {
    config: config,
    rawConfig: config,
    binder: createBinder(config),
    panes: {weather: pane},
    options: {},
    focusControl: function () {},
    focusNow: function () { return true; },
    focusGallery: function () {},
    refocusListButton: function () {},
    withDeadline: function (promise, ms) {
      return new Promise(function (resolve) {
        let done = false;
        const timer = setTimeout(function () {
          if (!done) { done = true; resolve(null); }
        }, ms);
        Promise.resolve(promise).then(function (value) {
          if (!done) { done = true; clearTimeout(timer); resolve(value); }
        }, function () {
          if (!done) { done = true; clearTimeout(timer); resolve(null); }
        });
      });
    },
    redraw: function () {}
  };
  createWeatherPane().build(ctx);
  return {pane: pane, config: config, ctx: ctx};
}

async function waitFor(selector: string, root: ParentNode, ms = 2000): Promise<Element> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const found = root.querySelector(selector);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for ' + selector);
}

async function waitForText(text: string, root: ParentNode, ms = 2000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if ((root.textContent || '').indexOf(text) >= 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for text: ' + text);
}

describe('weather pane', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.mocked(searchPlaces).mockReset();
    vi.mocked(searchPlaces).mockResolvedValue([]);
  });

  it('builds the show/hide, units and location controls from the config', () => {
    const {pane} = buildPane();

    const toggle = pane.querySelector('input[type=checkbox]') as HTMLInputElement;
    expect(toggle.dataset.focusIndex).toBe('1020');
    expect(toggle.checked).toBe(true);

    expect(pane.querySelector('[data-focus-index="1021"]')).not.toBeNull();
    expect(pane.querySelector('input[data-focus-index="1022"]')).not.toBeNull();
    expect(pane.textContent).toContain('Location: Berlin');
  });

  it('looks up places as the user types and saves a picked place through the binder', async () => {
    vi.mocked(searchPlaces).mockResolvedValue([PLACE]);
    const {pane, config, ctx} = buildPane();

    const input = pane.querySelector('input[data-focus-index="1022"]') as HTMLInputElement;
    input.value = 'tok';
    input.dispatchEvent(new Event('input'));

    const option = await waitFor('.settings-suggestion', pane);
    expect(searchPlaces).toHaveBeenCalledWith('tok', 6);
    expect(option.getAttribute('role')).toBe('option');
    expect((option as HTMLElement).dataset.focusIndex).toBe('1023');
    expect(option.querySelector('strong')!.textContent).toBe('Tok');

    (option as HTMLButtonElement).click();
    expect(pane.textContent).toContain('Location: Tokyo, Japan — press Save to use it');

    ctx.binder.collect(config);
    expect(config.weather.location.name).toBe('Tokyo, Japan');
  });

  it('reports the TV as offline when the lookup fails', async () => {
    vi.mocked(searchPlaces).mockRejectedValue(new Error('no network'));
    const {pane} = buildPane();

    const input = pane.querySelector('input[data-focus-index="1022"]') as HTMLInputElement;
    input.value = 'ber';
    input.dispatchEvent(new Event('input'));

    await waitForText('Could not look up places', pane);
  });
});
