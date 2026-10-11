/**
 * Settings -> Backup & restore: what a backup file contains, and reading back
 * the ones found. luna.js writes and reads the files (as root); config.js fits
 * a backup's settings to this version (configFromBackup).
 *
 * Compatibility: each file says which layout of the file (format), of the
 * settings (schema, i.e. config.version) and which Launch Home (appVersion)
 * wrote it. Every later version keeps reading older files; a file in a newer
 * format than this version knows is listed but not restored.
 */

import {CONFIG_SCHEMA_VERSION} from './config.js';
import {APP_VERSION} from './version.js';
import type {BackupFitResult, Config} from './types.js';

// Layout of the backup file itself. Bump only if the wrapper changes (not for
// settings changes: those are CONFIG_SCHEMA_VERSION) and keep reading older
// formats in parseBackup().
export const BACKUP_FORMAT = 1;

const APP_ID = 'org.webosbrew.lounge.launcher';

// When and where the last backup went, shown under the buttons (a small note
// of its own, not part of the settings).
export const LAST_BACKUP_KEY = 'lounge.backup.last';

export interface SettingsBackupOptions {
  reason?: string;
  appVersion?: string;
  updatedTo?: string;
}

/** A backup file's settings as written by settingsBackupText. */
export interface SettingsBackupData {
  app?: string;
  kind?: string;
  format?: number;
  appVersion?: string;
  version?: string;
  schema?: number;
  reason?: string;
  updatedTo?: string;
  savedAt?: string;
  config: {version?: number};
}

/** One backup file as parsed by parseBackup. */
export interface ParsedBackup {
  data: SettingsBackupData;
  where: string;
  time: number;
  format: number;
  schema: number;
  appVersion: string;
  reason: string;
  readable: boolean;
}

/** A backup file found on the TV or a USB drive. */
export interface SettingsBackupFound {
  where: string;
  text: string;
}

export function backupWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'an unknown date';
  return d.toLocaleString([], {day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'});
}

export function lastBackupNote(): string {
  try {
    const last: {savedAt?: string; where?: string} | null =
      JSON.parse(localStorage.getItem(LAST_BACKUP_KEY) || 'null');
    if (last && last.savedAt) return 'Last backup: ' + backupWhen(last.savedAt) + ' (' + last.where + ').';
  } catch (err) {
    // No note yet.
  }
  return 'No backup made from this TV yet.';
}

/**
 * The backup file for `config`. `opts.reason` is 'manual', 'before-restore' or
 * 'before-update'; `opts.appVersion` is the Launch Home that wrote these
 * settings (default: this one) and `opts.updatedTo` the version it was being
 * updated to. ASCII only (other characters as \u escapes) so it can go through
 * the shell in pieces.
 */
export function settingsBackupText(config: Config, opts?: SettingsBackupOptions): string {
  const o = opts || {};
  const text = JSON.stringify({
    app: APP_ID,
    kind: 'launch-home-settings',
    format: BACKUP_FORMAT,
    appVersion: o.appVersion === undefined ? APP_VERSION : o.appVersion,
    schema: config && typeof config.version === 'number' ? config.version : null,
    reason: o.reason || 'manual',
    updatedTo: o.updatedTo || undefined,
    savedAt: new Date().toISOString(),
    config: config
  }, null, 1);
  return text.replace(/[\u007f-\uffff]/g, function (c) {
    return '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4);
  });
}

/**
 * A backup file's contents as {data, where, time, format, schema, appVersion,
 * reason, readable}, or null when it isn't a Launch Home backup. Files from
 * 0.0.110 have no format or schema: format 1, schema from their settings.
 */
export function parseBackup(text: string, where: string): ParsedBackup | null {
  let data: SettingsBackupData | null = null;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return null;
  }
  if (!data || data.app !== APP_ID || !data.config || typeof data.config !== 'object') return null;
  const format = typeof data.format === 'number' ? data.format : 1;
  let schema: number | undefined = typeof data.schema === 'number' ? data.schema : data.config.version;
  if (typeof schema !== 'number') schema = 1;
  return {
    data: data,
    where: where,
    time: Date.parse(data.savedAt || '') || 0,
    format: format,
    schema: schema,
    appVersion: String(data.appVersion || data.version || ''),
    reason: data.reason || 'manual',
    readable: format <= BACKUP_FORMAT
  };
}

/** The Launch Home backups among `found` ([{where, text}]), newest first. */
export function listBackups(found?: SettingsBackupFound[]): ParsedBackup[] {
  return (found || []).map(function (entry) {
    return parseBackup(entry.text, entry.where);
  }).filter(function (b): b is ParsedBackup {
    return b !== null;
  }).sort(function (a, b) {
    return b.time - a.time;
  });
}

function backupKind(b: ParsedBackup): string {
  if (b.reason === 'before-restore') return 'before your last restore';
  if (b.reason === 'before-update') {
    return 'before updating' + (b.data.updatedTo ? ' to ' + b.data.updatedTo : '');
  }
  return 'your backup';
}

/** One line to choose a backup by: when, what kind, where, which version. */
export function backupLabel(b: ParsedBackup): string {
  return backupWhen(b.data.savedAt || '') + ' · ' + backupKind(b) + ' · ' +
    (b.where === 'USB' ? 'USB drive' : 'TV') + (b.appVersion ? ' · ' + b.appVersion : '');
}

function madeBy(b: ParsedBackup): string {
  return b.appVersion ? ' (' + b.appVersion + ')' : '';
}

/** How a backup relates to this version of Launch Home, in words. */
export function compatibilityNote(b: ParsedBackup): string {
  if (!b.readable) {
    return 'Made by a newer Launch Home' + madeBy(b) + ' in a format this version can’t ' +
      'read. Update Launch Home to restore it.';
  }
  if (b.schema > CONFIG_SCHEMA_VERSION) {
    return 'Made by a newer Launch Home' + madeBy(b) + '. Settings this version doesn’t ' +
      'have are kept but not used.';
  }
  if (b.schema < CONFIG_SCHEMA_VERSION) {
    return 'Made by an older Launch Home' + madeBy(b) + '. Its settings are updated for ' +
      'this version.';
  }
  return 'Made by Launch Home' + (b.appVersion ? ' ' + b.appVersion : '') +
    ', with the same settings as this version.';
}

function listSome(paths: string[]): string {
  return paths.slice(0, 3).join(', ') + (paths.length > 3 ? ', …' : '');
}

/** What a restore did (`result` from configFromBackup), for the status line. */
export function restoreReport(b: ParsedBackup, result: BackupFitResult): string {
  let text = 'Restored the settings from ' + backupWhen(b.data.savedAt || '') + ' (' + backupKind(b) +
    ', ' + (b.where === 'USB' ? 'USB drive' : 'TV') +
    (b.appVersion ? ', Launch Home ' + b.appVersion : '') + ').';
  const kept = result.skipped.filter(function (s) { return s.why === 'type'; })
    .map(function (s) { return s.path; });
  const unused = result.skipped.filter(function (s) { return s.why === 'newer'; })
    .map(function (s) { return s.path; });
  if (kept.length) {
    text += ' ' + kept.length + (kept.length === 1 ? ' setting didn’t' : ' settings didn’t') +
      ' fit this version and kept its current value: ' + listSome(kept) + '.';
  }
  if (unused.length) {
    text += ' ' + unused.length + (unused.length === 1 ? ' setting is' : ' settings are') +
      ' from a newer version and not used here: ' + listSome(unused) + '.';
  }
  return text;
}
