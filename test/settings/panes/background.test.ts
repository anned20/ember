import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@background/backgrounds.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@background/backgrounds.js')>();
  return Object.assign({}, actual, {
    loadBuiltinManifest: vi.fn(async () => [])
  });
});

import {createBackgroundPane} from '@settings/panes/background.js';
import {createBinder} from '@settings/settings-binding.js';
import {loadBuiltinManifest} from '@background/backgrounds.js';
import {AERIAL_BACKGROUNDS} from '@background/aerials.js';
import {BRAND} from '@lib/brand.js';
import {REMOTE_BACKGROUNDS} from '@background/backgrounds.js';
import type {BackgroundPaneHandle} from '@settings/panes/background.js';
import {setLanguage, t} from '@lib/i18n.js';
import type {SettingsContext, SettingsPanelOptions} from '@settings/pane.js';
import type {BuiltinBackground, Config} from '@lib/types.js';

function makeConfig(overrides: Record<string, unknown> = {}): Config {
  return Object.assign({
    profile: 'default',
    profiles: {},
    background: {}
  }, overrides) as unknown as Config;
}

function buildPane(
  config: Config = makeConfig(),
  options: SettingsPanelOptions = {}
): {pane: HTMLElement; config: Config; ctx: SettingsContext; handle: BackgroundPaneHandle} {
  const pane = document.createElement('div');
  const ctx: SettingsContext = {
    config: config,
    rawConfig: config,
    binder: createBinder(config),
    panes: {look: pane},
    options: options,
    apps: {appsByIdMap: {}, installedCatalog: null},
    focusInPanel: function () { return true; },
    isVisible: function () { return true; },
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
  const handle = createBackgroundPane();
  handle.build(ctx);
  return {pane: pane, config: config, ctx: ctx, handle: handle};
}

function stepper(pane: HTMLElement, focusIndex: string): HTMLElement & {__step(dir: number): void} {
  return pane.querySelector('[data-focus-index="' + focusIndex + '"]') as
    HTMLElement & {__step(dir: number): void};
}

function rowFor(pane: HTMLElement, focusIndex: string): HTMLElement {
  // The photo galleries share the 905+ index space, so skip their tiles.
  const els = Array.prototype.slice.call(
    pane.querySelectorAll('[data-focus-index="' + focusIndex + '"]')) as HTMLElement[];
  const el = els.find(function (e) { return !e.closest('.photo-picker-block'); });
  return el!.closest('.settings-row, .settings-block') as HTMLElement;
}

function galleryByHeading(pane: HTMLElement, prefix: string): HTMLElement | undefined {
  const blocks = Array.prototype.slice.call(pane.querySelectorAll('.photo-picker-block')) as HTMLElement[];
  return blocks.find(function (block) {
    const label = block.querySelector('.settings-block-label');
    return !!label && (label.textContent || '').indexOf(prefix) === 0;
  });
}

const MANIFEST: BuiltinBackground[] = [
  {id: 'alpha', title: 'Alpha', file: 'alpha.jpg'},
  {id: 'beta', title: 'Beta', file: 'beta.jpg'}
];

describe('background pane', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    setLanguage('en');
    vi.mocked(loadBuiltinManifest).mockReset();
    vi.mocked(loadBuiltinManifest).mockResolvedValue([]);
  });

  afterEach(() => setLanguage('en'));

  it('builds the source, style, gallery, URL and overlay controls', () => {
    const {pane} = buildPane();

    ['902', '903', '904', '936', '930', '931', '932', '933', '934', '935'].forEach(function (index) {
      expect(pane.querySelector('[data-focus-index="' + index + '"]')).not.toBeNull();
    });

    const aerial = galleryByHeading(pane, 'Choose an aerial clip');
    expect(aerial!.querySelectorAll('.photo-picker-tile').length).toBe(AERIAL_BACKGROUNDS.length);
    const remote = galleryByHeading(pane, 'Choose an online photo');
    expect(remote!.querySelectorAll('.photo-picker-tile').length).toBe(REMOTE_BACKGROUNDS.length + 1);

    // The profile-vs-source note is quiet for the default profile.
    expect((pane.querySelector('.settings-hint') as HTMLElement).hidden).toBe(true);
  });

  it('shows only the rows that fit the chosen source and display mode', () => {
    const {pane} = buildPane();
    const source = stepper(pane, '902');
    const display = stepper(pane, '904');
    const builtinRow = galleryByHeading(pane, 'Choose a built-in photo')!;
    const remoteRow = galleryByHeading(pane, 'Choose an online photo')!;
    const aerialRow = galleryByHeading(pane, 'Choose an aerial clip')!;

    // Gradient source: no image rows at all.
    expect(rowFor(pane, '904').hidden).toBe(true);
    expect(builtinRow.hidden).toBe(true);
    expect(remoteRow.hidden).toBe(true);
    expect(aerialRow.hidden).toBe(true);

    // Built-in photos: the gallery is up, the USB/URL/aerial rows are not.
    source.__step(2);
    expect(rowFor(pane, '904').hidden).toBe(false);
    expect(builtinRow.hidden).toBe(false);
    expect(rowFor(pane, '930').hidden).toBe(true);
    expect(remoteRow.hidden).toBe(true);
    expect(aerialRow.hidden).toBe(true);

    // Online URL: gallery, link field and status; the slideshow list waits.
    source.__step(2);
    expect(remoteRow.hidden).toBe(false);
    expect(rowFor(pane, '931').hidden).toBe(false);
    expect(rowFor(pane, '932').hidden).toBe(true);
    expect(builtinRow.hidden).toBe(true);

    // Slideshow swaps the single link for the URL list.
    display.__step(1);
    expect(remoteRow.hidden).toBe(true);
    expect(rowFor(pane, '931').hidden).toBe(true);
    expect(rowFor(pane, '932').hidden).toBe(false);
    expect(rowFor(pane, '933').hidden).toBe(false);

    // Aerial is one clip at a time; shuffle only appears in its slideshow.
    source.__step(1);
    expect(aerialRow.hidden).toBe(true);
    expect(rowFor(pane, '936').hidden).toBe(false);
    display.__step(-1);
    expect(aerialRow.hidden).toBe(false);
    expect(rowFor(pane, '936').hidden).toBe(true);
    expect(rowFor(pane, '934').hidden).toBe(true);
  });

  it('drives the profile-vs-source note through the pane handle', () => {
    const {pane, handle} = buildPane(makeConfig({profile: 'default'}));
    const note = pane.querySelector('.settings-hint') as HTMLElement;

    handle.setProfile('cinema');
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain('Cinema profile uses its own dark background');

    handle.setProfile('night');
    expect(note.hidden).toBe(true);
    expect(note.textContent).toBe('');
  });

  it('applies a profile set before the pane is built', () => {
    const handle = createBackgroundPane();
    handle.setProfile('cinema');

    const pane = document.createElement('div');
    const config = makeConfig();
    handle.build({
      config: config,
      rawConfig: config,
      binder: createBinder(config),
      panes: {look: pane},
      options: {},
      isVisible: function () { return true; },
      focusControl: function () {},
      focusNow: function () { return true; },
      focusGallery: function () {},
      refocusListButton: function () {},
      withDeadline: function <T>(promise: Promise<T>) { return Promise.resolve(promise); },
      redraw: function () {}
    } as unknown as SettingsContext);

    const note = pane.querySelector('.settings-hint') as HTMLElement;
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain('Cinema profile uses its own dark background');
  });

  it('fills the built-in gallery from the manifest and saves the pick', async () => {
    vi.mocked(loadBuiltinManifest).mockResolvedValue(MANIFEST);
    const {pane, config, ctx, handle} = buildPane();

    const builtinRow = galleryByHeading(pane, 'Choose a built-in photo')!;
    expect(builtinRow.querySelectorAll('.photo-picker-tile').length).toBe(0);

    await handle.load!(ctx);

    const tiles = builtinRow.querySelectorAll('.photo-picker-tile') as NodeListOf<HTMLElement>;
    expect(tiles.length).toBe(2);
    expect(tiles[0].dataset.focusIndex).toBe('905');

    tiles[1].click();
    expect(tiles[1].classList.contains('is-selected')).toBe(true);

    ctx.binder.collect(config);
    expect(config.background.builtin).toBe('beta');
  });

  it('reads the pane, its galleries and the profile note in Dutch', () => {
    setLanguage('nl');
    const {pane, handle} = buildPane();

    expect(pane.textContent).toContain(t('background.source'));
    expect(pane.textContent).toContain(t('background.usb.hint', {folder: 'ember'}));
    expect(pane.textContent).toContain(t('background.aerial.hint', {brand: BRAND.name}));
    expect(galleryByHeading(pane, t('background.aerial.heading', {
      count: AERIAL_BACKGROUNDS.length
    }))).toBeTruthy();
    expect(galleryByHeading(pane, t('background.builtin.heading'))).toBeTruthy();
    expect(galleryByHeading(pane, t('background.url.heading', {
      count: REMOTE_BACKGROUNDS.length
    }))).toBeTruthy();

    handle.setProfile('cinema');
    const note = pane.querySelector('.settings-hint') as HTMLElement;
    expect(note.textContent).toContain(t('background.profileNote', {
      profile: t('look.profile.cinema')
    }));
  });

  it('keeps the stored source values while showing the Dutch labels', () => {
    setLanguage('nl');
    const {pane, config, ctx} = buildPane();

    const source = stepper(pane, '902');
    expect((source.querySelector('.stepper-label') as HTMLElement).textContent)
      .toBe(t('background.source.preset'));
    expect((source as unknown as {value: string}).value).toBe('preset');
    source.__step(2);
    ctx.binder.collect(config);

    expect(config.background.source).toBe('builtin');
  });
});
