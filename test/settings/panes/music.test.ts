import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@music/builtin-music.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@music/builtin-music.js')>();
  return Object.assign({}, actual, {
    loadBuiltinMusicManifest: vi.fn(async () => [])
  });
});

vi.mock('@lib/usb.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lib/usb.js')>();
  return Object.assign({}, actual, {
    findLoungeRoots: vi.fn(async () => []),
    joinPath: vi.fn((...parts: string[]) => parts.join('/')),
    discoverMusicTracks: vi.fn(async () => [])
  });
});

import {createMusicPane} from '@settings/panes/music.js';
import {createBinder} from '@settings/settings-binding.js';
import {loadBuiltinMusicManifest} from '@music/builtin-music.js';
import {discoverMusicTracks} from '@lib/usb.js';
import {setLanguage, t, tn} from '@lib/i18n.js';
import type {PaneHandle, SettingsContext, SettingsPanelOptions} from '@settings/pane.js';
import type {BuiltinMusicEntry, Config, UsbTrack} from '@lib/types.js';

function makeConfig(overrides: Partial<Config['music']> = {}): Config {
  return {
    music: Object.assign({
      enabled: true,
      source: 'builtin',
      builtin: '',
      builtinPlaylist: [],
      path: '',
      usbPlaylist: [],
      shuffle: false,
      repeat: 'all',
      volume: 0.2,
      fadeSec: 1,
      pauseOnLaunch: false,
      resumeOnReturn: false,
      showBar: false
    }, overrides)
  } as unknown as Config;
}

function buildMusic(
  config: Config = makeConfig(),
  options: SettingsPanelOptions = {},
  isVisible: () => boolean = function () { return true; }
): {pane: HTMLElement; config: Config; ctx: SettingsContext; handle: PaneHandle} {
  const pane = document.createElement('div');
  const ctx: SettingsContext = {
    config: config,
    rawConfig: config,
    binder: createBinder(config),
    panes: {music: pane},
    options: options,
    apps: {appsByIdMap: {}, installedCatalog: null},
    focusInPanel: function () { return true; },
    isVisible: isVisible,
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
  const handle = createMusicPane();
  handle.build(ctx);
  return {pane: pane, config: config, ctx: ctx, handle: handle};
}

async function waitFor(check: () => boolean, ms = 1000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (check()) return;
    await new Promise(function (resolve) { setTimeout(resolve, 10); });
  }
  throw new Error('waitFor timed out');
}

function trackRowCount(pane: HTMLElement): number {
  return pane.querySelectorAll('.settings-track-row').length;
}

describe('music pane', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    setLanguage('en');
    vi.mocked(loadBuiltinMusicManifest).mockReset();
    vi.mocked(loadBuiltinMusicManifest).mockResolvedValue([]);
    vi.mocked(discoverMusicTracks).mockReset();
    vi.mocked(discoverMusicTracks).mockResolvedValue([]);
  });

  afterEach(() => setLanguage('en'));

  it('builds the ambient controls with the configured source', () => {
    const {pane} = buildMusic(makeConfig({source: 'builtin'}));

    [940, 9405, 941, 950, 951, 952, 990, 991, 992].forEach(function (index) {
      expect(pane.querySelector('[data-focus-index="' + index + '"]')).not.toBeNull();
    });

    // Nothing from the manifest yet.
    expect(trackRowCount(pane)).toBe(0);

    // Built-in source: the USB folder/path rows are hidden.
    const path = pane.querySelector('[data-focus-index="952"]') as HTMLElement;
    expect((path.closest('.settings-row') as HTMLElement).hidden).toBe(true);
  });

  it('loads the built-in manifest into the rows and the start options', async () => {
    const manifest: BuiltinMusicEntry[] = [
      {id: 'a', title: 'Alpha', artist: 'A', file: 'a.mp3'},
      {id: 'b', title: 'Bravo', artist: 'B', file: 'b.mp3'}
    ];
    vi.mocked(loadBuiltinMusicManifest).mockResolvedValue(manifest);

    const {pane, handle, ctx} = buildMusic(makeConfig({builtin: 'b'}));
    await handle.load!(ctx);

    const rows = pane.querySelectorAll('.settings-track-row');
    expect(rows.length).toBe(2);
    const boxes = Array.prototype.slice.call(
      pane.querySelectorAll('.settings-track-row input[type=checkbox]')) as HTMLInputElement[];
    expect(boxes[0].dataset.focusIndex).toBe('942');
    expect(boxes[1].dataset.focusIndex).toBe('943');
    expect(boxes.every(function (box) { return box.checked; })).toBe(true);

    const startSelect = pane.querySelector('[data-focus-index="950"]') as HTMLElement;
    expect(startSelect.querySelector('.stepper-label')!.textContent).toBe('Bravo');
  });

  it('saves the built-in playlist from the ticks', async () => {
    const manifest: BuiltinMusicEntry[] = [
      {id: 'a', title: 'Alpha', artist: 'A', file: 'a.mp3'},
      {id: 'b', title: 'Bravo', artist: 'B', file: 'b.mp3'},
      {id: 'c', title: 'Charlie', artist: 'C', file: 'c.mp3'}
    ];
    vi.mocked(loadBuiltinMusicManifest).mockResolvedValue(manifest);

    const {pane, config, handle, ctx} = buildMusic(makeConfig());
    await handle.load!(ctx);

    // All ticked (empty saved playlist = all) collapses back to "all".
    ctx.binder.collect(config);
    expect(config.music.builtinPlaylist).toEqual([]);

    // Untick the middle track: the playlist holds the rest.
    const boxes = pane.querySelectorAll('.settings-track-row input[type=checkbox]') as
      NodeListOf<HTMLInputElement>;
    boxes[1].checked = false;
    boxes[1].dispatchEvent(new Event('change'));
    ctx.binder.collect(config);
    expect(config.music.builtinPlaylist).toEqual(['a', 'c']);
  });

  it('scans the USB folder and saves the ticked tracks', async () => {
    const tracks: UsbTrack[] = [
      {url: 'u1', title: 'One', artist: 'A'},
      {url: 'u2', title: 'Two', artist: 'B'}
    ];
    vi.mocked(discoverMusicTracks).mockResolvedValue(tracks);

    const {pane, config, ctx} = buildMusic(makeConfig({
      source: 'usb',
      path: '/media/usb1/ember/music',
      usbPlaylist: ['u1']
    }));

    await waitFor(function () { return trackRowCount(pane) === 2; });
    expect(discoverMusicTracks).toHaveBeenCalledWith('/media/usb1/ember/music');

    // Only the saved track is ticked; the other is left out.
    const boxes = pane.querySelectorAll('.settings-track-row input[type=checkbox]') as
      NodeListOf<HTMLInputElement>;
    expect(boxes[0].checked).toBe(true);
    expect(boxes[1].checked).toBe(false);

    ctx.binder.collect(config);
    expect(config.music.usbPlaylist).toEqual(['u1']);
  });

  it('reads every control, choice and status line in Dutch', async () => {
    setLanguage('nl');
    const tracks: UsbTrack[] = [
      {url: 'u1', title: 'One', artist: 'A'},
      {url: 'u2', title: 'Two', artist: 'B'}
    ];
    vi.mocked(discoverMusicTracks).mockResolvedValue(tracks);

    const {pane} = buildMusic(makeConfig({source: 'usb', path: '/media/usb1/ember/music'}));
    await waitFor(function () { return trackRowCount(pane) === 2; });

    expect(pane.querySelector('.settings-section > h3')!.textContent).toBe(t('music.section'));
    expect(pane.textContent).toContain(t('music.enabled'));
    expect(pane.textContent).toContain(t('music.showBar'));
    expect(pane.textContent).toContain(t('music.source'));
    expect(pane.textContent).toContain(t('music.startWith'));
    expect(pane.textContent).toContain(t('music.path'));
    expect(pane.textContent).toContain(t('music.usbPlaylist'));
    expect(pane.textContent).toContain(t('music.volume'));
    // The USB scan count is a counted string: 2 goes through the other form.
    expect(pane.textContent).toContain(tn('music.usbScan.found', 2));

    const source = pane.querySelector('[data-focus-index="941"]') as HTMLElement;
    expect(source.querySelector('.stepper-label')!.textContent).toBe(t('music.source.usb'));
    const repeat = pane.querySelector('[data-focus-index="991"]') as HTMLElement;
    expect(repeat.querySelector('.stepper-label')!.textContent).toBe(t('music.repeat.all'));
  });

  it('keeps the stored values while showing the Dutch labels', () => {
    setLanguage('nl');
    const {pane, config, ctx} = buildMusic(makeConfig({source: 'builtin', repeat: 'one'}));

    const source = pane.querySelector('[data-focus-index="941"]') as unknown as {value: string};
    const repeat = pane.querySelector('[data-focus-index="991"]') as unknown as {value: string};
    expect(source.value).toBe('builtin');
    expect(repeat.value).toBe('one');

    source.value = 'usb';
    ctx.binder.collect(config);
    expect(config.music.source).toBe('usb');
    expect(config.music.repeat).toBe('one');
  });
});
