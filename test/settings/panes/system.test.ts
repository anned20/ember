import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {createSystemPane} from '@settings/panes/system.js';
import {createBinder} from '@settings/settings-binding.js';
import type {SettingsContext} from '@settings/pane.js';
import {BRAND} from '@lib/brand.js';
import {setLanguage} from '@lib/i18n.js';
import type {Config} from '@lib/types.js';

function makeConfig(): Config {
  return {
    launcher: {
      language: 'auto',
      volumeAtHome: null,
      volumeOnAppLaunch: 20,
      perfMode: false,
      launchOnHome: false,
      returnOnAppExit: false,
      bootOnStart: false
    }
  } as unknown as Config;
}

function stepper(pane: HTMLElement, focusIndex: string) {
  return pane.querySelector('[data-focus-index="' + focusIndex + '"]') as unknown as {
    value: string;
    setValue(value: string): void;
  };
}

function buildPane(config?: Config): {pane: HTMLElement; config: Config; ctx: SettingsContext} {
  const cfg = config || makeConfig();
  const pane = document.createElement('div');
  const ctx: SettingsContext = {
    config: cfg,
    rawConfig: cfg,
    binder: createBinder(cfg),
    panes: {system: pane},
    options: {},
    apps: {pinnedOrder: [], customApps: [], appsByIdMap: {}, installedCatalog: null},
    focusInPanel: function () { return true; },
    isVisible: function () { return true; },
    focusControl: function () {},
    focusNow: function () { return true; },
    focusGallery: function () {},
    refocusListButton: function () {},
    withDeadline: function <T>(promise: Promise<T>) { return Promise.resolve(promise); },
    redraw: function () {}
  };
  createSystemPane().build(ctx);
  return {pane: pane, config: cfg, ctx: ctx};
}

describe('system pane', () => {
  beforeEach(() => setLanguage('en'));
  afterEach(() => setLanguage('en'));

  it('builds the volume, performance, Home and boot controls from the config', () => {
    const {pane} = buildPane();

    expect(stepper(pane, '993').value).toBe('');
    expect(stepper(pane, '994').value).toBe('20');

    const toggles = pane.querySelectorAll('input[type=checkbox]');
    expect(toggles.length).toBe(3);
    expect((toggles[0] as HTMLElement).dataset.focusIndex).toBe('1009');
    expect((toggles[1] as HTMLElement).dataset.focusIndex).toBe('1010');
    expect((toggles[2] as HTMLElement).dataset.focusIndex).toBe('1011');
    expect((toggles[0] as HTMLInputElement).checked).toBe(false);
    expect(pane.textContent).toContain('Volume in ' + BRAND.name);
    expect(pane.textContent).toContain('Boot on TV start');
  });

  it('collects the volumes and toggles, and syncs the legacy Home key', () => {
    const {pane, config, ctx} = buildPane();

    stepper(pane, '993').setValue('35');
    stepper(pane, '994').setValue('');

    const toggles = pane.querySelectorAll('input[type=checkbox]') as NodeListOf<HTMLInputElement>;
    toggles[0].checked = true;
    toggles[1].checked = true;
    toggles[2].checked = true;

    ctx.binder.collect(config);

    expect(config.launcher.volumeAtHome).toBe(35);
    expect(config.launcher.volumeOnAppLaunch).toBe(null);
    expect(config.launcher.perfMode).toBe(true);
    expect(config.launcher.launchOnHome).toBe(true);
    expect(config.launcher.returnOnAppExit).toBe(true);
    expect(config.launcher.bootOnStart).toBe(true);
  });

  it('shows the Home toggle on when only the legacy key is set', () => {
    const config = makeConfig();
    config.launcher.returnOnAppExit = true;
    const {pane} = buildPane(config);

    const home = pane.querySelector('[data-focus-index="1010"]') as HTMLInputElement;
    expect(home.checked).toBe(true);
  });

  it('reads and writes the Language setting', () => {
    const config = makeConfig();
    config.launcher.language = 'nl';
    const {pane, config: built, ctx} = buildPane(config);

    const language = stepper(pane, '995');
    expect(language.value).toBe('nl');

    language.setValue('en');
    ctx.binder.collect(built);
    expect(built.launcher.language).toBe('en');
  });

  it('reads in Dutch when the language is Dutch', () => {
    setLanguage('nl');
    const {pane} = buildPane();

    const language = stepper(pane, '995');
    expect(language.value).toBe('auto');
    expect(pane.textContent).toContain('Taal');
    expect(pane.textContent).toContain('Automatisch');
    expect(pane.textContent).toContain('Volume in ' + BRAND.name);
    expect(pane.textContent).toContain('Prestatiemodus (tvs met weinig geheugen)');
    expect(pane.textContent).toContain('Opstarten met de tv');
  });

  it('offers Automatic, English and Nederlands', () => {
    const {pane} = buildPane();
    const language = stepper(pane, '995');

    expect(language.value).toBe('auto');
    language.setValue('en');
    expect(language.value).toBe('en');
    language.setValue('nl');
    expect(language.value).toBe('nl');
  });
});
