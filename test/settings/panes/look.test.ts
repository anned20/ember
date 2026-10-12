import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@apps/app-catalog.js', () => ({
  setIconSrc: vi.fn()
}));

import {createLookPane} from '@settings/panes/look.js';
import {createBinder} from '@settings/settings-binding.js';
import type {OptionStepperElement} from '@settings/components/index.js';
import type {PaneHandle, SettingsContext, SettingsPanelOptions} from '@settings/pane.js';
import type {Config} from '@lib/types.js';

function makeConfig(overrides: Record<string, unknown> = {}): Config {
  return {
    version: 1,
    profile: 'default',
    profiles: {},
    launcher: {
      showClock: true,
      clockFormat: '24',
      glassTint: 'light',
      glassBorder: 'white',
      focusColour: 'warm'
    },
    background: {}
  } as unknown as Config;
}

function makeContext(config: Config, pane: HTMLDivElement): SettingsContext {
  return {
    config: config,
    rawConfig: config,
    binder: createBinder(config),
    panes: {look: pane},
    options: {} as SettingsPanelOptions,
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
}

/** A stand-in Background pane: appends its own section and records the note calls. */
function makeBackgroundStub(): {build: ReturnType<typeof vi.fn>; setProfile: ReturnType<typeof vi.fn>} {
  const setProfile = vi.fn();
  const build = vi.fn(function (ctx: SettingsContext): void {
    const section = document.createElement('section');
    section.className = 'settings-section';
    const heading = document.createElement('h3');
    heading.textContent = 'Background';
    section.appendChild(heading);
    ctx.panes.look.appendChild(section);
  });
  return {build: build, setProfile: setProfile};
}

function buildLook(
  config: Config = makeConfig(),
  background?: {build: ReturnType<typeof vi.fn>; setProfile: ReturnType<typeof vi.fn>}
): {pane: HTMLDivElement; ctx: SettingsContext; handle: PaneHandle} {
  const pane = document.createElement('div');
  const ctx = makeContext(config, pane);
  const handle = createLookPane(background ? {background: background} : {});
  handle.build(ctx);
  return {pane: pane, ctx: ctx, handle: handle};
}

function sectionTitles(pane: HTMLElement): string[] {
  return Array.from(pane.querySelectorAll<HTMLElement>('.settings-section > h3'))
    .map(function (heading) { return heading.textContent || ''; });
}

describe('Look pane', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('composes Profile, Background, Glass and Clock & icons in that order', () => {
    const background = makeBackgroundStub();
    const {pane} = buildLook(makeConfig(), background);

    expect(sectionTitles(pane)).toEqual(['Profile', 'Background', 'Glass', 'Clock & icons']);
    // The Background pane is mounted by the Look pane, between Profile and Glass.
    expect(background.build).toHaveBeenCalledTimes(1);

    // The Profile, Glass and Clock controls keep their focus indices.
    expect(pane.querySelector('[data-focus-index="901"]')).not.toBeNull();
    expect(pane.querySelector('[data-focus-index="1091"]')).not.toBeNull();
    expect(pane.querySelector('[data-focus-index="1092"]')).not.toBeNull();
    expect(pane.querySelector('[data-focus-index="1093"]')).not.toBeNull();
    expect(pane.querySelector('[data-focus-index="1000"]')).not.toBeNull();
    expect(pane.querySelector('[data-focus-index="1008"]')).not.toBeNull();
    expect(pane.querySelector('[data-focus-index="1090"]')).not.toBeNull();
  });

  it('drives the Background pane note when the active profile changes', () => {
    const background = makeBackgroundStub();
    const {pane} = buildLook(makeConfig(), background);

    const profile = pane.querySelector('[data-focus-index="901"]') as OptionStepperElement;
    expect(profile.value).toBe('default');
    profile.__step(1);

    expect(background.setProfile).toHaveBeenCalledWith(profile.value);
  });

  it('binds the clock and glass controls through the context', () => {
    const config = makeConfig();
    const {pane, ctx} = buildLook(config);

    const showClock = pane.querySelector('[data-focus-index="1000"]') as HTMLInputElement;
    showClock.checked = false;
    showClock.dispatchEvent(new Event('change'));

    const glassTint = pane.querySelector('[data-focus-index="1091"]') as OptionStepperElement;
    glassTint.__step(1);

    ctx.binder.collect(config);

    expect(config.launcher.showClock).toBe(false);
    expect(config.launcher.glassTint).toBe('dark');
  });
});
