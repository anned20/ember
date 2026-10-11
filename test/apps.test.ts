import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('../src/ts/luna.js', () => ({
  listApps: vi.fn(),
  getAppInfo: vi.fn(),
  launchApp: vi.fn(async () => 'ok'),
  launchAppViaRoot: vi.fn(async () => 'ok'),
  readFileAsDataUrl: vi.fn(async () => '')
}));

import {launchApp, listApps, getAppInfo} from '../src/ts/luna.js';
import {createAppGrid} from '../src/ts/apps.js';
import {createAllApps} from '../src/ts/all-apps.js';
import type {Config} from '../src/ts/types.js';

function makeConfig(pinnedApps: string[], numberKeyLaunch?: boolean): () => Config {
  return function (): Config {
    return {
      launcher: {
        pinnedApps: pinnedApps,
        customApps: [],
        iconSize: 'medium',
        allAppsTile: true,
        numberKeyLaunch: numberKeyLaunch
      }
    } as unknown as Config;
  };
}

function mockInstalled(ids: string[]) {
  vi.mocked(listApps).mockResolvedValue({
    apps: ids.map((id) => ({id: id, title: id}))
  });
  vi.mocked(getAppInfo).mockImplementation(async (id: string) => ({id: id, title: id}));
}

function buildGrid(pinnedApps: string[], numberKeyLaunch?: boolean) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const grid = createAppGrid(container, makeConfig(pinnedApps, numberKeyLaunch), {});
  return {container, grid};
}

beforeEach(() => {
  vi.mocked(launchApp).mockClear();
  vi.mocked(listApps).mockClear();
  document.body.innerHTML = '';
});

describe('home row numbering and badges', () => {
  it('numbers every tile in reading order and shows a badge', async () => {
    mockInstalled(['netflix', 'youtube.leanback.v4']);
    const {container, grid} = buildGrid(['netflix', 'youtube.leanback.v4']);
    await grid.refresh();

    const tiles = container.querySelectorAll<HTMLElement>('.app-tile');
    // netflix, youtube, All apps, TV Settings
    expect(tiles.length).toBe(4);
    tiles.forEach((tile, i) => {
      expect(tile.dataset.appKey).toBe(String(i + 1));
      const badge = tile.querySelector('.app-key');
      expect(badge).not.toBeNull();
      expect(badge!.textContent).toBe(String(i + 1));
    });
  });

  it('numbers only the first nine tiles', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 12; i += 1) ids.push('app' + i);
    mockInstalled(ids);
    const {container, grid} = buildGrid(ids);
    await grid.refresh();

    expect(container.querySelectorAll('.app-tile[data-app-key]').length).toBe(9);
    expect(container.querySelectorAll('.app-key').length).toBe(9);
  });
});

describe('launchByNumber', () => {
  it('opens the tile at that position', async () => {
    mockInstalled(['netflix', 'youtube.leanback.v4']);
    const {grid} = buildGrid(['netflix', 'youtube.leanback.v4']);
    await grid.refresh();

    expect(grid.launchByNumber(2)).toBe(true);
    expect(launchApp).toHaveBeenCalledWith('youtube.leanback.v4');
  });

  it('returns false for 0, out of range and missing tiles', async () => {
    mockInstalled(['netflix']);
    const {grid} = buildGrid(['netflix']);
    await grid.refresh();

    expect(grid.launchByNumber(0)).toBe(false);
    expect(grid.launchByNumber(9)).toBe(false);
    expect(launchApp).not.toHaveBeenCalled();
  });
});

describe('All apps overlay', () => {
  it('shows no number badges on its tiles', async () => {
    mockInstalled(['netflix', 'youtube.leanback.v4']);
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const allApps = createAllApps({
      mount: mount,
      focus: {focusWithin: function () {}},
      launch: function () {}
    });

    await allApps.show();

    expect(mount.querySelectorAll('.app-tile').length).toBeGreaterThan(0);
    expect(mount.querySelectorAll('.app-key').length).toBe(0);
    expect(mount.querySelectorAll('[data-app-key]').length).toBe(0);
  });
});

describe('numberKeyLaunch off', () => {
  it('numbers no tiles and does not launch by number', async () => {
    mockInstalled(['netflix', 'youtube.leanback.v4']);
    const {container, grid} = buildGrid(['netflix', 'youtube.leanback.v4'], false);
    await grid.refresh();

    expect(container.querySelectorAll('.app-tile[data-app-key]').length).toBe(0);
    expect(container.querySelectorAll('.app-key').length).toBe(0);
    expect(grid.launchByNumber(1)).toBe(false);
    expect(launchApp).not.toHaveBeenCalled();
  });
});

describe('cold-boot dock shell', () => {
  it('paints focusable tiles from memory without asking for the app list', () => {
    const {container, grid} = buildGrid(['netflix', 'youtube.leanback.v4']);

    expect(grid.renderShell()).toBe(true);
    // netflix, youtube, All apps, TV Settings
    expect(container.querySelectorAll('.app-tile.focusable').length).toBe(4);
    expect(container.querySelectorAll('.app-tile[data-app-key]').length).toBe(4);
    expect(listApps).not.toHaveBeenCalled();
  });

  it('does not repaint a shell that is already up', () => {
    const {grid} = buildGrid(['netflix']);
    expect(grid.renderShell()).toBe(true);
    expect(grid.renderShell()).toBe(false);
  });

  it('fills the shell in place, so focus is not dropped', async () => {
    mockInstalled(['netflix', 'youtube.leanback.v4']);
    const {container, grid} = buildGrid(['netflix', 'youtube.leanback.v4']);

    grid.renderShell();
    const tileBefore = container.querySelector('.app-tile[data-app-id="netflix"]');
    await grid.refresh();

    const tileAfter = container.querySelector('.app-tile[data-app-id="netflix"]');
    expect(tileAfter).toBe(tileBefore);
    expect(tileAfter!.querySelector('.app-label')!.textContent).toBe('Netflix');
  });

  it('drops a pinned app the TV no longer has, keeping numbering contiguous', async () => {
    vi.mocked(listApps).mockResolvedValue({
      apps: [{id: 'netflix', title: 'netflix'}],
      complete: true
    });
    vi.mocked(getAppInfo).mockImplementation(async (id: string) => ({id: id, title: id}));

    const {container, grid} = buildGrid(['netflix', 'gone.app']);
    grid.renderShell();
    expect(container.querySelectorAll('.app-tile').length).toBe(4);

    await grid.refresh();

    const tiles = container.querySelectorAll<HTMLElement>('.app-tile');
    expect(tiles.length).toBe(3);
    expect(Array.from(tiles).map((tile) => tile.dataset.appKey)).toEqual(['1', '2', '3']);
    expect(container.querySelector('.app-tile[data-app-id="gone.app"]')).toBeNull();
  });
});
