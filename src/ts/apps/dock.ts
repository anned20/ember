/**
 * The Dock's membership: which apps are on the home row, in what order, and
 * which of them are Custom apps. Settings, All apps and the Launch Home import
 * all edit through here, so pin, unpin, reorder and remove cannot disagree.
 *
 * Every function is pure: a LauncherConfig in, a new one out. No config
 * singleton, no save, no DOM.
 */

import {getAppIdCandidates} from './app-icons.js';
import type {CustomApp, LauncherConfig} from '@lib/types.js';

/** One tile of the Dock: a pinned app id, with its Custom app record if it has one. */
export interface DockEntry {
  id: string;
  custom?: CustomApp;
}

/** A new LauncherConfig with copies of the two arrays the Dock owns. */
function clone(launcher: LauncherConfig): LauncherConfig {
  return Object.assign({}, launcher, {
    pinnedApps: (launcher.pinnedApps || []).slice(),
    customApps: (launcher.customApps || []).map(function (entry) {
      return Object.assign({}, entry);
    })
  });
}

function customById(launcher: LauncherConfig): Record<string, CustomApp> {
  const byId: Record<string, CustomApp> = {};
  (launcher.customApps || []).forEach(function (entry) {
    if (entry && entry.id) byId[entry.id] = entry;
  });
  return byId;
}

/** `id` or one of its aliases is one of `wanted`. */
function matchesId(id: string | undefined | null, wanted: string[]): boolean {
  if (!id) return false;
  if (wanted.indexOf(id) >= 0) return true;
  return getAppIdCandidates(id).some(function (alias) {
    return wanted.indexOf(alias) >= 0;
  });
}

/**
 * The Dock in order, de-duplicated by exact id. A pinned id with no Custom app
 * record is a plain app; two ids for the same app stay two tiles, as the Dock
 * renders them.
 */
function entries(launcher: LauncherConfig): DockEntry[] {
  const custom = customById(launcher);
  const seen: Record<string, boolean> = {};
  const out: DockEntry[] = [];
  (launcher.pinnedApps || []).forEach(function (id) {
    if (!id || seen[id]) return;
    seen[id] = true;
    out.push(custom[id] ? {id: id, custom: custom[id]} : {id: id});
  });
  return out;
}

/**
 * Whether the Dock holds this app: alias-aware for a plain id, and a Custom
 * app tile counts under its launch id too.
 */
function contains(launcher: LauncherConfig, appId: string): boolean {
  if (!appId) return false;
  const wanted = getAppIdCandidates(appId);
  return entries(launcher).some(function (entry) {
    if (matchesId(entry.id, wanted)) return true;
    return !!entry.custom && matchesId(entry.custom.launchId, wanted);
  });
}

/** Append the app to the Dock; a no-op when it is already there. */
function pin(launcher: LauncherConfig, appId: string): LauncherConfig {
  const next = clone(launcher);
  if (appId && !contains(next, appId)) next.pinnedApps.push(appId);
  return next;
}

/**
 * Append a Custom app tile with a freshly minted `custom:` id; a no-op when the
 * app is already in the Dock.
 */
function addCustom(
  launcher: LauncherConfig,
  app: {launchId: string; title: string; icon: string}
): LauncherConfig {
  const next = clone(launcher);
  if (!app.launchId || contains(next, app.launchId)) return next;
  const id = 'custom:' + Date.now() + '-' + Math.floor(Math.random() * 1000);
  next.customApps.push({id: id, launchId: app.launchId, title: app.title, icon: app.icon});
  next.pinnedApps.push(id);
  return next;
}

/**
 * Drop every Dock tile that launches the app (aliases of a plain id, the launch
 * id of a Custom app), and the Custom app records of the tiles that went.
 */
function remove(launcher: LauncherConfig, id: string): LauncherConfig {
  const next = clone(launcher);
  const wanted = getAppIdCandidates(id);
  const custom = customById(next);

  function isApp(dockId: string): boolean {
    if (matchesId(dockId, wanted)) return true;
    return !!custom[dockId] && matchesId(custom[dockId].launchId, wanted);
  }

  const dropped: Record<string, boolean> = {};
  next.pinnedApps = next.pinnedApps.filter(function (dockId) {
    if (!isApp(dockId)) return true;
    dropped[dockId] = true;
    return false;
  });
  // Records of tiles nobody pins any more are kept: no screen shows them, and
  // dropping them on an edit would delete stored data for no visible gain.
  next.customApps = next.customApps.filter(function (entry) {
    return !(entry && dropped[entry.id]);
  });
  return next;
}

/** Swap the entry at `index` with its neighbour; a no-op at either end. */
function move(launcher: LauncherConfig, index: number, delta: number): LauncherConfig {
  const next = clone(launcher);
  const target = index + (delta < 0 ? -1 : 1);
  if (!delta || index < 0 || index >= next.pinnedApps.length) return next;
  if (target < 0 || target >= next.pinnedApps.length) return next;
  const moved = next.pinnedApps[index];
  next.pinnedApps[index] = next.pinnedApps[target];
  next.pinnedApps[target] = moved;
  return next;
}

export const dock = {
  entries: entries,
  contains: contains,
  pin: pin,
  addCustom: addCustom,
  remove: remove,
  move: move
};
