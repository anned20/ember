/**
 * Settings -> Backup & restore: what a backup file contains, and reading back
 * the ones found. luna.js writes and reads the files (as root); config.js fits
 * a backup's settings to this version (configFromBackup).
 *
 * Compatibility: each file says which layout of the file (format), of the
 * settings (schema, i.e. config.version) and which version of Ember (appVersion)
 * wrote it. Every later version keeps reading older files; a file in a newer
 * format than this version knows is listed but not restored.
 */

import {CONFIG_SCHEMA_VERSION, configFromBackup} from '@config/config.js';
import {APP_VERSION} from '@lib/version.js';
import {BRAND} from '@lib/brand.js';
import {activeLocale, t, tn} from '@lib/i18n.js';
import type {BackupFitResult, Config} from '@lib/types.js';

// Layout of the backup file itself. Bump only if the wrapper changes (not for
// settings changes: those are CONFIG_SCHEMA_VERSION) and keep reading older
// formats in parseBackup().
export const BACKUP_FORMAT = 1;

const APP_ID = BRAND.appId;
// Backups made before the Ember rename carry the Launch Home app id; they stay
// readable so an upgrade can import them and the restore list still lists them.
const LEGACY_APP_ID = BRAND.legacy.appId;

// When and where the last backup went, shown under the buttons (a small note
// of its own, not part of the settings).
export const LAST_BACKUP_KEY = BRAND.storage.backupLast;

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
  if (isNaN(d.getTime())) return t('backup.unknownDate');
  return d.toLocaleString(activeLocale(), {day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'});
}

/**
 * A backup's location in the active language. The note under the buttons stores
 * the English tokens ('TV', 'TV and USB drive') and a found file reports 'TV' or
 * 'USB', so a later language switch re-reads them instead of showing a
 * translated copy that is now wrong.
 */
export function backupWhereLabel(where: string): string {
  if (where === 'USB' || where === 'USB drive') return t('backup.whereUsbDrive');
  if (where === 'TV and USB drive') return t('backup.whereTvAndUsb');
  return t('backup.whereTv');
}

export function lastBackupNote(): string {
  try {
    const last: {savedAt?: string; where?: string} | null =
      JSON.parse(localStorage.getItem(LAST_BACKUP_KEY) || 'null');
    if (last && last.savedAt) {
      return t('backup.lastBackup', {
        when: backupWhen(last.savedAt),
        where: backupWhereLabel(last.where || '')
      });
    }
  } catch (err) {
    // No note yet.
  }
  return t('backup.noneYet');
}

/**
 * The backup file for `config`. `opts.reason` is 'manual', 'before-restore' or
 * 'before-update'; `opts.appVersion` is the version of Ember that wrote these
 * settings (default: this one) and `opts.updatedTo` the version it was being
 * updated to. ASCII only (other characters as \u escapes) so it can go through
 * the shell in pieces.
 */
export function settingsBackupText(config: Config, opts?: SettingsBackupOptions): string {
  const o = opts || {};
  const text = JSON.stringify({
    app: APP_ID,
    kind: BRAND.backupKind,
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
 * reason, readable}, or null when it isn't an Ember or Launch Home backup. Files from
 * 0.0.110 have no format or schema: format 1, schema from their settings.
 */
export function parseBackup(text: string, where: string): ParsedBackup | null {
  let data: SettingsBackupData | null = null;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return null;
  }
  if (!data || (data.app !== APP_ID && data.app !== LEGACY_APP_ID) ||
      !data.config || typeof data.config !== 'object') return null;
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

/** The Ember or Launch Home backups among `found` ([{where, text}]), newest first. */
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
  if (b.reason === 'before-restore') return t('backup.kindBeforeRestore');
  if (b.reason === 'before-update') {
    return b.data.updatedTo
      ? t('backup.kindBeforeUpdateTo', {version: b.data.updatedTo})
      : t('backup.kindBeforeUpdate');
  }
  return t('backup.kindManual');
}

/** One line to choose a backup by: when, what kind, where, which version. */
export function backupLabel(b: ParsedBackup): string {
  return backupWhen(b.data.savedAt || '') + ' · ' + backupKind(b) + ' · ' +
    backupWhereLabel(b.where) + (b.appVersion ? ' · ' + b.appVersion : '');
}

/** How a backup relates to this version of Ember, in words. */
export function compatibilityNote(b: ParsedBackup): string {
  const by = b.appVersion ? ' (' + b.appVersion + ')' : '';
  if (!b.readable) {
    return t('backup.madeByNewerUnreadable', {brand: BRAND.name, by: by});
  }
  if (b.schema > CONFIG_SCHEMA_VERSION) {
    return t('backup.madeByNewerSchema', {brand: BRAND.name, by: by});
  }
  if (b.schema < CONFIG_SCHEMA_VERSION) {
    return t('backup.madeByOlderSchema', {brand: BRAND.name, by: by});
  }
  return t('backup.madeBySameSchema', {
    brand: BRAND.name,
    version: b.appVersion ? ' ' + b.appVersion : ''
  });
}

function listSome(paths: string[]): string {
  return paths.slice(0, 3).join(', ') + (paths.length > 3 ? ', …' : '');
}

/** What a restore did (`result` from configFromBackup), for the status line. */
export function restoreReport(b: ParsedBackup, result: BackupFitResult): string {
  let text = t('backup.restored', {
    when: backupWhen(b.data.savedAt || ''),
    kind: backupKind(b),
    where: backupWhereLabel(b.where),
    app: b.appVersion ? ', ' + BRAND.name + ' ' + b.appVersion : ''
  });
  const kept = result.skipped.filter(function (s) { return s.why === 'type'; })
    .map(function (s) { return s.path; });
  const unused = result.skipped.filter(function (s) { return s.why === 'newer'; })
    .map(function (s) { return s.path; });
  if (kept.length) {
    text += ' ' + tn('backup.kept', kept.length, {settings: listSome(kept)});
  }
  if (unused.length) {
    text += ' ' + tn('backup.unused', unused.length, {settings: listSome(unused)});
  }
  return text;
}

/**
 * On the first start with no stored config, import the newest Launch Home
 * backup so an upgrade keeps its setup. `readBackups` returns every backup
 * found (the TV copy, the automatic copies and each USB drive); it is injected
 * so the decision can be tested without the TV filesystem. Newest wins, and a
 * backup whose settings don't fit is skipped. Returns null (Ember starts on
 * defaults) when there is a stored config, no readable backup, or nothing fits.
 */
export async function importLegacySettings(
  storedConfigText: string,
  current: Config,
  readBackups: () => Promise<SettingsBackupFound[]>
): Promise<Config | null> {
  if (storedConfigText) return null;
  const backups = listBackups(await readBackups());
  for (const b of backups) {
    if (!b.readable) continue;
    const fitted = configFromBackup(b.data.config, current);
    if (fitted) return fitted.config;
  }
  return null;
}
