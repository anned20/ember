/**
 * The settings mirror: a copy of the config on the TV, so Ember's two copies
 * (its own id and the one the Home takeover mounts under LG's Home id, each with
 * its own localStorage) share one set of settings. The file is a backup file, so
 * parseBackup and configFromBackup read, migrate and fit it.
 *
 * Whichever copy saved last wins: each side records when it last saved
 * (configSavedAt), and the mirror carries the same time.
 */

import {configFromBackup} from '@config/config.js';
import type {Config} from '@lib/types.js';
import {parseBackup} from './settings-backup.js';

/** What a copy should do with the mirror it just read. */
export type MirrorAction =
  | {kind: 'adopt'; config: Config; savedAt: number}
  | {kind: 'publish'}
  | {kind: 'none'};

/**
 * `mirrorText` is the mirror file's text (null when there is none), `savedAt`
 * when this copy last saved, `current` this copy's settings.
 */
export function decideMirror(mirrorText: string | null, savedAt: number, current: Config): MirrorAction {
  const mirror = mirrorText ? parseBackup(mirrorText, 'TV') : null;
  if (!mirror || !mirror.readable || !mirror.time) return {kind: 'publish'};
  if (mirror.time > savedAt) {
    const fitted = configFromBackup(mirror.data.config, current);
    return fitted ? {kind: 'adopt', config: fitted.config, savedAt: mirror.time} : {kind: 'publish'};
  }
  return mirror.time < savedAt ? {kind: 'publish'} : {kind: 'none'};
}
