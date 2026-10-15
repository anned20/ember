/**
 * The update check: is there a newer Ember release than the one running?
 *
 * Pure version comparison plus one small GitHub request (the weather module's
 * fetch shape), so the Tools pane only formats a verdict; nothing is downloaded
 * or installed, and no setting changes.
 */

import {BRAND} from '@lib/brand.js';

const API_URL = 'https://api.github.com/repos/' + BRAND.repo + '/releases/latest';
/** How long GitHub gets before the check gives up ("Checking…" for this long). */
const FETCH_TIMEOUT_MS = 8000;

/** The project's release page: what the QR code opens on a phone. */
export const RELEASE_PAGE_URL = 'https://github.com/' + BRAND.repo + '/releases/latest';

export type UpdateState = 'current' | 'available' | 'unknown';

export interface UpdateVerdict {
  state: UpdateState;
  /** The newest release's version, without the "v" ("0.5.0"); '' when unknown. */
  latest: string;
}

/**
 * A version's numeric segments, or null when the text is not a version at all:
 * "v0.4.0" → [0, 4, 0], "0.5.0-rc1" → [0, 5, 0], "nightly" → null.
 */
function versionParts(text: string): number[] | null {
  const body = String(text || '').trim().replace(/^v/i, '').split(/[-+]/)[0];
  return /^\d+(\.\d+)*$/.test(body) ? body.split('.').map(Number) : null;
}

function compareParts(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * -1, 0 or 1 for two dotted numeric versions, or null when either is not one.
 * A leading "v" and a pre-release suffix are ignored, and a missing segment
 * counts as 0, so "0.4" and "0.4.0" are equal.
 */
export function compareVersions(a: string, b: string): number | null {
  const left = versionParts(a);
  const right = versionParts(b);
  return left && right ? compareParts(left, right) : null;
}

/** What the released `tag` means for the running `current`. */
export function updateVerdict(current: string, tag: string): UpdateVerdict {
  const latest = versionParts(tag);
  const running = versionParts(current);
  // An unreadable version is "unknown", never a false "up to date".
  if (!latest || !running) return {state: 'unknown', latest: ''};
  return {
    state: compareParts(running, latest) < 0 ? 'available' : 'current',
    latest: latest.join('.')
  };
}

/** Reject if `promise` does not settle within `ms` (home/weather.ts's shape). */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise(function (resolve, reject) {
    const timer: ReturnType<typeof setTimeout> = setTimeout(function () {
      reject(new Error('Update check timed out'));
    }, ms);
    promise.then(function (value) {
      clearTimeout(timer);
      resolve(value);
    }, function (err) {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** The newest release's tag, e.g. "v0.5.0". Rejects when GitHub can't be read. */
export function fetchLatestRelease(): Promise<string> {
  return withTimeout(fetch(API_URL), FETCH_TIMEOUT_MS).then(function (res) {
    if (!res || !res.ok) throw new Error('GitHub replied HTTP ' + (res && res.status));
    return res.text();
  }).then(function (text) {
    const tag = (JSON.parse(text) || {}).tag_name;
    if (typeof tag !== 'string' || !tag) throw new Error('GitHub sent no release tag');
    return tag;
  });
}
