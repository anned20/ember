import {beforeEach, afterEach, describe, expect, it, vi} from 'vitest';

vi.mock('@apps/apps.js', () => ({
  listInstalledApps: vi.fn(async () => [])
}));

vi.mock('@apps/app-catalog.js', () => ({
  loadAppCatalog: vi.fn(async () => ({})),
  resolvePinnedApp: vi.fn(async (id: string) => ({id: id, launchId: id, title: id, icon: ''})),
  isAppInstalled: vi.fn(() => true),
  rememberApps: vi.fn(),
  setIconSrc: vi.fn(),
  lazyLoadIcon: vi.fn()
}));

vi.mock('@apps/lg-home.js', () => ({
  lgHomeAppsToAdd: vi.fn(() => [])
}));

vi.mock('@luna/luna.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@luna/luna.js')>();
  return Object.assign({}, actual, {
    listLaunchPoints: vi.fn(async () => [])
  });
});

import {createAppsPane} from '@settings/panes/apps.js';
import {createBinder} from '@settings/settings-binding.js';
import {listInstalledApps} from '@apps/apps.js';
import {isAppInstalled, loadAppCatalog, resolvePinnedApp} from '@apps/app-catalog.js';
import {lgHomeAppsToAdd} from '@apps/lg-home.js';
import {listLaunchPoints} from '@luna/luna.js';
import {setLanguage} from '@lib/i18n.js';
import type {PaneHandle, SettingsAppsState, SettingsContext} from '@settings/pane.js';
import type {AppCatalog, Config} from '@lib/types.js';

function makeConfig(): Config {
  return {
    launcher: {
      pinnedApps: ['com.netflix.ninja', 'org.webosbrew.custom', 'com.unknown.app'],
      customApps: [{
        id: 'org.webosbrew.custom',
        launchId: 'org.webosbrew.custom',
        title: 'Custom App',
        icon: 'assets/icons/custom.png'
      }]
    }
  } as unknown as Config;
}

function makeAppsState(): SettingsAppsState {
  return {pinnedOrder: [], customApps: [], appsByIdMap: {}, installedCatalog: null};
}

function buildApps(
  config: Config = makeConfig()
): {pane: HTMLElement; ctx: SettingsContext; handle: PaneHandle; refocusListButton: ReturnType<typeof vi.fn>} {
  const pane = document.createElement('div');
  const refocusListButton = vi.fn();
  const ctx: SettingsContext = {
    config: config,
    rawConfig: config,
    binder: createBinder(config),
    panes: {apps: pane},
    options: {},
    apps: makeAppsState(),
    isVisible: function () { return true; },
    focusControl: function () {},
    focusNow: function () { return true; },
    focusInPanel: function () { return true; },
    focusGallery: function () {},
    refocusListButton: refocusListButton,
    withDeadline: function <T>(promise: Promise<T>) { return Promise.resolve(promise); },
    redraw: function () {}
  };
  const handle = createAppsPane();
  handle.build(ctx);
  return {pane: pane, ctx: ctx, handle: handle, refocusListButton: refocusListButton};
}

async function waitFor(check: () => boolean, ms = 1000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (check()) return;
    await new Promise(function (resolve) { setTimeout(resolve, 10); });
  }
  throw new Error('waitFor timed out');
}

function pinnedRows(pane: HTMLElement): NodeListOf<HTMLElement> {
  return pane.querySelectorAll('.settings-pinned-row');
}

function addRows(pane: HTMLElement): NodeListOf<HTMLElement> {
  return pane.querySelectorAll('.settings-app-row');
}

describe('apps pane', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    setLanguage('en');
    vi.mocked(isAppInstalled).mockReset();
    vi.mocked(isAppInstalled).mockReturnValue(true);
    vi.mocked(loadAppCatalog).mockReset();
    vi.mocked(loadAppCatalog).mockResolvedValue({});
    vi.mocked(listInstalledApps).mockReset();
    vi.mocked(listInstalledApps).mockResolvedValue([]);
    vi.mocked(resolvePinnedApp).mockReset();
    vi.mocked(resolvePinnedApp).mockImplementation(async (id) => ({id: id, launchId: id, title: id, icon: ''}));
    vi.mocked(lgHomeAppsToAdd).mockReset();
    vi.mocked(lgHomeAppsToAdd).mockReturnValue([]);
    vi.mocked(listLaunchPoints).mockReset();
    vi.mocked(listLaunchPoints).mockResolvedValue([]);
  });

  afterEach(() => setLanguage('en'));

  it('builds the pinned, custom and discover controls and seeds the shared state', () => {
    const {pane, ctx} = buildApps();

    // The pinned order and custom apps move onto the context from the config.
    expect(ctx.apps.pinnedOrder).toEqual(['com.netflix.ninja', 'org.webosbrew.custom', 'com.unknown.app']);
    expect(ctx.apps.customApps).toHaveLength(1);
    expect(ctx.apps.customApps[0].launchId).toBe('org.webosbrew.custom');
    // The seed is a copy, not the config's own array.
    ctx.apps.pinnedOrder.push('x');
    expect(makeConfig().launcher.pinnedApps).toEqual(['com.netflix.ninja', 'org.webosbrew.custom', 'com.unknown.app']);

    expect((pane.querySelector('[data-focus-index="1190"]') as HTMLElement)).not.toBeNull();
    expect((pane.querySelector('[data-focus-index="1191"]') as HTMLElement)).not.toBeNull();
    expect((pane.querySelector('[data-focus-index="1299"]') as HTMLElement)).not.toBeNull();
    expect((pane.querySelector('[data-focus-index="1280"]') as HTMLElement)).not.toBeNull();
    expect((pane.querySelector('[data-focus-index="1400"]') as HTMLElement)).not.toBeNull();
    expect((pane.querySelector('[data-focus-index="1403"]') as HTMLElement)).not.toBeNull();
    expect((pane.querySelector('[data-focus-index="1500"]') as HTMLElement)).not.toBeNull();
    expect((pane.querySelector('[data-focus-index="1501"]') as HTMLElement)).not.toBeNull();
  });

  it('loads the catalog and draws the pinned and add lists', async () => {
    vi.mocked(loadAppCatalog).mockResolvedValue({
      'com.netflix.ninja': {id: 'com.netflix.ninja', title: 'Netflix', icon: 'assets/netflix.png'}
    } as unknown as AppCatalog);
    vi.mocked(listInstalledApps).mockResolvedValue([
      {id: 'com.netflix.ninja', title: 'Netflix', icon: 'assets/netflix.png', hidden: false},
      {id: 'com.other.app', title: 'Other', icon: 'assets/other.png', hidden: false}
    ] as unknown as Awaited<ReturnType<typeof listInstalledApps>>);

    const {pane, ctx, handle} = buildApps();
    await handle.load!(ctx);

    expect(pinnedRows(pane)).toHaveLength(3);
    expect(pane.querySelectorAll('.settings-pinned-title')[0].textContent).toBe('Netflix');
    // The pinned app the catalog doesn't list is resolved (and shown).
    expect(resolvePinnedApp).toHaveBeenCalledWith('com.unknown.app', expect.anything());
    // 'com.other.app' is not pinned and not a custom launch id: offered to add.
    expect(addRows(pane)).toHaveLength(1);
    expect((pane.querySelector('[data-focus-index="1299"]') as HTMLElement).textContent)
      .toBe('Show installed apps (1)');
  });

  it('reorders and removes pinned apps, then writes them through the Save hook', () => {
    const {pane, ctx, handle} = buildApps();
    return handle.load!(ctx).then(function () {
      // Move the custom app (row 2) up: click its ↑.
      (pane.querySelector('[data-focus-index="1203"]') as HTMLElement).click();
      expect(ctx.apps.pinnedOrder).toEqual(['org.webosbrew.custom', 'com.netflix.ninja', 'com.unknown.app']);

      // Remove the first row: the custom app leaves both lists.
      (pane.querySelector('[data-focus-index="1202"]') as HTMLElement).click();
      expect(ctx.apps.pinnedOrder).toEqual(['com.netflix.ninja', 'com.unknown.app']);
      expect(ctx.apps.customApps).toHaveLength(0);

      ctx.binder.collect(ctx.rawConfig);
      expect(ctx.rawConfig.launcher.pinnedApps).toEqual(['com.netflix.ninja', 'com.unknown.app']);
      expect(ctx.rawConfig.launcher.customApps).toEqual([]);
    });
  });

  it('adds a custom app and pins it', () => {
    const {pane, ctx} = buildApps();

    (pane.querySelector('[data-focus-index="1400"]') as HTMLInputElement).value = 'com.foo.bar';
    (pane.querySelector('[data-focus-index="1403"]') as HTMLElement).click();

    expect(ctx.apps.customApps).toHaveLength(2);
    const added = ctx.apps.customApps.filter(function (entry) { return entry.launchId === 'com.foo.bar'; })[0];
    expect(added).toBeTruthy();
    expect(added.title).toBe('com.foo.bar');
    expect(ctx.apps.pinnedOrder).toContain(added.id);
  });

  it('imports every app from LG\u2019s home screen after the pinned ones', async () => {
    vi.mocked(listLaunchPoints).mockResolvedValue([{id: 'com.lg.one'}]);
    vi.mocked(lgHomeAppsToAdd).mockReturnValue(['com.lg.one']);

    const {pane, ctx} = buildApps();
    (pane.querySelector('[data-focus-index="1298"]') as HTMLElement).click();

    await waitFor(function () { return ctx.apps.pinnedOrder.indexOf('com.lg.one') >= 0; });
    expect(ctx.apps.pinnedOrder).toEqual(
      ['com.netflix.ninja', 'org.webosbrew.custom', 'com.unknown.app', 'com.lg.one']);
    expect(pane.textContent).toContain('Added 1 app from LG\u2019s home screen');
  });

  it('scans for apps and pins one from the Discover list', async () => {
    vi.mocked(listInstalledApps).mockResolvedValue([
      {id: 'com.a', title: 'Alpha', icon: 'assets/a.png', hidden: false},
      {id: 'com.b', title: 'Beta', icon: 'assets/b.png', hidden: false}
    ] as unknown as Awaited<ReturnType<typeof listInstalledApps>>);

    const {pane, ctx} = buildApps();
    (pane.querySelector('[data-focus-index="1500"]') as HTMLElement).click();

    await waitFor(function () { return pane.querySelectorAll('.settings-apps .settings-app-row').length === 2; });

    (pane.querySelector('[data-focus-index="1510"]') as HTMLElement).click();
    expect(ctx.apps.pinnedOrder).toContain('com.a');
  });

  it('reads the sections, notes and counts in Dutch, keeping app titles as they are', async () => {
    setLanguage('nl');
    vi.mocked(loadAppCatalog).mockResolvedValue({
      'com.netflix.ninja': {id: 'com.netflix.ninja', title: 'Netflix', icon: 'assets/netflix.png'}
    } as unknown as AppCatalog);
    vi.mocked(listInstalledApps).mockResolvedValue([
      {id: 'com.netflix.ninja', title: 'Netflix', icon: 'assets/netflix.png', hidden: false},
      {id: 'com.other.app', title: 'Other', icon: 'assets/other.png', hidden: false}
    ] as unknown as Awaited<ReturnType<typeof listInstalledApps>>);
    vi.mocked(isAppInstalled).mockReturnValue(false);

    const {pane, ctx, handle} = buildApps();
    await handle.load!(ctx);

    const headings = Array.from(pane.querySelectorAll('.settings-section > h3'))
      .map(function (heading) { return heading.textContent; });
    expect(headings).toEqual(['Vastgezette apps', 'Eigen app', 'Apps ontdekken']);
    expect(pane.textContent).toContain('Een app toevoegen');
    expect(pane.textContent).toContain('Alle-apps-tegel op de home-rij');
    expect(pane.textContent).toContain('Cijfertoetsen openen tegels op de home-rij');
    expect(pane.textContent).toContain('Verborgen en systeem-apps tonen');
    expect(pane.textContent).toContain('Alle apps van het homescreen van LG toevoegen');
    expect(pane.textContent).toContain('Vind het App ID op je tv');

    // The TV's title stays; only the note we add to it is Dutch.
    const titles = Array.from(pane.querySelectorAll('.settings-pinned-title'))
      .map(function (title) { return title.textContent; });
    expect(titles[0]).toBe('Netflix — niet geïnstalleerd op deze tv');
    expect(titles[1]).toBe('Custom App');

    expect((pane.querySelector('[data-focus-index="1299"]') as HTMLElement).textContent)
      .toBe('Geïnstalleerde apps tonen (1)');

    // Discover reports its count through the counted pair.
    (pane.querySelector('[data-focus-index="1500"]') as HTMLElement).click();
    await waitFor(function () { return pane.textContent!.indexOf('apps gevonden') >= 0; });
    expect(pane.textContent).toContain('2 apps gevonden.');
  });

  it('reports the LG import in Dutch', async () => {
    setLanguage('nl');
    vi.mocked(listLaunchPoints).mockResolvedValue([{id: 'com.lg.one'}]);
    vi.mocked(lgHomeAppsToAdd).mockReturnValue(['com.lg.one']);

    const {pane, ctx} = buildApps();
    (pane.querySelector('[data-focus-index="1298"]') as HTMLElement).click();

    await waitFor(function () { return ctx.apps.pinnedOrder.indexOf('com.lg.one') >= 0; });
    expect(pane.textContent).toContain('1 app van het homescreen van LG toegevoegd');
  });
});
