import {getAppInfo, listApps, readFileAsDataUrl} from './luna.js';
import {getAppIdCandidates, getBuiltinAppIcon, getBuiltinAppTitle} from './app-icons.js';
import {withAssetVersion} from './compat.js';
import {APP_VERSION} from './version.js';
import type {AppCatalog, AppRecord, LunaResponse} from './types.js';

/** A remembered app title/icon pair in localStorage. */
interface RememberedApp {
  t: string;
  i: string;
}

/** An icon kept as a data URI in localStorage. */
interface KeptIcon {
  d: string;
  at?: number;
}

/** The app fields an icon can be resolved from (TV app records are untyped). */
type RawApp = Record<string, any>;

// Cache of resolved native icons (file:// path -> data URI) so repeated
// renders don't re-read the same file over the root bus. Failures aren't
// cached: root may answer next time.
const nativeIconCache = new Map<string, string>();

// What the TV said about each app (title, icon), kept across restarts. When
// the TV can't be asked (root through Homebrew Channel not answering, Luna
// late after power-on) a tile keeps its real name and icon instead of a name
// made from its id and two letters.
const APP_MEMORY_KEY = 'lounge.apps.v1';
// Home row icons the TV has (read as root), kept as images: they show without
// root, and without a root file read per icon at every start. Capped, since
// this shares the page's storage with the settings.
const ICON_MEMORY_KEY = 'lounge.appIcons.v1';
const ICON_MEMORY_MAX = 400000; // characters, all kept icons
const ICON_MAX = 60000; // characters, one icon
const ICON_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;

function readStored<T extends Record<string, unknown>>(key: string): T {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '{}');
    return value && typeof value === 'object' ? value as T : {} as T;
  } catch (err) {
    return {} as T;
  }
}

let appMemory: Record<string, RememberedApp> | null = null;
let iconMemory: Record<string, KeptIcon> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const unsaved: Record<string, boolean> = {};

function appMemoryAll(): Record<string, RememberedApp> {
  if (!appMemory) appMemory = readStored<Record<string, RememberedApp>>(APP_MEMORY_KEY);
  return appMemory;
}

function iconMemoryAll(): Record<string, KeptIcon> {
  if (!iconMemory) iconMemory = readStored<Record<string, KeptIcon>>(ICON_MEMORY_KEY);
  return iconMemory;
}

// One write for a burst of changes (a catalog load remembers every app).
function saveSoon(key: string) {
  unsaved[key] = true;
  if (saveTimer) return;
  saveTimer = setTimeout(function () {
    saveTimer = null;
    if (unsaved[APP_MEMORY_KEY]) {
      unsaved[APP_MEMORY_KEY] = false;
      try {
        localStorage.setItem(APP_MEMORY_KEY, JSON.stringify(appMemoryAll()));
      } catch (err) { /* storage full: names are asked for again next time */ }
    }
    if (unsaved[ICON_MEMORY_KEY]) {
      unsaved[ICON_MEMORY_KEY] = false;
      try {
        localStorage.setItem(ICON_MEMORY_KEY, JSON.stringify(iconMemoryAll()));
      } catch (err) {
        // Never crowd out the settings: drop the kept icons instead.
        iconMemory = {};
        try { localStorage.removeItem(ICON_MEMORY_KEY); } catch (err2) { /* ignore */ }
      }
    }
  }, 1500);
}

function rememberApp(id: string, title: string, icon: string) {
  if (!id || !title) return;
  const all = appMemoryAll();
  const known = all[id];
  const next = {t: String(title), i: icon || (known && known.i) || ''};
  if (known && known.t === next.t && known.i === next.i) return;
  all[id] = next;
  saveSoon(APP_MEMORY_KEY);
}

/** Remember the titles and icons in TV app records (e.g. LG's launch points). */
export function rememberApps(records?: unknown[] | null) {
  (records || []).forEach(function (record) {
    if (record) normalizeAppRecord(record);
  });
}

function knownApp(id: string): RememberedApp | null {
  const all = appMemoryAll();
  const ids = getAppIdCandidates(id);
  for (let i = 0; i < ids.length; i += 1) {
    if (all[ids[i]]) return all[ids[i]];
  }
  return null;
}

function keptIcon(path: string): KeptIcon | null {
  const kept = iconMemoryAll()[path];
  return kept && kept.d ? kept : null;
}

function keepIcon(path: string, dataUrl: string) {
  if (!dataUrl || dataUrl.length > ICON_MAX) return;
  const all = iconMemoryAll();
  all[path] = {d: dataUrl, at: Date.now()};
  // Oldest out first until under the cap.
  const paths = Object.keys(all).sort(function (a, b) {
    return (all[a].at || 0) - (all[b].at || 0);
  });
  let total = paths.reduce(function (n, p) { return n + (all[p].d || '').length; }, 0);
  while (total > ICON_MEMORY_MAX && paths.length > 1) {
    const oldest = paths.shift() as string;
    total -= (all[oldest].d || '').length;
    delete all[oldest];
  }
  saveSoon(ICON_MEMORY_KEY);
}

/**
 * Point an <img> at an app icon. Bundled/remote icons are set directly; native
 * icons (file:// paths outside the sandbox) are read as root and inlined as a
 * data URI, because WAM blocks direct file:// <img> loads. On failure the
 * original value is set so the element's own error/fallback handler still runs.
 * opts.keep: also keep the image across restarts (home row tiles).
 */
export function setIconSrc(imgEl: HTMLImageElement, iconUrl: string, opts?: {keep?: boolean}) {
  if (!imgEl || !iconUrl) return;
  // The icon as asked for (error handlers compare against this; .src is the
  // resolved, versioned URL).
  imgEl.dataset.iconUrl = iconUrl;
  if (iconUrl.indexOf('file://') !== 0) {
    // Bundled icons get ?v=<version>: WAM caches by URL, so a changed PNG
    // would otherwise keep showing the old image after an update.
    imgEl.src = withAssetVersion(iconUrl, APP_VERSION);
    return;
  }
  if (nativeIconCache.has(iconUrl)) {
    imgEl.src = nativeIconCache.get(iconUrl) as string;
    return;
  }
  const kept = keptIcon(iconUrl);
  if (kept) {
    nativeIconCache.set(iconUrl, kept.d);
    imgEl.src = kept.d;
    // A week-old copy is read again in the background, in case the icon changed.
    if (Date.now() - (kept.at || 0) < ICON_RECHECK_MS) return;
  }
  readFileAsDataUrl(iconUrl).then(function (dataUrl) {
    if (!dataUrl) {
      if (!kept) imgEl.src = iconUrl;
      return;
    }
    nativeIconCache.set(iconUrl, dataUrl);
    if ((opts && opts.keep) || kept) keepIcon(iconUrl, dataUrl);
    if (!kept || kept.d !== dataUrl) imgEl.src = dataUrl;
  }).catch(function () {
    if (!kept) imgEl.src = iconUrl;
  });
}

/**
 * Like setIconSrc, but defers reading native icons until the <img> scrolls into
 * view. This avoids firing a root file read for every row in a long list up
 * front (which stalls low-spec TVs and can leave icons blank), and reloads them
 * reliably as the user scrolls. Falls back to eager loading when
 * IntersectionObserver is unavailable or the icon is already cached/non-native.
 */
export function lazyLoadIcon(imgEl: HTMLImageElement, iconUrl: string, scrollRoot?: Element | null) {
  if (!imgEl || !iconUrl) return;
  const isNative = iconUrl.indexOf('file://') === 0;
  if (!isNative || nativeIconCache.has(iconUrl) || keptIcon(iconUrl) ||
      typeof IntersectionObserver === 'undefined') {
    setIconSrc(imgEl, iconUrl);
    return;
  }
  const observer = new IntersectionObserver(function (entries) {
    for (let i = 0; i < entries.length; i += 1) {
      if (entries[i].isIntersecting) {
        observer.disconnect();
        setIconSrc(imgEl, iconUrl);
        return;
      }
    }
  }, {root: scrollRoot || null, rootMargin: '160px'});
  observer.observe(imgEl);
}

const APP_INSTALL_ROOTS = [
  '/media/cryptofs/apps/usr/palm/applications',
  '/usr/palm/applications',
  '/media/developer/apps/usr/palm/applications'
];

// Words that don't say which app it is ("com.webos.app.discovery").
const GENERIC_ID_WORDS = /^(app|apps|tv|webos|lge|lg|web)$/i;

/**
 * A name from an app id, for when the TV can't be asked. Reverse-domain ids
 * lose the domain: "org.webosbrew.custom-screensaver" is "Custom
 * Screensaver", where every Homebrew app used to read "Org Webosbrew …".
 */
export function humanizeAppId(id?: string | null): string {
  if (!id) return 'App';

  let parts = String(id).split('.');
  if (parts.length >= 3 && /^(com|org|net|io|tv|de|uk|co|me|fr|jp|kr|app|dev)$/i.test(parts[0])) {
    parts = parts.slice(2);
  }
  const words = parts.join(' ')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ');
  while (words.length > 1 && GENERIC_ID_WORDS.test(words[0])) words.shift();

  return words
    .map(function (word) {
      if (!word) return '';
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ') || 'App';
}

function joinInstallPath(base: string, relative: string) {
  return base.replace(/\/$/, '') + '/' + String(relative || '').replace(/^\//, '');
}

function toFileUrl(path: string) {
  if (!path) return '';
  if (path.indexOf('file://') === 0) return path;
  if (path.charAt(0) === '/') return 'file://' + path;
  return path;
}

function isResolvedIcon(icon: string) {
  if (!icon) return false;
  return /^https?:\/\//i.test(icon) || icon.indexOf('file://') === 0 || icon.charAt(0) === '/';
}

export function pickBestIcon(...icons: Array<string | null | undefined>): string {
  const absolute: string[] = [];
  const relative: string[] = [];

  for (let i = 0; i < icons.length; i += 1) {
    const icon = icons[i];
    if (!icon) continue;
    if (isResolvedIcon(icon)) absolute.push(icon);
    else relative.push(icon);
  }

  if (absolute.length) return toFileUrl(absolute[0]);
  if (relative.length) return relative[0];
  return '';
}

export function resolveAppIcon(app: RawApp): string {
  const raw = app.largeIcon || app.icon || app.miniicon || app.mediumIcon || '';
  if (!raw) return '';

  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.indexOf('file://') === 0) return raw;
  if (raw.indexOf('//') === 0) return 'https:' + raw;
  if (raw.charAt(0) === '/') return 'file://' + raw;

  const base = app.folderPath || app.installPath || app.appPath || '';
  if (base) return toFileUrl(joinInstallPath(base, raw));

  if (app.id) {
    // listLaunchPoints often has only a filename; try common install roots.
    for (let i = 0; i < APP_INSTALL_ROOTS.length; i += 1) {
      return toFileUrl(joinInstallPath(joinInstallPath(APP_INSTALL_ROOTS[i], app.id), raw));
    }
  }

  return raw;
}

// Settings → "Use Launch Home app icons". When off, the TV's own icon wins and
// the bundled one is only a fallback for apps that don't report an icon.
let preferBundledIcons = true;

export function setPreferBundledIcons(on: boolean) {
  preferBundledIcons = on !== false;
}

export function prefersBundledIcons() {
  return preferBundledIcons;
}

function applyBuiltinOverrides(record: AppRecord): AppRecord {
  const builtinIcon = getBuiltinAppIcon(record.id);
  const builtinTitle = getBuiltinAppTitle(record.id);

  return {
    id: record.id,
    launchId: record.launchId || record.id,
    title: builtinTitle || record.title,
    icon: preferBundledIcons
      ? (builtinIcon || record.icon)
      : (record.icon || builtinIcon)
  };
}

export function normalizeAppRecord(raw: unknown, fallbackId?: string): AppRecord {
  const rawObj = raw as RawApp | null | undefined;
  const app = ((rawObj && rawObj.appInfo) || rawObj || {}) as RawApp;
  const id = app.id || (rawObj && rawObj.appId) || fallbackId || '';
  const title = app.title || app.displayName || '';
  const icon = resolveAppIcon(app);
  if (title) rememberApp(id, title, icon);
  const known = title && icon ? null : knownApp(id);

  return applyBuiltinOverrides({
    id: id,
    title: title || (known && known.t) || humanizeAppId(id),
    icon: icon || (known && known.i) || ''
  });
}

// Catalogs built from the full installed-apps list (read as root). Only these
// can say an app is not installed; a partial list (no root) can't.
const completeCatalogs = new WeakSet<AppCatalog>();

/**
 * False only when `catalog` lists every installed app and none of `id`'s ids
 * (aliases included) is among them. Unknown means installed: better a tile that
 * may not open than hiding apps when the list is incomplete.
 */
/** True when `catalog` came from the TV's full app list (read as root). */
export function isCatalogComplete(catalog: AppCatalog | null | undefined): boolean {
  return !!catalog && completeCatalogs.has(catalog);
}

export function isAppInstalled(catalog: AppCatalog | null | undefined, id: string): boolean {
  if (!catalog || !completeCatalogs.has(catalog)) return true;
  return getAppIdCandidates(id).some(function (candidate) {
    return !!catalog[candidate];
  });
}

export async function loadAppCatalog(): Promise<AppCatalog> {
  const catalog: AppCatalog = {};

  try {
    const res = await listApps();
    const normalizedRes = res as {apps?: LunaResponse[]; complete?: boolean};
    (normalizedRes.apps || []).forEach(function (entry) {
      const normalized = normalizeAppRecord(entry, entry && entry.id);
      if (!normalized.id) return;
      catalog[normalized.id] = normalized;
    });
    if (normalizedRes.complete) completeCatalogs.add(catalog);
  } catch (err) {
    // listApps is best-effort; pinned apps can still be resolved individually.
  }

  return catalog;
}

/**
 * The remembered title/icon for an id, synchronously, from the on-device app
 * memory. Used to paint the home dock before the app list answers after a cold
 * boot; callers fill the real values in once the catalog arrives.
 */
export function knownAppInfo(id?: string | null): AppRecord | null {
  if (!id) return null;
  const known = knownApp(id);
  return applyBuiltinOverrides({
    id: id,
    title: (known && known.t) || humanizeAppId(id),
    icon: (known && known.i) || ''
  });
}

export async function resolvePinnedApp(id: string, catalog: AppCatalog): Promise<AppRecord | null> {
  const cached = catalog && catalog[id];
  // Installed ids first (e.g. amazon before amazon.html), so the tile opens
  // the app this TV actually has.
  const candidates = getAppIdCandidates(id).sort(function (a, b) {
    return (catalog && catalog[b] ? 1 : 0) - (catalog && catalog[a] ? 1 : 0);
  });

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const cachedCandidate = catalog && catalog[candidate];

    try {
      const info = await getAppInfo(candidate);
      const normalized = normalizeAppRecord(info, candidate);
      const merged = applyBuiltinOverrides({
        id: id,
        launchId: candidate,
        title: (cached && cached.title) || (cachedCandidate && cachedCandidate.title) || normalized.title,
        icon: pickBestIcon(
          cached && cached.icon,
          cachedCandidate && cachedCandidate.icon,
          normalized.icon
        )
      });
      if (catalog) catalog[id] = merged;
      return merged;
    } catch (err) {
      if (cachedCandidate) {
        const merged = applyBuiltinOverrides({
          id: id,
          launchId: candidate,
          title: cachedCandidate.title,
          icon: cachedCandidate.icon || ''
        });
        if (catalog) catalog[id] = merged;
        return merged;
      }
    }
  }

  if (cached) return applyBuiltinOverrides({id: id, title: cached.title, icon: cached.icon || ''});
  // The TV can't be asked right now: what it said last time.
  const known = knownApp(id);
  return applyBuiltinOverrides({
    id: id,
    title: (known && known.t) || humanizeAppId(id),
    icon: (known && known.i) || ''
  });
}