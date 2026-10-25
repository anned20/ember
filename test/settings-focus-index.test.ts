import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@luna/luna.js', () => ({
  listLaunchPoints: vi.fn(async () => [])
}));

vi.mock('@luna/root.js', () => ({
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

import {loadConfig} from '@config/config.js';
import {createSettingsPanel} from '@settings/settings.js';

async function waitFor(selector: string, root: ParentNode, ms = 3000): Promise<Element> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const found = root.querySelector(selector);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for ' + selector);
}

/** focusIndex -> how many focusable controls carry it, keys sorted numerically. */
function focusIndexCounts(root: ParentNode): Record<string, number> {
  const counts: Record<string, number> = {};
  root.querySelectorAll('.focusable').forEach((el) => {
    const key = (el as HTMLElement).dataset.focusIndex as string;
    counts[key] = (counts[key] || 0) + 1;
  });
  const sorted: Record<string, number> = {};
  Object.keys(counts)
    .sort((a, b) => Number(a) - Number(b))
    .forEach((key) => { sorted[key] = counts[key]; });
  return sorted;
}

describe('settings panel focus-index allocation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('gives every focusable control an index', async () => {
    const panel = document.createElement('div');
    panel.id = 'settings-panel';
    document.body.appendChild(panel);

    const handle = createSettingsPanel(panel, loadConfig, {});
    handle.show();
    await waitFor('.settings-tab-pane.is-active', panel);

    expect(panel.querySelectorAll('.focusable:not([data-focus-index])').length).toBe(0);
    handle.hide();
  });

  // Settings navigation keys off DOM order, so focus indices are free to
  // repeat across — and, for the photo galleries, within — panes. The lock is
  // therefore the per-pane multiset, not uniqueness: a move that shifts a
  // control's index jars this snapshot.
  it('keeps each pane\'s focus-index multiset stable', async () => {
    const panel = document.createElement('div');
    panel.id = 'settings-panel';
    document.body.appendChild(panel);

    const handle = createSettingsPanel(panel, loadConfig, {});
    handle.show();
    await waitFor('.settings-tab-pane.is-active', panel);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const panes = Array.prototype.slice.call(panel.querySelectorAll('.settings-tab-pane'));
    const allocation = panes.map((pane: Element) => ({
      tab: (pane as HTMLElement).dataset.tab,
      indices: focusIndexCounts(pane)
    }));

    const nav = panel.querySelector('.settings-nav');
    const header = panel.querySelector('.settings-header');
    const snapshot = {
      panes: allocation,
      nav: nav ? focusIndexCounts(nav) : null,
      header: header ? focusIndexCounts(header) : null
    };

    expect(snapshot).toMatchSnapshot();
    handle.hide();
  });
});
