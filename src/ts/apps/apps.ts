import {launchApp, launchAppViaRoot, listApps} from '@luna/luna.js';
import {
  isAppInstalled,
  isCatalogComplete,
  knownAppInfo,
  loadAppCatalog,
  normalizeAppRecord,
  prefersBundledIcons,
  resolvePinnedApp,
  setIconSrc
} from './app-catalog.js';
import {getAppIdCandidates, getBuiltinAppIcon} from './app-icons.js';
import {indexInRow} from '@focus/focus-row.js';
import {BRAND} from '@lib/brand.js';
import type {AppCatalog, AppRecord, Config, CustomApp} from '@lib/types.js';

const BUNDLED_SETTINGS_ICON = 'assets/app-icons/tv-settings.png';

/** An app tile's record: an AppRecord plus the optional launch candidates. */
interface TileApp extends AppRecord {
  ids?: string[];
  custom?: boolean;
}

/**
 * Anything the dock can launch: a full AppRecord, or a bare reference with
 * just the launch candidates (e.g. a spoken app name). Only the optional
 * id fields are read.
 */
export interface LaunchableApp {
  id?: string;
  launchId?: string;
  ids?: string[];
  title?: string;
}

/** The home dock's inputs, read once per render. */
interface DockParams {
  pinned: string[];
  customApps: CustomApp[];
  customById: Record<string, CustomApp>;
  iconSize: string;
  allAppsTile: boolean;
  numberKeys: boolean;
}

/** Callbacks the home grid raises to the app shell. */
export interface AppGridOptions {
  onBeforeLaunch?: () => void;
  onOpenSettings?: () => void;
  onOpenTvSettings?: () => void;
  onOpenAllApps?: () => void;
  onToast?: (message: string) => void;
}

/** The handle returned by createAppGrid. */
export interface AppGrid {
  refresh(opts?: {reuse?: boolean}): Promise<void>;
  renderShell(): boolean;
  isLoungeApp(id: string): boolean;
  launchApp(app?: LaunchableApp | null): Promise<string>;
  launchByNumber(n: number): boolean;
}

/** An installed app as listInstalledApps reports it. */
export interface InstalledApp extends AppRecord {
  hidden: boolean;
  /** False for system apps the TV will not uninstall. */
  removable: boolean;
}

/**
 * Launch an app by trying every candidate id, sandboxed then root.
 * Prime Video is `amazon.html` on older TVs and native `amazon` on current
 * OLEDs — the first id often 404s or hangs, so we must fall through.
 */
export async function launchAppCandidates(ids?: string[] | null): Promise<string> {
  const unique: string[] = [];
  (ids || []).forEach(function (id) {
    if (id && unique.indexOf(id) < 0) unique.push(id);
  });

  for (let i = 0; i < unique.length; i += 1) {
    try {
      await launchApp(unique[i]);
      return unique[i];
    } catch (err) {
      // Missing id or sandboxed launch denied (native Prime Video).
    }
    try {
      await launchAppViaRoot(unique[i]);
      return unique[i];
    } catch (err2) {
      // Try the next candidate.
    }
  }
  return '';
}

export function createAppGrid(
  container: HTMLElement,
  getConfig: () => Config,
  options: AppGridOptions
): AppGrid {
  let catalog: AppCatalog = {};

  // Each tile's app: a late app list updates tiles in place (see
  // retryNames), which leaves the remote's focus where it is.
  const tileApps = new WeakMap<HTMLElement, TileApp>();

  function fallbackBadge(title: string): HTMLElement {
    const fallback = document.createElement('span');
    fallback.className = 'app-fallback';
    fallback.textContent = String(title || '').slice(0, 2).toUpperCase();
    return fallback;
  }

  function tileIcon(app: TileApp): HTMLElement {
    if (!app.icon) return fallbackBadge(app.title);
    const img = document.createElement('img');
    img.className = 'app-icon';
    img.alt = '';
    img.addEventListener('error', function () {
      const fallbackIcon = getBuiltinAppIcon(app.id);
      if (fallbackIcon && img.dataset.iconUrl !== fallbackIcon) {
        setIconSrc(img, fallbackIcon);
        return;
      }
      if (img.parentNode) img.parentNode.replaceChild(fallbackBadge(app.title), img);
    });
    setIconSrc(img, app.icon, {keep: true});
    return img;
  }

  function makeTile(app: TileApp, index: number): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'app-tile focusable';
    button.dataset.focusIndex = String(indexInRow('apps', index));
    button.dataset.appId = app.id;
    button.setAttribute('aria-label', app.title);

    const label = document.createElement('span');
    label.className = 'app-label';
    label.textContent = app.title;

    button.appendChild(tileIcon(app));
    button.appendChild(label);

    tileApps.set(button, app);
    button.addEventListener('click', function () {
      openApp(tileApps.get(button) || app);
    });

    return button;
  }

  function updateTile(button: HTMLElement, app: TileApp) {
    tileApps.set(button, app);
    button.setAttribute('aria-label', app.title);
    const label = button.querySelector('.app-label');
    if (label) label.textContent = app.title;
    const icon = tileIcon(app);
    const old = button.querySelector('.app-icon, .app-fallback');
    if (old) button.replaceChild(icon, old);
    else button.insertBefore(icon, label);
  }

  function makeSettingsTile(index: number, iconUrl: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'app-tile settings-tile focusable';
    button.dataset.focusIndex = String(indexInRow('apps', index));
    button.dataset.action = 'tv-settings';
    button.setAttribute('aria-label', 'TV Settings');

    const img = document.createElement('img');
    img.className = 'app-icon';
    img.alt = '';
    img.addEventListener('error', function () {
      if (img.dataset.iconUrl !== BUNDLED_SETTINGS_ICON) {
        setIconSrc(img, BUNDLED_SETTINGS_ICON);
        return;
      }
      img.remove();
      const fallback = document.createElement('span');
      fallback.className = 'app-fallback';
      fallback.textContent = '\u2699';
      button.insertBefore(fallback, label);
    });
    setIconSrc(img, iconUrl || BUNDLED_SETTINGS_ICON);
    button.appendChild(img);

    const label = document.createElement('span');
    label.className = 'app-label';
    label.textContent = 'TV Settings';
    button.appendChild(label);

    button.addEventListener('click', function () {
      if (options.onOpenTvSettings) options.onOpenTvSettings();
    });

    return button;
  }

  // All apps: opens the grid of every app on the TV (all-apps.js).
  const ALL_APPS_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor">' +
    [3, 9.5, 16].map(function (y) {
      return [3, 9.5, 16].map(function (x) {
        return '<rect x="' + x + '" y="' + y + '" width="5" height="5" rx="1.4"/>';
      }).join('');
    }).join('') + '</g></svg>';

  function makeAllAppsTile(index: number): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'app-tile all-apps-launcher focusable';
    button.dataset.focusIndex = String(indexInRow('apps', index));
    button.dataset.action = 'all-apps';
    button.setAttribute('aria-label', 'All apps');

    const icon = document.createElement('span');
    icon.className = 'app-fallback all-apps-icon';
    icon.innerHTML = ALL_APPS_ICON;
    button.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'app-label';
    label.textContent = 'All apps';
    button.appendChild(label);

    button.addEventListener('click', function () {
      if (options.onOpenAllApps) options.onOpenAllApps();
    });
    return button;
  }

  async function openApp(app?: LaunchableApp | null): Promise<string> {
    if (options.onBeforeLaunch) options.onBeforeLaunch();

    const ids: string[] = [];
    function addId(id?: string | null) {
      if (id && ids.indexOf(id) < 0) ids.push(id);
    }
    if (app && Array.isArray(app.ids)) {
      app.ids.forEach(addId);
    }
    addId(app && app.launchId);
    getAppIdCandidates((app && app.id) || '').forEach(addId);
    getAppIdCandidates((app && app.launchId) || '').forEach(addId);

    const launched = await launchAppCandidates(ids);
    if (launched) return launched;

    const label = app && app.title ? app.title : (app && app.id) || 'app';
    if (options.onToast) options.onToast('Could not launch ' + label);
    return '';
  }

  // What the current dock was built from; see refresh({reuse}).
  let builtSignature = '';
  let lastSignature = '';

  function dockParams(): DockParams {
    const config = getConfig();
    const customApps = (config.launcher && config.launcher.customApps) || [];
    const customById: Record<string, CustomApp> = {};
    customApps.forEach(function (entry) {
      if (entry && entry.id) customById[entry.id] = entry;
    });
    return {
      pinned: (config.launcher && config.launcher.pinnedApps) || [],
      customApps: customApps,
      customById: customById,
      iconSize: (config.launcher && config.launcher.iconSize) || 'medium',
      allAppsTile: !(config.launcher && config.launcher.allAppsTile === false),
      numberKeys: !(config.launcher && config.launcher.numberKeyLaunch === false)
    };
  }

  function dockSignature(p: DockParams): string {
    return JSON.stringify([p.pinned, p.customApps, p.iconSize, prefersBundledIcons(), p.allAppsTile, p.numberKeys]);
  }

  function applyScale(p: DockParams) {
    const scaleBySize: Record<string, number> = {small: 0.78, medium: 1, large: 1.28};
    container.style.setProperty('--tile-scale', String(scaleBySize[p.iconSize] || 1));
  }

  // Number the home row 1-9 in the order it reads (pinned apps, then All apps,
  // then TV Settings) so the remote's number keys open a tile by position.
  function applyNumbering(numberKeys: boolean) {
    const tiles = container.querySelectorAll<HTMLElement>('.app-tile');
    for (let i = 0; i < tiles.length; i += 1) {
      const tile = tiles[i];
      const existing = tile.querySelector('.app-key');
      if (numberKeys && i < 9) {
        const key = String(i + 1);
        tile.dataset.appKey = key;
        if (existing) existing.textContent = key;
        else {
          const badge = document.createElement('span');
          badge.className = 'app-key';
          badge.setAttribute('aria-hidden', 'true');
          badge.textContent = key;
          tile.appendChild(badge);
        }
      } else {
        delete tile.dataset.appKey;
        if (existing) existing.remove();
      }
    }
  }

  function makeCustomTile(entry: CustomApp, index: number): HTMLButtonElement {
    return makeTile({
      id: entry.launchId || entry.id,
      launchId: entry.launchId || entry.id,
      title: entry.title || entry.launchId || entry.id,
      icon: entry.icon || '',
      custom: true
    }, index);
  }

  function appendChromeTiles(tiles: HTMLElement[], p: DockParams, cat: AppCatalog) {
    let settingsIcon = '';
    if (!prefersBundledIcons()) {
      const settingsApp = cat['com.webos.app.settings'];
      settingsIcon = (settingsApp && settingsApp.icon) || '';
    }
    if (p.allAppsTile) tiles.push(makeAllAppsTile(p.pinned.length));
    tiles.push(makeSettingsTile(p.pinned.length + 1, settingsIcon));
  }

  // Tiles for the dock from remembered info only (no app list). Synchronous, so
  // a cold boot can paint focusable tiles and take input before the root
  // listApps call answers; refresh() fills the real names/icons in place.
  function buildShellTiles(p: DockParams): HTMLElement[] {
    const tiles: HTMLElement[] = [];
    for (let i = 0; i < p.pinned.length; i += 1) {
      const custom = p.customById[p.pinned[i]];
      if (custom) {
        tiles.push(makeCustomTile(custom, i));
        continue;
      }
      tiles.push(makeTile(knownAppInfo(p.pinned[i]) || {id: p.pinned[i], title: p.pinned[i], icon: ''}, i));
    }
    appendChromeTiles(tiles, p, {});
    return tiles;
  }

  function paintDock(tiles: HTMLElement[], signature: string, realList: boolean, numberKeys: boolean) {
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < tiles.length; i += 1) {
      fragment.appendChild(tiles[i]);
    }
    container.innerHTML = '';
    container.appendChild(fragment);
    applyNumbering(numberKeys);
    builtSignature = realList ? signature : '';
    lastSignature = signature;
  }

  // Paint the dock from remembered info without touching the app list. main.js
  // calls this at the very start of startup so the remote works while the
  // catalog loads; refresh() then fills the tiles in.
  function renderShell(): boolean {
    const p = dockParams();
    applyScale(p);
    const signature = dockSignature(p);
    if (signature === lastSignature && container.children.length) return false;
    paintDock(buildShellTiles(p), signature, false, p.numberKeys);
    return true;
  }

  // Built without the TV's full app list (root not answering yet, Luna late
  // after power-on): ask again a few times and fill names and icons in place.
  const NAME_RETRY_MS = [20000, 60000, 180000];
  let nameRetry: ReturnType<typeof setTimeout> | null = null;
  let nameRetries = 0;

  function scheduleNameRetry(listed: boolean) {
    if (nameRetry) clearTimeout(nameRetry);
    nameRetry = null;
    if (listed) {
      nameRetries = 0;
      return;
    }
    if (nameRetries >= NAME_RETRY_MS.length) return;
    nameRetry = setTimeout(retryNames, NAME_RETRY_MS[nameRetries]);
    nameRetries += 1;
  }

  async function retryNames() {
    nameRetry = null;
    const fresh = await loadAppCatalog();
    const listed = isCatalogComplete(fresh);
    const listedAny = Object.keys(fresh).length > 0;
    const tiles = container.querySelectorAll<HTMLElement>('.app-tile[data-app-id]');
    for (let i = 0; i < tiles.length; i += 1) {
      const current = tileApps.get(tiles[i]);
      if (!current || current.custom) continue;
      const info = await resolvePinnedApp(tiles[i].dataset.appId as string, fresh);
      if (info!.title !== current.title || info!.icon !== current.icon) updateTile(tiles[i], info!);
    }
    if (listedAny) {
      catalog = fresh;
      builtSignature = lastSignature;
    }
    scheduleNameRetry(listed);
  }

  /**
   * @param {{reuse?: boolean}} [opts] reuse: keep the current dock when its
   *   inputs are unchanged. Returning from an app used to redo every Luna
   *   lookup (app list + one getAppInfo per pinned app) and redraw the dock.
   */
  async function refresh(opts?: {reuse?: boolean}): Promise<void> {
    const p = dockParams();
    applyScale(p);
    const signature = dockSignature(p);
    if (opts && opts.reuse && signature === builtSignature && container.children.length) {
      return;
    }
    // Paint a dock from remembered info at once if one is not already up, then
    // fill it in from the TV's app list. On a cold boot renderShell() has often
    // painted it already (main.js), so this does not repaint and drop focus.
    if (signature !== lastSignature || !container.children.length) {
      paintDock(buildShellTiles(p), signature, false, p.numberKeys);
    }

    catalog = await loadAppCatalog();
    await applyCatalog(p, signature);
    scheduleNameRetry(isCatalogComplete(catalog));
  }

  // Fill the painted dock from the app list: update titles/icons in place (so
  // focus stays where the user put it), drop pinned tiles the TV no longer has,
  // and renumber. A partial list (no root) leaves every tile alone.
  async function applyCatalog(p: DockParams, signature: string): Promise<void> {
    const tiles = Array.prototype.slice.call(
      container.querySelectorAll<HTMLElement>('.app-tile[data-app-id]')) as HTMLElement[];
    for (let i = 0; i < tiles.length; i += 1) {
      const tile = tiles[i];
      const id = tile.dataset.appId as string;
      const current = tileApps.get(tile);
      if (!current || current.custom) continue;
      if (!isAppInstalled(catalog, id)) {
        tile.remove();
        continue;
      }
      const info = await resolvePinnedApp(id, catalog);
      if (info!.title !== current.title || info!.icon !== current.icon) updateTile(tile, info!);
    }
    // The Settings tile is only in the shell with the bundled icon; swap in the
    // TV's own when the user prefers it.
    if (!prefersBundledIcons()) {
      const settingsApp = catalog['com.webos.app.settings'];
      const iconUrl = (settingsApp && settingsApp.icon) || '';
      const img = container.querySelector<HTMLImageElement>('.settings-tile .app-icon');
      if (iconUrl && img) setIconSrc(img, iconUrl);
    }
    applyNumbering(p.numberKeys);
    // Only reuse a dock built from a real app list: at power-on the Luna
    // services can be late, and that first dock uses fallback titles/icons.
    builtSignature = Object.keys(catalog).length ? signature : '';
    lastSignature = signature;
  }

  return {
    refresh: refresh,
    renderShell: renderShell,
    isLoungeApp: function (id: string) {
      return id === BRAND.appId;
    },
    launchApp: openApp,
    /**
     * Open the home row tile numbered `n` (1-9), exactly as pressing Select on
     * it would. False when there is no such tile.
     */
    launchByNumber: function (n: number) {
      const config = getConfig();
      if (config.launcher && config.launcher.numberKeyLaunch === false) return false;
      const num = Number(n);
      if (!(num >= 1 && num <= 9)) return false;
      const tile = container.querySelector<HTMLElement>('.app-tile[data-app-key="' + num + '"]');
      if (!tile) return false;
      tile.click();
      return true;
    }
  };
}

export async function listInstalledApps(options?: {includeHidden?: boolean}): Promise<InstalledApp[]> {
  const includeHidden = !!(options && options.includeHidden);
  try {
    const res = await listApps();
    return (res.apps || [])
      .filter(function (app) {
        const id = (app && (app.id || app.appId)) || '';
        if (includeHidden) return true;
        const record = (app && app.appInfo) || app || {};
        return record.visible !== false;
      })
      .map(function (app) {
        // hidden: a system or background app LG keeps off its own home screen.
        const record = (app && app.appInfo) || app || {};
        return Object.assign(normalizeAppRecord(app, app && app.id), {
          hidden: record.visible === false,
          removable: record.removable !== false
        });
      });
  } catch (err) {
    return [];
  }
}