/**
 * Settings -> Add an app -> Add all apps from LG's home screen: which of
 * LG's launch points (luna.js listLaunchPoints, in LG's order) to add to the
 * home row. Everything else stays as it is: nothing is removed or reordered.
 */

import {getAppIdCandidates} from './app-icons.js';
import {dock} from './dock.js';
import {BRAND, BRAND_ID_NAMESPACE} from '@lib/brand.js';
import type {LauncherConfig} from '@lib/types.js';

/** A launch point as returned by luna.js listLaunchPoints. */
export interface LaunchPoint {
  id?: string;
  hidden?: boolean;
  visible?: boolean;
  lptype?: string;
  title?: string;
  icon?: string;
  [key: string]: unknown;
}

// Not for the dock: Ember itself plus any leftover Launch Home entries — the
// Home install, inputs and Live TV (Ember's inputs row has those), and TV
// Settings (it has its own tile).
const ID_NAMESPACES = [BRAND_ID_NAMESPACE, BRAND.legacy.appIdNamespace]
  .map(function (namespace) { return namespace.replace(/\./g, '\\.'); })
  .join('|');
const NOT_FOR_DOCK = new RegExp(
  '^(' + ID_NAMESPACES +
  '|com\\.webos\\.app\\.(hdmi|externalinput|livetv$|inputcommon$|component|scart|av\\d*$|rgb)' +
  '|com\\.palm\\.app\\.settings$|com\\.webos\\.app\\.settings$)'
);

/**
 * App ids from `points` to add, in LG's order: shown apps (not hidden, and not
 * bookmarks such as a named HDMI input) that aren't in the Dock yet (any alias
 * id counts, and a Custom app tile counts under its launch id) and belong in
 * the dock. The Dock is read as live entries, so a Custom app record nobody
 * pins no longer blocks an app from coming back.
 */
export function lgHomeAppsToAdd(
  points: LaunchPoint[] | null | undefined,
  launcher: LauncherConfig
): string[] {
  const taken: Record<string, boolean> = {};
  dock.entries(launcher).forEach(function (entry) {
    getAppIdCandidates(entry.id).forEach(function (alias) { taken[alias] = true; });
    if (entry.custom && entry.custom.launchId) {
      getAppIdCandidates(entry.custom.launchId).forEach(function (alias) { taken[alias] = true; });
    }
  });
  const out: string[] = [];
  (points || []).forEach(function (point) {
    const id = point && typeof point.id === 'string' ? point.id : '';
    if (!id || point.hidden === true || point.visible === false || point.lptype === 'bookmark') return;
    if (NOT_FOR_DOCK.test(id)) return;
    if (getAppIdCandidates(id).some(function (alias) { return taken[alias]; })) return;
    getAppIdCandidates(id).forEach(function (alias) { taken[alias] = true; });
    out.push(id);
  });
  return out;
}
