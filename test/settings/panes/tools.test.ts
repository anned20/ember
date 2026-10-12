import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@config/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@config/config.js')>();
  return Object.assign({}, actual, {
    loadConfig: vi.fn(() => ({}) as unknown as ReturnType<typeof actual.loadConfig>),
    saveConfig: vi.fn(),
    configFromBackup: vi.fn()
  });
});

vi.mock('@luna/luna.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@luna/luna.js')>();
  return Object.assign({}, actual, {
    execRoot: vi.fn(async () => ''),
    readSettingsBackups: vi.fn(async () => []),
    writeAutoBackup: vi.fn(async () => {}),
    writeSettingsBackup: vi.fn(async () => ({usb: true, usbError: ''})),
    runTvCheck: vi.fn(async () => '')
  });
});

vi.mock('@lib/usb.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lib/usb.js')>();
  return Object.assign({}, actual, {
    findLoungeRoots: vi.fn(async () => ['/media/usb1'])
  });
});

vi.mock('@lib/qr-svg.js', () => ({
  qrSvgMarkup: vi.fn(() => '<svg></svg>')
}));

import {createToolsPane} from '@settings/panes/tools.js';
import {createBinder} from '@settings/settings-binding.js';
import {settingsBackupText} from '@settings/settings-backup.js';
import {readSettingsBackups, runTvCheck} from '@luna/luna.js';
import {configFromBackup, saveConfig} from '@config/config.js';
import {findLoungeRoots} from '@lib/usb.js';
import type {PaneHandle, SettingsContext, SettingsPanelOptions} from '@settings/pane.js';
import type {Config} from '@lib/types.js';

function makeConfig(overrides: Record<string, unknown> = {}): Config {
  return Object.assign({
    version: 1,
    profile: 'default',
    launcher: {},
    background: {}
  }, overrides) as unknown as Config;
}

interface Hooks {
  onSave?: (config: Config) => void;
  focusNow?: (el: Element | null) => boolean;
  redraw?: () => void;
}

function makeContext(config: Config, pane: HTMLDivElement, hooks: Hooks = {}): SettingsContext {
  return {
    config: config,
    rawConfig: config,
    binder: createBinder(config),
    panes: {tools: pane},
    options: {onSave: hooks.onSave} as SettingsPanelOptions,
    apps: {pinnedOrder: [], customApps: [], appsByIdMap: {}, installedCatalog: null},
    focusInPanel: function () { return true; },
    isVisible: function () { return true; },
    focusControl: function () {},
    focusNow: hooks.focusNow || function () { return true; },
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
    redraw: hooks.redraw || function () {}
  };
}

function buildTools(
  config: Config = makeConfig(),
  hooks: Hooks = {}
): {pane: HTMLElement; ctx: SettingsContext; handle: PaneHandle} {
  const pane = document.createElement('div');
  const ctx = makeContext(config, pane, hooks);
  const handle = createToolsPane();
  handle.build(ctx);
  return {pane: pane, ctx: ctx, handle: handle};
}

async function waitFor(check: () => boolean, ms = 1000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (check()) return;
    await new Promise(function (resolve) { setTimeout(resolve, 10); });
  }
  throw new Error('waitFor timed out');
}

function pickRow(pane: HTMLElement): HTMLElement {
  return (pane.querySelector('[data-focus-index="1592"]') as HTMLElement).closest('.settings-row') as HTMLElement;
}

describe('tools pane', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    vi.mocked(readSettingsBackups).mockReset();
    vi.mocked(readSettingsBackups).mockResolvedValue([]);
    vi.mocked(runTvCheck).mockReset();
    vi.mocked(runTvCheck).mockResolvedValue('');
    vi.mocked(configFromBackup).mockReset();
    vi.mocked(saveConfig).mockReset();
    vi.mocked(findLoungeRoots).mockReset();
    vi.mocked(findLoungeRoots).mockResolvedValue(['/media/usb1']);
  });

  it('builds the backup & restore and TV check sections', () => {
    const {pane} = buildTools();

    const backup = pane.querySelector('[data-backup-action="backup"]') as HTMLElement;
    const restore = pane.querySelector('[data-backup-action="restore"]') as HTMLElement;
    expect(backup.dataset.focusIndex).toBe('1590');
    expect(restore.dataset.focusIndex).toBe('1591');

    // The backup picker is hidden until Restore has found backups.
    expect(pickRow(pane).hidden).toBe(true);

    expect(pane.querySelector('[data-focus-index="1600"]')).not.toBeNull();
    expect((pane.querySelector('[data-focus-index="1601"]') as HTMLElement).hidden).toBe(true);

    expect(pane.textContent).toContain('No backup made from this TV yet.');
  });

  it('lists the backups, restores the chosen one, and redraws through the context', async () => {
    const current = makeConfig();
    vi.mocked(readSettingsBackups).mockResolvedValue([
      {where: 'TV', text: settingsBackupText(current, {reason: 'manual'})}
    ]);
    const restored = makeConfig();
    vi.mocked(configFromBackup).mockReturnValue({config: restored, skipped: []} as never);

    const onSave = vi.fn();
    const redraw = vi.fn();
    const {pane, handle} = buildTools(current, {onSave: onSave, redraw: redraw});
    const restore = pane.querySelector('[data-backup-action="restore"]') as HTMLElement;

    // First press: find the backups and reveal the picker.
    restore.click();
    await waitFor(function () { return !pickRow(pane).hidden; });
    expect(restore.textContent).toBe('Restore this backup');
    expect(readSettingsBackups).toHaveBeenCalledWith(['/media/usb1']);

    // Second press: restore the chosen backup.
    restore.click();
    await waitFor(function () { return redraw.mock.calls.length === 1; });
    expect(saveConfig).toHaveBeenCalledWith(restored);
    expect(onSave).toHaveBeenCalledWith(restored);

    // The redraw rebuilds the panel (and this pane); the report survives.
    const second = document.createElement('div');
    handle.build(makeContext(current, second, {}));
    expect(second.textContent).toContain('Restored the settings from');
  });

  it('runs the TV check, shows the report, and focuses the result', async () => {
    vi.mocked(runTvCheck).mockResolvedValue('model: OLED\n=== details ===\nnot shown');
    const focusNow = vi.fn(function () { return true; });
    const {pane} = buildTools(makeConfig(), {focusNow: focusNow});

    const btn = pane.querySelector('[data-focus-index="1600"]') as HTMLElement;
    btn.click();

    const result = pane.querySelector('[data-focus-index="1601"]') as HTMLElement;
    await waitFor(function () { return !result.hidden; });

    const report = pane.querySelector('.tv-check-report') as HTMLElement;
    expect(report.textContent).toContain('Launch Home');
    expect(report.textContent).toContain('model: OLED');
    expect(report.textContent).not.toContain('not shown');
    expect(focusNow).toHaveBeenCalledWith(result);
  });
});
