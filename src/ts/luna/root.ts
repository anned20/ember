// The root script: every privileged operation in one module.
//
// Homebrew Channel runs shell as root on the TV. This module owns that shell —
// the commands, their quoting, the output parsing and the error each reply
// means. Callers ask for a behaviour ("enable the Home watcher"), never for a
// command line. `luna.ts` keeps the ordinary service bus.

import type { LunaResponse } from '@lib/types.js';
import { BRAND } from '@lib/brand.js';
import { execRoot, readExecStdout, TIMEOUTS } from './luna-transport.js';

/** A settings backup found on the TV or a USB drive. */
export interface SettingsBackup {
  where: 'TV' | 'USB';
  text: string;
}

/** Result of saving the settings backup to the TV and optionally a USB drive. */
export interface SettingsBackupWriteResult {
  usb: boolean | null;
  usbError: string;
}

/** One Live TV channel (scripts/channels.sh). */
export interface TvChannel {
  id: string;
  number: string;
  name: string;
  radio: boolean;
  hidden: boolean;
  favourite: boolean;
}

/** The channel Live TV is on and the programme now. */
export interface TvChannelNow {
  number: string;
  name: string;
  programme: string;
}

/** A *.json file read as root: its path and text. */
interface IndexedFile {
  path: string;
  text: string;
}

/**
 * Report the effective user privileged calls run as (e.g. "root"). Uses the
 * Homebrew Channel root exec service. Resolves to the username string, or null
 * when unavailable (not rooted, no Homebrew Channel, or desktop preview).
 */
export function whoAmI() {
  return execRoot('id -un', TIMEOUTS.rootDefault).then(function (res) {
    return readExecStdout(res) || null;
  }).catch(function () {
    return null;
  });
}

function guessImageMime(path: string) {
  const p = String(path).toLowerCase();
  if (p.endsWith('.jpg') || p.endsWith('.jpeg')) return 'image/jpeg';
  if (p.endsWith('.gif')) return 'image/gif';
  if (p.endsWith('.webp')) return 'image/webp';
  if (p.endsWith('.svg')) return 'image/svg+xml';
  if (p.endsWith('.bmp')) return 'image/bmp';
  return 'image/png';
}

/**
 * Read an image file from the TV filesystem as a base64 data URI using the
 * Homebrew Channel root service. Native app icons live outside the launcher's
 * sandbox, so WAM blocks `file://` <img> loads; reading the bytes as root and
 * inlining them is the only reliable way to display them. Resolves to a
 * `data:` URL, or null when the file can't be read.
 */
export function readFileAsDataUrl(path: string) {
  if (!path) return Promise.resolve(null);
  const clean = String(path).replace(/^file:\/\//, '');
  const command = 'cat -- ' + shQuote(clean);
  // Root through Homebrew Channel can stop answering; don't wait for good.
  return execRoot(command, TIMEOUTS.rootReadFile).then(function (res) {
    const b64 = res && res.stdoutBytes ? String(res.stdoutBytes).replace(/\s+/g, '') : '';
    if (!b64) return null;
    return 'data:' + guessImageMime(clean) + ';base64,' + b64;
  }).catch(function () {
    return null;
  });
}

const HOME_WATCHER_APP_DIR = BRAND.appDir;
const HOME_WATCHER_APP_PATH = HOME_WATCHER_APP_DIR + '/home-watcher.sh';
const HOME_WATCHER_ENABLE = HOME_WATCHER_APP_DIR + '/enable-home-watcher.sh';
const HOME_WATCHER_DISABLE = HOME_WATCHER_APP_DIR + '/disable-home-watcher.sh';
const BOOT_LAUNCH_SCRIPT = HOME_WATCHER_APP_DIR + '/boot-launch.sh';
const DIAGNOSTICS_SCRIPT = HOME_WATCHER_APP_DIR + '/diagnostics.sh';
const BOOT_LAUNCH_ENABLE = HOME_WATCHER_APP_DIR + '/enable-boot-launch.sh';
const BOOT_LAUNCH_DISABLE = HOME_WATCHER_APP_DIR + '/disable-boot-launch.sh';
const CHANNELS_SCRIPT = HOME_WATCHER_APP_DIR + '/channels.sh';
const VOICE_CLEANUP = HOME_WATCHER_APP_DIR + '/cleanup-voice.sh';

/** One shell-quoting rule for every path and free-text argument. */
function shQuote(text: unknown): string {
  return "'" + String(text).replace(/'/g, "'\\''") + "'";
}

/**
 * Install + start the root Home-button watcher so Home opens Ember even when
 * this web app is suspended.
 *
 * Runs a packaged enable script (not an inline command string). The previous
 * inline path joined steps with ";" after a background `&`, which busybox ash
 * rejects as `unexpected ";"` — enable always failed with "Home watcher failed".
 */
export function enableHomeWatcher() {
  const cmd =
    'chmod 755 ' + shQuote(HOME_WATCHER_ENABLE) + ' ' + shQuote(HOME_WATCHER_APP_PATH) +
    ' 2>/dev/null; sh ' + shQuote(HOME_WATCHER_ENABLE);
  return rootScriptOutput(execRoot(cmd, TIMEOUTS.rootHomeWatcher)).then(function (out) {
    if (out.indexOf('missing_watcher') >= 0) {
      throw new Error('home-watcher.sh not installed on TV');
    }
    if (out.indexOf('start_failed') >= 0) {
      throw new Error('watcher did not start (see ' + BRAND.tmpPrefix + '-watcher.log)');
    }
    if (out.indexOf('enabled') < 0) {
      throw new Error(out.split('\n')[0] || 'home watcher failed to start');
    }
    return true;
  });
}

/**
 * Stop and remove the root Home-button watcher.
 */
export function disableHomeWatcher() {
  const cmd =
    'chmod 755 ' + shQuote(HOME_WATCHER_DISABLE) + ' 2>/dev/null; sh ' +
    shQuote(HOME_WATCHER_DISABLE);
  return execRoot(cmd, TIMEOUTS.rootHomeWatcherStop).then(function () {
    return true;
  }).catch(function () {
    return false;
  });
}

/**
 * Install Homebrew init.d hook so Ember launches after TV power-on.
 * Requires rooted TV + Homebrew Channel startup (webosbrew init.d).
 */
export function enableBootLaunch() {
  const cmd =
    'chmod 755 ' + shQuote(BOOT_LAUNCH_ENABLE) + ' ' + shQuote(BOOT_LAUNCH_SCRIPT) +
    ' 2>/dev/null; sh ' + shQuote(BOOT_LAUNCH_ENABLE);
  return rootScriptOutput(execRoot(cmd, TIMEOUTS.rootBootLaunchEnable)).then(function (out) {
    if (out.indexOf('missing_boot_script') >= 0) {
      throw new Error('boot-launch.sh not installed on TV');
    }
    if (out.indexOf('enabled') < 0) {
      throw new Error(out.split('\n')[0] || 'boot launch failed to install');
    }
    return true;
  });
}

/**
 * Remove the boot-on-start init.d hook.
 */
export function disableBootLaunch() {
  const cmd =
    'chmod 755 ' + shQuote(BOOT_LAUNCH_DISABLE) + ' 2>/dev/null; sh ' +
    shQuote(BOOT_LAUNCH_DISABLE);
  return execRoot(cmd, TIMEOUTS.rootBootLaunchDisable).then(function () {
    return true;
  }).catch(function () {
    return false;
  });
}

/**
 * Settings -> TV check: model, memory, CPU load, background activity and how
 * long TV Settings takes to open (the script opens and closes it twice). About
 * 30-40 s. `appLine` (Ember's own settings) goes into the saved report.
 * Resolves with the plain-text report.
 */
export function runTvCheck(appLine: string) {
  const cmd =
    'chmod 755 ' + shQuote(DIAGNOSTICS_SCRIPT) + ' 2>/dev/null; sh ' +
    shQuote(DIAGNOSTICS_SCRIPT) + ' --open-settings --app ' + shQuote(appLine || '');
  // Usually 30-40 s; up to about two minutes when TV Settings is slow and
  // won't close by itself (the script then tries other ways).
  return rootScriptOutput(execRoot(cmd, TIMEOUTS.rootTvCheck));
}

// Settings -> Backup & restore. The TV copy is outside the app folder, so it
// survives reinstalling Ember; a USB drive gets one in its Ember folder
// (not config.json there, which Ember applies at every start).
const SETTINGS_BACKUP_FILE = BRAND.configDir + '/settings-backup.json';
const USB_SETTINGS_BACKUP_NAME = BRAND.usbSettingsFile;
// Copies Launch Home keeps by itself: before each restore (one, replaced each
// time) and before each update (the newest few).
const SETTINGS_AUTO_DIR = BRAND.configDir + '/auto';
// The Launch Home backup locations, read on first run to import an upgrade and
// listed so an old backup can still be restored.
const LEGACY_SETTINGS_BACKUP_FILE = BRAND.legacy.configDir + '/settings-backup.json';
const LEGACY_SETTINGS_AUTO_DIR = BRAND.legacy.configDir + '/auto';
const LEGACY_USB_SETTINGS_BACKUP_NAME = BRAND.legacy.usbSettingsFile;
const AUTO_UPDATE_COPIES = 3;
const FILE_MARK = BRAND.fileMark;

/**
 * Shell commands that write `text` (ASCII) to `path`, replacing the file only
 * once it is complete. Homebrew Channel runs one `sh -c` command whose single
 * argument can't exceed 128 KB, so long text goes over in pieces.
 */
function rootWriteCommands(path: string, text: string): string[] {
  const part = path + '.part';
  const dir = path.replace(/\/[^/]*$/, '') || '/';
  const CHUNK = 24000;
  const cmds: string[] = [];
  for (let i = 0; i === 0 || i < text.length; i += CHUNK) {
    cmds.push((i === 0 ? 'mkdir -p ' + shQuote(dir) + ' && ' : '') +
      'printf %s ' + shQuote(text.slice(i, i + CHUNK)) +
      (i === 0 ? ' > ' : ' >> ') + shQuote(part) + ' && echo written');
  }
  cmds.push('mv -f ' + shQuote(part) + ' ' + shQuote(path) + ' && echo written');
  return cmds;
}

async function writeFileAsRoot(path: string, text: string): Promise<void> {
  for (const cmd of rootWriteCommands(path, text)) {
    const out = await rootScriptOutput(execRoot(cmd, TIMEOUTS.rootDefault));
    if (out.indexOf('written') < 0) throw new Error(out.split('\n')[0] || 'could not write');
  }
}

/** A file's text read as root, or null when it doesn't exist. */
async function readFileAsRoot(path: string): Promise<string | null> {
  const res = await execRoot(
    'if [ -f ' + shQuote(path) + ' ]; then cat ' + shQuote(path) + '; else echo __missing__; fi',
    TIMEOUTS.rootDefault);
  const out = readExecStdout(res);
  return out === '__missing__' ? null : out;
}

/** The text of every *.json file in `dir`, read as root: [{path, text}]. */
async function readJsonFilesAsRoot(dir: string): Promise<IndexedFile[]> {
  const res = await execRoot('for f in ' + shQuote(dir) + '/*.json; do ' +
    '[ -f "$f" ] || continue; printf \'\\n' + FILE_MARK + '%s\\n\' "$f"; cat "$f"; done; echo',
    TIMEOUTS.rootDefault);
  const out = '\n' + readExecStdout(res);
  return out.split('\n' + FILE_MARK).slice(1).map(function (chunk: string): IndexedFile {
    const cut = chunk.indexOf('\n');
    return {path: chunk.slice(0, cut), text: chunk.slice(cut + 1)};
  });
}

/**
 * Keep an automatic backup on the TV, `name` being e.g. before-restore.json
 * or before-update-to-0.0.111.json; only the newest few update copies stay.
 */
export async function writeAutoBackup(name: string, text: string): Promise<void> {
  const safe = String(name).replace(/[^A-Za-z0-9._-]/g, '_');
  await writeFileAsRoot(SETTINGS_AUTO_DIR + '/' + safe, text);
  try {
    await execRoot('cd ' + shQuote(SETTINGS_AUTO_DIR) + ' && ls -t before-update-*.json ' +
      '2>/dev/null | tail -n +' + (AUTO_UPDATE_COPIES + 1) + ' | while read -r f; do rm -f "$f"; done',
      TIMEOUTS.rootDefault);
  } catch (err) {
    // Old copies are only tidied up.
  }
}

/**
 * Save the settings backup `text` on the TV and, when `usbRoot` (a USB
 * drive's Ember folder) is given, there too. The TV copy must succeed.
 * Resolves {usb: true | false | null, usbError}.
 */
export async function writeSettingsBackup(text: string, usbRoot?: string): Promise<SettingsBackupWriteResult> {
  await writeFileAsRoot(SETTINGS_BACKUP_FILE, text);
  if (!usbRoot) return {usb: null, usbError: ''};
  try {
    await writeFileAsRoot(usbRoot.replace(/\/+$/, '') + '/' + USB_SETTINGS_BACKUP_NAME, text);
    return {usb: true, usbError: ''};
  } catch (err: any) {
    return {usb: false, usbError: (err && err.message) || ''};
  }
}

/**
 * Every settings backup found: the TV copy and the automatic copies (Ember's
 * and the older Launch Home ones), plus one per USB folder in `usbRoots`.
 * Resolves [{where: 'TV' | 'USB', text}].
 */
export async function readSettingsBackups(usbRoots?: string[]): Promise<SettingsBackup[]> {
  const found: SettingsBackup[] = [];
  for (const file of [SETTINGS_BACKUP_FILE, LEGACY_SETTINGS_BACKUP_FILE]) {
    const tv = await readFileAsRoot(file);
    if (tv) found.push({where: 'TV', text: tv});
  }
  for (const dir of [SETTINGS_AUTO_DIR, LEGACY_SETTINGS_AUTO_DIR]) {
    try {
      (await readJsonFilesAsRoot(dir)).forEach(function (file) {
        found.push({where: 'TV', text: file.text});
      });
    } catch (err) {
      // No automatic copies yet.
    }
  }
  for (const root of usbRoots || []) {
    const base = String(root).replace(/\/+$/, '');
    for (const name of [USB_SETTINGS_BACKUP_NAME, LEGACY_USB_SETTINGS_BACKUP_NAME]) {
      try {
        const text = await readFileAsRoot(base + '/' + name);
        if (text) found.push({where: 'USB', text: text});
      } catch (err) {
        // An unreadable drive just has no backup.
      }
    }
  }
  return found;
}

/**
 * Live TV's channels (scripts/channels.sh, as root): [{id, number, name,
 * radio, hidden, favourite}], in the TV's order. Empty when no channels are
 * tuned (e.g. a TV only used with a set-top box).
 */
export function getTvChannels(): Promise<TvChannel[]> {
  return execRoot('sh ' + shQuote(CHANNELS_SCRIPT) + ' list', TIMEOUTS.rootChannelsList).then(function (res) {
    return readExecStdout(res).split('\n').map(function (line: string): TvChannel | null {
      const f = line.split('\t');
      if (f.length < 6 || !f[0] || !f[2]) return null;
      return {
        id: f[0],
        number: f[1],
        name: f[2],
        radio: f[3] === '1',
        hidden: f[4] === '1',
        favourite: f[5] === '1'
      };
    }).filter(Boolean) as TvChannel[];
  });
}

/** The channel Live TV is on and the programme now: {number, name, programme}. */
export function getTvChannelNow(): Promise<TvChannelNow> {
  return execRoot('sh ' + shQuote(CHANNELS_SCRIPT) + ' now', TIMEOUTS.rootChannelNow).then(function (res) {
    const f = readExecStdout(res).split('\t');
    return {number: f[0] || '', name: f[1] || '', programme: f[2] || ''};
  });
}

/** Switch Live TV to `channel` ({id, number}); rejects if the TV refused. */
export function openTvChannel(channel: {id?: string; number?: string} | null | undefined) {
  const id = String((channel && channel.id) || '').replace(/[^A-Za-z0-9_.-]/g, '');
  const number = String((channel && channel.number) || '').replace(/[^0-9.-]/g, '');
  const cmd = 'sh ' + shQuote(CHANNELS_SCRIPT) + ' open ' + shQuote(id) + ' ' + shQuote(number);
  return rootScriptOutput(execRoot(cmd, TIMEOUTS.rootChannelOpen)).then(function (out) {
    if (out.indexOf('opened') < 0) throw new Error('the TV didn\u2019t switch channel');
    return true;
  });
}

/**
 * What a root script printed, whether it exited 0 or not. Homebrew Channel
 * reports a non-zero exit as a Luna failure object with no `message`, which
 * left only a generic "check root / Homebrew Channel" toast.
 */
function rootScriptOutput(execPromise: Promise<LunaResponse>): Promise<string> {
  return execPromise.then(function (res) {
    return readExecStdout(res);
  }, function (err) {
    if (err instanceof Error) throw err; // e.g. our own timeout
    const out = readExecStdout(err) || String((err && err.stderrString) || '').trim();
    if (out) return out;
    const text = String((err && err.errorText) || '').trim();
    throw new Error(/command failed/i.test(text)
      ? 'root command failed'
      : (text || 'Homebrew Channel exec failed'));
  });
}

/**
 * Tear down the voice assistant an earlier Ember installed
 * (scripts/cleanup-voice.sh): stop its daemon, remove the boot hook that would
 * restart it and give LG's voice services back. Run once after the update, from
 * the idle pass. It is a quiet no-op on a TV that never enabled voice, and it
 * keeps the provider keys and the answer card. Resolves true once the init.d
 * hook is gone, so an interrupted run is retried at the next start.
 */
export function cleanupVoice(): Promise<boolean> {
  const cmd =
    'chmod 755 ' + shQuote(VOICE_CLEANUP) + ' 2>/dev/null; sh ' + shQuote(VOICE_CLEANUP);
  return rootScriptOutput(execRoot(cmd, TIMEOUTS.rootVoiceCleanup)).then(function (out) {
    // "clean" (nothing left to do) or "cleaned" (the hook is gone either way).
    return out.indexOf('clean') >= 0;
  });
}

/**
 * LG webOS 25 (and recent OLEDs) only accept these enum values for the gallery
 * screensaver timer. Anything else (e.g. "15") is rejected and the TV falls
 * back to the factory default of 3 minutes — which feels like "1–2 minutes".
 * Source: /etc/palm/description.json valueCheck + Settings UI labels.
 */
const SCREEN_SAVER_TIMER_ALLOWED = [3, 10, 20, 30];
/** Energy-saving "turn screen off" uses a different enum. */
const SCREEN_OFF_TIME_ALLOWED = [5, 10, 30, 60, 120];

/**
 * Snap a requested minute value to the nearest allowed enum entry.
 * @param {number} minutes
 * @param {number[]} allowed
 * @returns {number}
 */
function snapToAllowedMinutes(minutes: number | string | boolean, allowed: number[]): number {
  let n = Math.round(Number(minutes));
  if (isNaN(n) || n < 1) n = allowed[0];
  let best = allowed[0];
  let bestDist = Math.abs(n - best);
  for (let i = 1; i < allowed.length; i += 1) {
    const d = Math.abs(n - allowed[i]);
    if (d < bestDist || (d === bestDist && allowed[i] > best)) {
      best = allowed[i];
      bestDist = d;
    }
  }
  return best;
}

/**
 * Map an Ember "screensaver after N minutes" choice to a valid
 * screenSaverTimer enum value. 0 / off → null (caller disables via
 * screenSaverEnabled).
 * @param {number|string|boolean} minutes
 * @returns {number|null}
 */
function normalizeScreensaverMinutes(minutes: number | string | boolean): number | null {
  if (minutes === 0 || minutes === '0' || minutes === 'off' || minutes === false) {
    return null;
  }
  return snapToAllowedMinutes(minutes, SCREEN_SAVER_TIMER_ALLOWED);
}

/**
 * Set the LG webOS screensaver idle timeout (minutes), or disable it.
 *
 * On rooted TVs we write /var/luna/preferences/option *and* keep the sibling
 * .md5 in sync (SettingsService ignores or reverts prefs when the checksum
 * is stale). screenSaverTimer and screenOffTime use *different* allowed
 * enums — writing the same invalid number to both (e.g. 15) is ignored and
 * the panel blanks on the factory 3‑minute default.
 *
 * @param {number|string} minutes  minutes (snapped to 3/10/20/30), or 0 / 'off'
 */
export function setScreensaverTimeout(minutes: number | string) {
  const snapped = normalizeScreensaverMinutes(minutes);
  const enabled = snapped != null;
  // Keep timer at max when disabled so a later re-enable is not short.
  const saverVal = enabled ? String(snapped) : '30';
  // screenOffTime must be a valid energy-saving enum and should not blank
  // the panel before the gallery screensaver would fire.
  let offMinutes: number = enabled ? (snapped as number) : 120;
  // Prefer the smallest allowed screenOffTime that is >= screensaver minutes.
  let offVal: string | number = SCREEN_OFF_TIME_ALLOWED[SCREEN_OFF_TIME_ALLOWED.length - 1];
  for (let i = 0; i < SCREEN_OFF_TIME_ALLOWED.length; i += 1) {
    if (SCREEN_OFF_TIME_ALLOWED[i] >= offMinutes) {
      offVal = String(SCREEN_OFF_TIME_ALLOWED[i]);
      break;
    }
  }
  offVal = String(offVal);
  const enabledVal = enabled ? 'on' : 'off';

  // Single python block: option + md5 + general + best-effort Luna notify.
  const py =
    'python3 -c \'' +
    'import json,hashlib,subprocess\n' +
    'def wp(path,fn):\n' +
    ' d=json.load(open(path))\n' +
    ' fn(d)\n' +
    ' o=json.dumps(d,separators=(",",":"),ensure_ascii=False)\n' +
    ' open(path,"w").write(o)\n' +
    ' h=hashlib.md5(o.encode()).hexdigest()\n' +
    ' open(path+".md5","w").write("%s  %s\\n"%(h,path))\n' +
    ' return d\n' +
    'sv="' + saverVal + '"\n' +
    'ov="' + offVal + '"\n' +
    'en="' + enabledVal + '"\n' +
    'def uo(d):\n' +
    ' d["screenSaverTimer"]=sv\n' +
    ' d["checkChangedScreenSaverTimerByUser"]="user"\n' +
    ' d["screenOffTime"]=ov\n' +
    ' d["screenOff"]="off"\n' +
    ' d["screenSaverArtEnabled"]="off"\n' +
    ' d["artisticDisplayTimer"]="off"\n' +
    'd=wp("/var/luna/preferences/option",uo)\n' +
    'def ug(d):\n' +
    ' d["screenSaverEnabled"]=en\n' +
    'wp("/var/luna/preferences/general",ug)\n' +
    'payload=json.dumps({"category":"option","settings":{' +
    '"screenSaverTimer":sv,"screenOffTime":ov,' +
    '"checkChangedScreenSaverTimerByUser":"user"}})\n' +
    'try:\n' +
    ' subprocess.call(["luna-send","-n","1","luna://com.webos.settingsservice/setSystemSettings",payload],timeout=4)\n' +
    'except Exception:\n' +
    ' pass\n' +
    'payload2=json.dumps({"category":"general","settings":{"screenSaverEnabled":en}})\n' +
    'try:\n' +
    ' subprocess.call(["luna-send","-n","1","luna://com.webos.settingsservice/setSystemSettings",payload2],timeout=4)\n' +
    'except Exception:\n' +
    ' pass\n' +
    'print("ok",d.get("screenSaverTimer"),d.get("screenOffTime"),en)\n' +
    '\'';

  return execRoot(py, TIMEOUTS.rootScreensaver).then(function (res) {
    const out = readExecStdout(res);
    if (out.indexOf('ok') < 0) {
      return {returnValue: false, value: saverVal, enabled: enabled, out: out};
    }
    return {returnValue: true, value: saverVal, enabled: enabled, out: out};
  }).catch(function () {
    return {returnValue: false, value: saverVal, enabled: enabled};
  });
}

/**
 * Set the system volume through root luna-send. The last resort when every
 * in-app audio service refuses (stubborn firmware). Resolves with
 * `{returnValue, via: 'root'}` or `{returnValue: false}`.
 */
export function setVolumeAsRoot(level: number | string): Promise<{returnValue: boolean; via?: string}> {
  let n = Math.round(Number(level));
  if (isNaN(n)) n = 0;
  if (n < 0) n = 0;
  if (n > 100) n = 100;
  return execRoot(
    'luna-send -n 1 -f luna://com.webos.audio/setVolume \'{"volume":' + n + '}\' 2>/dev/null; ' +
    'luna-send -n 1 -f luna://com.webos.service.audio/setVolume \'{"volume":' + n + '}\' 2>/dev/null; true',
    TIMEOUTS.rootDefault
  ).then(function () {
    return {returnValue: true, via: 'root'};
  }).catch(function () {
    return {returnValue: false};
  });
}

const PREVIEW_FLAG_FILE = BRAND.tmpPrefix + '-preview-ss';

/**
 * Read and remove the one-shot screensaver preview flag (written by install or
 * SSH). Resolves true when it asked for a preview, false otherwise.
 */
export function takePreviewFlag(): Promise<boolean> {
  const cmd =
    'if [ -f ' + shQuote(PREVIEW_FLAG_FILE) + ' ]; then cat ' + shQuote(PREVIEW_FLAG_FILE) +
    '; rm -f ' + shQuote(PREVIEW_FLAG_FILE) + '; fi';
  return execRoot(cmd, TIMEOUTS.rootDefault).then(function (res) {
    const text = readExecStdout(res);
    return text === '1' || text === 'preview' || text.indexOf('1') === 0;
  }).catch(function () {
    return false;
  });
}

/** Append a line of text to a file as root (the saved TV check report). */
export async function appendRootFile(path: string, text: string): Promise<void> {
  await execRoot("printf '%s\\n' " + shQuote(text) + ' >> ' + shQuote(path), TIMEOUTS.rootDefault);
}
