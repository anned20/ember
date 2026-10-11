import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@luna/luna.js', () => ({
  disableVoice: vi.fn(async () => ({})),
  enableVoice: vi.fn(async () => ({otherVoice: ''})),
  execRoot: vi.fn(async () => ''),
  isVoiceRunning: vi.fn(async () => false),
  listLaunchPoints: vi.fn(async () => []),
  readSettingsBackups: vi.fn(async () => []),
  runTvCheck: vi.fn(async () => ''),
  whoAmI: vi.fn(async () => null),
  writeAutoBackup: vi.fn(async () => ({})),
  writeSettingsBackup: vi.fn(async () => ({usb: null}))
}));

vi.mock('@apps/apps.js', () => ({
  listInstalledApps: vi.fn(async () => [])
}));

vi.mock('@apps/app-catalog.js', () => ({
  isAppInstalled: vi.fn(() => true),
  loadAppCatalog: vi.fn(async () => ({})),
  rememberApps: vi.fn(),
  resolvePinnedApp: vi.fn(async (id: string) => ({id: id, title: id, icon: ''})),
  setIconSrc: vi.fn(),
  lazyLoadIcon: vi.fn()
}));

vi.mock('@lib/usb.js', () => ({
  findLoungeRoots: vi.fn(async () => []),
  joinPath: vi.fn((...parts: string[]) => parts.join('/')),
  discoverMusicTracks: vi.fn(async () => [])
}));

vi.mock('@home/inputs.js', () => ({
  fetchInputDevices: vi.fn(async () => []),
  inputFromId: vi.fn((id: string) => ({id: id, label: id})),
  isTvInputId: vi.fn((id: string) => id === 'TV')
}));

vi.mock('@voice/voice-config.js', () => ({
  getVoiceConfig: vi.fn(async () => ({})),
  getVoiceStatus: vi.fn(async () => ({})),
  setVoiceConfig: vi.fn(async () => ({})),
  startSuperGrokLogin: vi.fn(async () => ({})),
  cancelSuperGrokLogin: vi.fn(async () => ({})),
  signOutSuperGrok: vi.fn(async () => ({})),
  importSuperGrokAuth: vi.fn(async () => ({}))
}));

import {loadConfig} from '@config/config.js';
import {createSettingsPanel} from '@settings/settings.js';
import type {Config} from '@lib/types.js';

async function waitFor(selector: string, root: ParentNode, ms = 3000): Promise<Element> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const found = root.querySelector(selector);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for ' + selector);
}

describe('settings panel integration', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('renders the panel from the control kit without throwing', async () => {
    const panel = document.createElement('div');
    panel.id = 'settings-panel';
    document.body.appendChild(panel);

    const handle = createSettingsPanel(panel, loadConfig, {});
    handle.show();

    await waitFor('.settings-tab-pane', panel);
    const pane = await waitFor('.settings-tab-pane.is-active', panel);

    // The Look pane composes sections, hints, toggles and the photo galleries.
    expect(pane.querySelectorAll('.settings-section').length).toBeGreaterThan(0);
    expect(pane.querySelectorAll('.settings-hint').length).toBeGreaterThan(0);
    expect(pane.querySelectorAll('input[type=checkbox]').length).toBeGreaterThan(0);
    expect(pane.querySelectorAll('.photo-picker-tile').length).toBeGreaterThan(0);

    // A selected gallery tile carries the gold selection state.
    expect(pane.querySelector('.photo-picker-tile.is-selected')).not.toBeNull();

    // The category nav lists every pane.
    expect(panel.querySelectorAll('.settings-tab').length).toBeGreaterThan(5);
    handle.hide();
    expect(handle.isVisible()).toBe(false);
  });

  it('collects a plain binding into the config on Save', async () => {
    const panel = document.createElement('div');
    panel.id = 'settings-panel';
    document.body.appendChild(panel);

    const saved: Config[] = [];
    const handle = createSettingsPanel(panel, loadConfig, {
      onSave: function (config) { saved.push(config); }
    });
    handle.show();

    const clock = await waitFor('input[data-focus-index="1000"]', panel);
    expect((clock as HTMLInputElement).checked).toBe(true);
    (clock as HTMLInputElement).checked = false;
    clock.dispatchEvent(new Event('change'));

    const saveBtn = await waitFor('.settings-save', panel);
    // Wait out the open guard, which swallows the click sequence that opened us.
    await new Promise(function (resolve) { setTimeout(resolve, 800); });
    (saveBtn as HTMLButtonElement).click();

    expect(saved.length).toBe(1);
    expect(saved[0].launcher.showClock).toBe(false);
    const stored = JSON.parse(localStorage.getItem('lounge.config.v1') || '{}');
    expect(stored.launcher.showClock).toBe(false);
  });
});
