import {beforeEach, describe, expect, it, vi} from 'vitest';
import {BRAND} from '@lib/brand.js';

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

vi.mock('@lib/update-check.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lib/update-check.js')>();
  return Object.assign({}, actual, {
    fetchLatestRelease: vi.fn(async () => 'v0.0.0')
  });
});

import {createToolsPane} from '@settings/panes/tools.js';
import {createBinder} from '@settings/settings-binding.js';
import {
  LAST_BACKUP_KEY, backupLabel, backupWhen, backupWhereLabel, compatibilityNote, lastBackupNote,
  parseBackup, restoreReport, settingsBackupText
} from '@settings/settings-backup.js';
import {readSettingsBackups, runTvCheck} from '@luna/luna.js';
import {CONFIG_SCHEMA_VERSION, configFromBackup, saveConfig} from '@config/config.js';
import {findLoungeRoots} from '@lib/usb.js';
import {fetchLatestRelease} from '@lib/update-check.js';
import {setLanguage, t, tn} from '@lib/i18n.js';
import {APP_VERSION} from '@lib/version.js';
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
    apps: {appsByIdMap: {}, installedCatalog: null},
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

/** The backup section's status line (the pane's second hint). */
function backupStatus(pane: HTMLElement): string {
  return (pane.querySelectorAll('.settings-hint')[1] as HTMLElement).textContent || '';
}

/** The TV check's status line, right under its button. */
function tvCheckStatus(pane: HTMLElement): string {
  const btn = pane.querySelector('[data-focus-index="1600"]') as HTMLElement;
  return (btn.nextElementSibling as HTMLElement).textContent || '';
}

/** The Updates section's check button, result line and release-page code. */
function updateParts(pane: HTMLElement): {btn: HTMLButtonElement; status: HTMLElement; qr: HTMLElement} {
  return {
    btn: pane.querySelector('[data-focus-index="1602"]') as HTMLButtonElement,
    status: pane.querySelector('[data-update-action="status"]') as HTMLElement,
    qr: pane.querySelector('[data-update-action="qr"]') as HTMLElement
  };
}

describe('tools pane', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    setLanguage('en');
    vi.mocked(readSettingsBackups).mockReset();
    vi.mocked(readSettingsBackups).mockResolvedValue([]);
    vi.mocked(runTvCheck).mockReset();
    vi.mocked(runTvCheck).mockResolvedValue('');
    vi.mocked(configFromBackup).mockReset();
    vi.mocked(saveConfig).mockReset();
    vi.mocked(findLoungeRoots).mockReset();
    vi.mocked(findLoungeRoots).mockResolvedValue(['/media/usb1']);
    vi.mocked(fetchLatestRelease).mockReset();
    vi.mocked(fetchLatestRelease).mockResolvedValue('v0.0.0');
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

    // The Updates section shows the running version and the check button, and
    // no code until there is a release to open.
    expect(pane.textContent).toContain(BRAND.name + ' ' + APP_VERSION);
    expect(pane.querySelector('[data-focus-index="1602"]')).not.toBeNull();
    expect((pane.querySelector('[data-update-action="qr"]') as HTMLElement).hidden).toBe(true);

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
    expect(report.textContent).toContain(BRAND.name);
    expect(report.textContent).toContain('model: OLED');
    expect(report.textContent).not.toContain('not shown');
    expect(focusNow).toHaveBeenCalledWith(result);
  });

  it('reports a newer release with a code for its release page', async () => {
    let release: (tag: string) => void = function () {};
    vi.mocked(fetchLatestRelease).mockReturnValue(new Promise(function (resolve) { release = resolve; }));
    const {pane} = buildTools();
    const {btn, status, qr} = updateParts(pane);

    btn.click();
    // Not disabled while busy: a disabled button drops focus.
    expect(btn.textContent).toBe('Checking…');
    expect(btn.disabled).toBe(false);
    // A second press while the first is in flight is ignored.
    btn.click();
    release('v9.9.9');
    await waitFor(function () { return status.textContent.indexOf('is available') >= 0; });

    expect(fetchLatestRelease).toHaveBeenCalledTimes(1);
    expect(status.textContent).toContain(BRAND.name + ' 9.9.9 is available');
    expect(status.textContent).toContain('you have ' + APP_VERSION);
    expect(qr.hidden).toBe(false);
    expect(qr.querySelector('svg')).not.toBeNull();
    expect(btn.textContent).toBe('Check for updates');
  });

  it('reports the running version as up to date, with no code', async () => {
    vi.mocked(fetchLatestRelease).mockResolvedValue(APP_VERSION);
    const {pane} = buildTools();
    const {btn, status, qr} = updateParts(pane);

    btn.click();
    await waitFor(function () { return status.textContent.indexOf('up to date') >= 0; });

    expect(status.textContent).toContain(BRAND.name + ' ' + APP_VERSION);
    expect(qr.hidden).toBe(true);
  });

  it('reports a failure to reach GitHub, without a stale code', async () => {
    vi.mocked(fetchLatestRelease).mockRejectedValue(new Error('HTTP 403'));
    const {pane} = buildTools();
    const {btn, status, qr} = updateParts(pane);

    // A code from an earlier check must not survive a failure.
    (qr.querySelector('.tv-check-qr') as HTMLElement).innerHTML = '<svg></svg>';
    qr.hidden = false;
    btn.click();
    await waitFor(function () { return status.textContent.indexOf('reach GitHub') >= 0; });

    expect(status.textContent).toContain('Couldn\u2019t reach GitHub');
    expect(status.textContent).not.toContain('up to date');
    expect(qr.hidden).toBe(true);
    expect(qr.querySelector('svg')).toBeNull();
  });

  it('reads the whole pane in Dutch, through every flow', async () => {
    setLanguage('nl');
    const current = makeConfig({version: CONFIG_SCHEMA_VERSION});
    const backupText = settingsBackupText(current, {reason: 'manual'});
    vi.mocked(readSettingsBackups).mockResolvedValue([
      {where: 'TV', text: backupText}
    ]);
    vi.mocked(runTvCheck).mockResolvedValue('model: OLED\n=== details ===\nnot shown');
    vi.mocked(fetchLatestRelease).mockResolvedValue('v9.9.9');
    const {pane} = buildTools(current);

    expect(pane.textContent).toContain(t('tools.backupSection'));
    expect(pane.textContent).toContain(t('tools.backUp'));
    expect(pane.textContent).toContain(t('tools.tvCheckSection'));
    expect(pane.textContent).toContain(t('tools.updatesSection'));
    expect(pane.textContent).toContain(
      t('tools.runningVersion', {brand: BRAND.name, version: APP_VERSION}));
    expect(pane.textContent).toContain(t('backup.noneYet'));
    expect(backupStatus(pane)).toContain(t('backup.noneYet'));

    // Backing up: the Dutch status line, and the note left behind for later.
    (pane.querySelector('[data-backup-action="backup"]') as HTMLElement).click();
    await waitFor(function () {
      return backupStatus(pane).indexOf(backupWhereLabel('TV and USB drive')) >= 0;
    });
    expect(backupStatus(pane)).toContain(backupWhereLabel('TV and USB drive'));
    const savedAt = JSON.parse(localStorage.getItem(LAST_BACKUP_KEY) || '{}').savedAt;
    expect(lastBackupNote()).toContain(backupWhen(savedAt));
    expect(lastBackupNote()).toContain(backupWhereLabel('TV and USB drive'));

    // Restoring: the picker, its description and the report it leaves.
    const restored = makeConfig({version: CONFIG_SCHEMA_VERSION});
    vi.mocked(configFromBackup).mockReturnValue({config: restored, skipped: []} as never);
    const second = document.createElement('div');
    const ctx = makeContext(current, second, {});
    const handle = createToolsPane();
    handle.build(ctx);
    const restore = second.querySelector('[data-backup-action="restore"]') as HTMLElement;
    restore.click();
    await waitFor(function () { return !pickRow(second).hidden; });
    const chosen = parseBackup(backupText, 'TV')!;
    expect(restore.textContent).toBe(t('tools.restoreThis'));
    expect(backupStatus(second)).toContain(compatibilityNote(chosen));
    expect(backupStatus(second)).toContain(t('tools.pressRestore'));
    expect((second.querySelector('[data-focus-index="1592"]') as HTMLElement).textContent)
      .toContain(t('backup.kindManual') + ' · ' + backupWhereLabel('TV'));

    restore.click();
    await waitFor(function () { return vi.mocked(saveConfig).mock.calls.length > 0; });
    // The report the restore leaves behind shows on the rebuilt pane.
    const third = document.createElement('div');
    handle.build(makeContext(restored, third, {}));
    expect(third.textContent).toContain(restoreReport(chosen, {skipped: []} as never));

    // The TV check and the update check, in Dutch.
    let finishCheck: (report: string) => void = function () {};
    vi.mocked(runTvCheck).mockImplementation(function () {
      return new Promise(function (resolve) { finishCheck = resolve; });
    });
    (pane.querySelector('[data-focus-index="1600"]') as HTMLElement).click();
    await waitFor(function () {
      return tvCheckStatus(pane).indexOf(t('tools.tvCheckRunning')) >= 0;
    });
    expect(tvCheckStatus(pane)).toContain(t('tools.tvCheckRunning'));
    const result = pane.querySelector('[data-focus-index="1601"]') as HTMLElement;
    finishCheck('model: OLED\n=== details ===\nnot shown');
    await waitFor(function () { return !result.hidden; });
    expect(tvCheckStatus(pane)).toContain(t('tools.tvCheckDone'));

    const {btn, status} = updateParts(pane);
    btn.click();
    const available = t('tools.updateAvailable', {
      brand: BRAND.name, version: '9.9.9', current: APP_VERSION
    });
    await waitFor(function () { return status.textContent.indexOf(available) >= 0; });
    expect(status.textContent).toContain(available);
  });

  it('reads the pane in French', () => {
    setLanguage('fr');
    const {pane} = buildTools(makeConfig({version: CONFIG_SCHEMA_VERSION}));

    expect(pane.textContent).toContain('Sauvegarde et restauration');
    expect(pane.textContent).toContain('Sauvegarder les réglages');
    expect(pane.textContent).toContain('Diagnostic TV');
    expect(pane.textContent).toContain('Mises à jour');
    expect(pane.textContent).toContain('Aucune sauvegarde de ce TV pour l’instant.');
  });

  it('reads the backup descriptions in Dutch', () => {
    setLanguage('nl');
    const text = settingsBackupText(makeConfig({version: CONFIG_SCHEMA_VERSION}), {reason: 'manual'});
    const b = parseBackup(text, 'TV')!;

    expect(backupWhen('nonsense')).toBe(t('backup.unknownDate'));
    expect(backupLabel(b)).toContain(
      t('backup.kindManual') + ' · ' + backupWhereLabel('TV') + ' · ' + APP_VERSION);
    expect(compatibilityNote(b)).toBe(t('backup.madeBySameSchema', {
      brand: BRAND.name, version: ' ' + APP_VERSION
    }));
    expect(restoreReport(b, {skipped: [{path: 'look.tint', why: 'type'}]} as never))
      .toContain(tn('backup.kept', 1, {settings: 'look.tint'}));
    expect(restoreReport(b, {skipped: [
      {path: 'a.b', why: 'newer'}, {path: 'c.d', why: 'newer'}
    ]} as never)).toContain(tn('backup.unused', 2, {settings: 'a.b, c.d'}));

    localStorage.setItem(LAST_BACKUP_KEY, JSON.stringify(
      {savedAt: '2026-10-19T06:30:00.000Z', where: 'TV and USB drive'}));
    expect(lastBackupNote()).toBe(t('backup.lastBackup', {
      when: backupWhen('2026-10-19T06:30:00.000Z'),
      where: backupWhereLabel('TV and USB drive')
    }));
  });
});
