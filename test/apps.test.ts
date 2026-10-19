import {beforeEach, afterEach, describe, expect, it, vi} from 'vitest';

vi.mock('@luna/luna.js', () => ({
  listApps: vi.fn(),
  getAppInfo: vi.fn(),
  launchApp: vi.fn(async () => 'ok'),
  launchAppViaRoot: vi.fn(async () => 'ok'),
  readFileAsDataUrl: vi.fn(async () => '')
}));

import {launchApp, launchAppViaRoot, listApps, getAppInfo} from '@luna/luna.js';
import {createAppGrid} from '@apps/apps.js';
import {createAllApps} from '@apps/all-apps.js';
import {setLanguage, t} from '@lib/i18n.js';
import type {Config} from '@lib/types.js';

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

describe('All apps context menu', () => {
  function buildMenu(opts: Partial<Parameters<typeof createAllApps>[0]>) {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const focus = {focusWithin: vi.fn(), focusElement: vi.fn(() => true)};
    const allApps = createAllApps(Object.assign({mount, focus, launch: vi.fn()}, opts));
    return {mount, allApps};
  }

  function openOnFirst(mount: HTMLElement, allApps: ReturnType<typeof createAllApps>) {
    allApps.openMenu(mount.querySelector<HTMLElement>('.all-apps-tile')!);
  }

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('opens the menu on a long press, naming the app and offering the actions', async () => {
    vi.mocked(listApps).mockResolvedValue({apps: [{id: 'demo.app', title: 'Demo'}]});
    const {mount, allApps} = buildMenu({isPinned: () => false});
    await allApps.show();

    openOnFirst(mount, allApps);

    expect(mount.querySelector('.all-apps-menu')).not.toBeNull();
    expect(mount.querySelector('.all-apps-menu-head h3')!.textContent).toBe('Demo');
    expect(mount.querySelector('.all-apps-menu-id')!.textContent).toBe('demo.app');
    expect(mount.querySelector('.all-apps-menu-state')!.textContent).toBe('Not on the home row');
    expect(mount.querySelector('[data-action="pin"]')).not.toBeNull();
    expect(mount.querySelector('[data-action="restart"]')).not.toBeNull();
    expect(mount.querySelector('[data-action="delete"]')).not.toBeNull();
  });

  it('shows Unpin for a pinned app and calls the unpin callback', async () => {
    vi.mocked(listApps).mockResolvedValue({apps: [{id: 'demo.app', title: 'Demo'}]});
    const unpin = vi.fn<(app: {id: string}) => void>();
    const {mount, allApps} = buildMenu({isPinned: () => true, unpin});
    await allApps.show();

    openOnFirst(mount, allApps);
    expect(mount.querySelector('[data-action="unpin"]')!.textContent).toBe('Unpin');
    (mount.querySelector('[data-action="unpin"]') as HTMLElement).click();

    expect(unpin).toHaveBeenCalledTimes(1);
    expect(unpin.mock.calls[0][0].id).toBe('demo.app');
    expect(mount.querySelector('.all-apps-menu')).toBeNull();
  });

  it('hides Delete for a non-removable app', async () => {
    vi.mocked(listApps).mockResolvedValue({
      apps: [{id: 'com.webos.app.browser', title: 'Browser', removable: false}]
    });
    const {mount, allApps} = buildMenu({isPinned: () => false});
    await allApps.show();

    openOnFirst(mount, allApps);
    expect(mount.querySelector('[data-action="delete"]')).toBeNull();
    expect(mount.querySelector('[data-action="restart"]')).not.toBeNull();
  });

  it('asks before deleting, then removes the app and drops its tile', async () => {
    vi.mocked(listApps).mockResolvedValue({
      apps: [{id: 'a.app', title: 'Alpha'}, {id: 'b.app', title: 'Beta'}]
    });
    const remove = vi.fn<(app: {id: string}) => Promise<void>>(async () => {});
    const {mount, allApps} = buildMenu({isPinned: () => false, remove});
    await allApps.show();

    openOnFirst(mount, allApps);
    (mount.querySelector('[data-action="delete"]') as HTMLElement).click();
    expect(remove).not.toHaveBeenCalled();
    expect(mount.querySelector('[data-action="delete-confirm"]')).not.toBeNull();

    (mount.querySelector('[data-action="delete-confirm"]') as HTMLElement).click();
    await flush();

    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls[0][0].id).toBe('a.app');
    expect(mount.querySelectorAll('.all-apps-tile').length).toBe(1);
    expect(mount.querySelector('.all-apps-menu')).toBeNull();
  });

  it('keeps the confirm up and toasts when a delete fails', async () => {
    vi.mocked(listApps).mockResolvedValue({apps: [{id: 'demo.app', title: 'Demo'}]});
    const onToast = vi.fn();
    const remove = vi.fn<(app: {id: string}) => Promise<void>>(async () => { throw new Error('needs root'); });
    const {mount, allApps} = buildMenu({isPinned: () => false, remove, onToast});
    await allApps.show();

    openOnFirst(mount, allApps);
    (mount.querySelector('[data-action="delete"]') as HTMLElement).click();
    (mount.querySelector('[data-action="delete-confirm"]') as HTMLElement).click();
    await flush();

    expect(onToast).toHaveBeenCalledWith('needs root');
    expect(mount.querySelector('[data-action="delete-confirm"]')).not.toBeNull();
  });

  it('unwinds the confirm, then the menu, on Back', async () => {
    vi.mocked(listApps).mockResolvedValue({apps: [{id: 'demo.app', title: 'Demo'}]});
    const {mount, allApps} = buildMenu({isPinned: () => false});
    await allApps.show();

    openOnFirst(mount, allApps);
    (mount.querySelector('[data-action="delete"]') as HTMLElement).click();

    expect(allApps.handleBack()).toBe(true); // confirm -> menu
    expect(mount.querySelector('[data-action="pin"]')).not.toBeNull();
    expect(allApps.handleBack()).toBe(true); // menu -> closed
    expect(mount.querySelector('.all-apps-menu')).toBeNull();
    expect(allApps.handleBack()).toBe(false);
  });
});

describe('the dock and All apps in Dutch', () => {
  beforeEach(() => setLanguage('nl'));
  afterEach(() => setLanguage('en'));

  it('labels the All apps and TV Settings tiles in Dutch', async () => {
    mockInstalled(['netflix']);
    const {container, grid} = buildGrid(['netflix']);
    await grid.refresh();

    const labels = Array.from(container.querySelectorAll('.app-label'))
      .map(function (label) { return label.textContent; });
    // The app's own title is the TV's, not ours.
    expect(labels).toEqual(['Netflix', t('apps.allApps'), t('apps.tvSettings')]);
    expect(container.querySelector('.all-apps-launcher')!.getAttribute('aria-label')).toBe(t('apps.allApps'));
    expect(container.querySelector('.settings-tile')!.getAttribute('aria-label')).toBe(t('apps.tvSettings'));
  });

  it('reads the overlay, its note and its menu in Dutch', async () => {
    vi.mocked(listApps).mockResolvedValue({apps: [{id: 'demo.app', title: 'Demo'}]});
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const allApps = createAllApps({
      mount: mount,
      focus: {focusWithin: vi.fn(), focusElement: vi.fn(() => true)},
      launch: vi.fn(),
      isPinned: () => false
    });
    await allApps.show();

    expect(mount.querySelector('.all-apps-head h2')!.textContent).toBe(t('apps.allApps'));
    expect(mount.querySelector('.all-apps-hint')!.textContent).toBe(t('apps.hint'));

    allApps.openMenu(mount.querySelector<HTMLElement>('.all-apps-tile')!);

    expect(mount.querySelector('.all-apps-menu-head h3')!.textContent).toBe('Demo');
    expect(mount.querySelector('.all-apps-menu-state')!.textContent).toBe(t('apps.menu.offHome'));
    expect(mount.querySelector('[data-action="pin"]')!.textContent).toBe(t('apps.menu.pin'));
    expect(mount.querySelector('[data-action="restart"]')!.textContent).toBe(t('apps.menu.restart'));

    (mount.querySelector('[data-action="delete"]') as HTMLElement).click();
    expect(mount.querySelector('.all-apps-menu-question')!.textContent)
      .toBe(t('apps.menu.deleteConfirm', {title: 'Demo'}));
    expect(mount.querySelector('[data-action="delete-confirm"]')!.textContent).toBe(t('apps.menu.delete'));
    expect(mount.querySelector('[data-action="cancel"]')!.textContent).toBe(t('apps.menu.cancel'));
  });

  it('reads the empty note in Dutch', async () => {
    vi.mocked(listApps).mockResolvedValue({apps: []});
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const allApps = createAllApps({
      mount: mount,
      focus: {focusWithin: vi.fn()},
      launch: vi.fn()
    });
    await allApps.show();

    expect(mount.querySelector('.all-apps-note')!.textContent)
      .toBe(t('apps.readFailed'));
  });

  it('toasts a delete that gives no reason in Dutch', async () => {    vi.mocked(listApps).mockResolvedValue({apps: [{id: 'demo.app', title: 'Demo'}]});
    const onToast = vi.fn();
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const allApps = createAllApps({
      mount: mount,
      focus: {focusWithin: vi.fn(), focusElement: vi.fn(() => true)},
      launch: vi.fn(),
      isPinned: function () { return false; },
      remove: vi.fn(async () => { throw new Error(''); }),
      onToast: onToast
    });
    await allApps.show();

    allApps.openMenu(mount.querySelector<HTMLElement>('.all-apps-tile')!);
    (mount.querySelector('[data-action="delete"]') as HTMLElement).click();
    (mount.querySelector('[data-action="delete-confirm"]') as HTMLElement).click();
    await new Promise(function (resolve) { setTimeout(resolve, 0); });

    expect(onToast).toHaveBeenCalledWith(t('apps.deleteFailed', {app: 'Demo'}));
  });

  it('toasts a launch that fails in Dutch', async () => {
    mockInstalled(['netflix']);
    vi.mocked(launchApp).mockRejectedValue(new Error('app is not running') as never);
    vi.mocked(launchAppViaRoot).mockRejectedValue(new Error('no root') as never);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const toasts: string[] = [];
    const grid = createAppGrid(container, makeConfig(['netflix']), {
      onToast: function (message: string) { toasts.push(message); }
    });
    await grid.refresh();

    grid.launchByNumber(1);
    await new Promise(function (resolve) { setTimeout(resolve, 0); });
    await new Promise(function (resolve) { setTimeout(resolve, 0); });

    expect(toasts).toEqual([t('apps.launchFailed', {app: 'Netflix'})]);
  });
});
