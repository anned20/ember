import {normalizeBackgroundConfig} from '@background/backgrounds.js';
import {normalizeMusicConfig} from '@music/builtin-music.js';
import {BRAND} from '@lib/brand.js';
import type {TranslationKey} from '@lib/i18n.js';
import type {BackgroundConfig, BackupFitResult, BackupSkip, Config, MusicConfig} from '@lib/types.js';

const STORAGE_KEY = BRAND.storage.config;

// Layout version of the settings (config.version). Changing what a setting
// means, its type or its name? Bump this and add an entry to CONFIG_MIGRATIONS
// keyed by the new version: stored settings and restored backups from older
// versions both run through those steps (see migrateConfig / configFromBackup).
export const CONFIG_SCHEMA_VERSION = 29;

export const DEFAULT_CONFIG: Config = {
  version: CONFIG_SCHEMA_VERSION,
  profile: 'default',
  profiles: {},
  background: {
    source: 'builtin',
    mode: 'static',
    preset: 'warm-gradient',
    builtin: 'azure-cove',
    // Curated remote catalog id (see REMOTE_BACKGROUNDS); used when source is "url".
    remote: 'remote-01-cliff-ocean',
    // Selected Apple aerial clip (see AERIAL_BACKGROUNDS); used when source is "aerial".
    aerial: 'aerial-apple-east-asia',
    url: '',
    urls: [],
    path: '',
    file: '',
    slideshowIntervalSec: 300,
    overlayOpacity: 0.45,
    kenBurns: false,
    // Aerial Slideshow: randomise the clip order instead of catalog order.
    shuffle: false
  },
  music: {
    enabled: true,
    source: 'builtin',
    builtin: 'midnight-lounge',
    // Subset of packaged track ids to rotate; empty = all built-ins.
    builtinPlaylist: [],
    path: '',
    // Subset of USB track urls; empty = all tracks found in the folder.
    usbPlaylist: [],
    shuffle: false,
    repeat: 'all',
    volume: 0.35,
    fadeSec: 2,
    pauseOnLaunch: true,
    resumeOnReturn: true,
    // Track-title chip next to volume (full “music bar”). Off by default.
    showBar: false
  },
  // Home-screen forecast (Open-Meteo). Location defaults to City of London,
  // like the Atmosphere Android app; change it in Settings → Weather.
  weather: {
    style: 'card',
    units: 'c',
    location: {
      name: 'City of London, UK',
      latitude: 51.5123,
      longitude: -0.0907,
      countryCode: 'GB'
    }
  },
  launcher: {
    // Interface language: 'auto' follows the TV (nl* → Dutch, de* → German,
    // fr* → French, else English), or a fixed 'en' / 'nl' / 'de' / 'fr'. A
    // normal config field: the deep-merge in loadConfig gives it to an older
    // config, no migration needed.
    language: 'auto',
    pinnedApps: [
      'netflix', 'amazon.html', 'youtube.leanback.v4', 'com.apple.appletv',
      'bbc.iplayer.lge', 'com.webos.app.browser', 'com.webos.app.mediadiscovery'
    ],
    customApps: [],
    inputs: ['HDMI_1', 'HDMI_2', 'HDMI_3', 'TV'],
    inputLabels: {},
    // Inputs added by hand (Settings -> Inputs & channels -> Add an input)
    // for ports the TV didn't list.
    addedInputs: [],
    // Channels chip: 'favourites' (LG's, or all when none), 'all' or 'off'.
    channels: 'favourites',
    showClock: true,
    showDate: true,
    // Wi-Fi/Ethernet and internet chip next to the Settings gear.
    showNetworkStatus: true,
    // '24' (18:30) or '12' (6:30 PM), home screen and screensaver.
    clockFormat: '24',
    // Glass colour of the app tiles, inputs and Settings button: light (the
    // original), dark, black, blue, purple, green or warm (main.css).
    glassTint: 'light',
    // Their outline: white (the original), glass (same colour as the glass),
    // none, black, blue, purple, green, warm or gold.
    glassBorder: 'white',
    // App tiles: glass (the original card) or plain (icon and name, no card).
    tileStyle: 'glass',
    // Ring around what the remote is on, and the current-input marker: warm
    // (the original), white, border (same as glassBorder), blue, purple,
    // green or gold.
    focusColour: 'warm',
    // All apps tile on the home row (opens the grid of every app on the TV).
    allAppsTile: true,
    // TV Settings shortcut tile at the end of the home row.
    tvSettingsTile: true,
    // Remote number keys (1-9) open the home row tile at that position.
    numberKeyLaunch: true,
    // Clock placement: left | center (top) | center-middle | right.
    // right leaves room for the settings gear; center-middle is screen centre.
    clockAlign: 'center',
    // Clock type size: small | medium | large | x-large | xx-large.
    clockSize: 'large',
    // Clock shadow for legibility over light wallpapers: off | soft | strong.
    clockShadow: 'strong',
    timezone: '',
    iconSize: 'medium',
    iconAlign: 'center',
    iconLayout: 'scroll',
    iconsPerRow: 7,
    // Bundled Ember icons for known apps; false = the TV's own icons.
    bundledIcons: true,
    perfMode: false,
    bootOnStart: false,
    returnOnAppExit: false,
    // When true, press of the Home button (stock home coming to the
    // foreground after another app) relaunches Ember. Off by default.
    launchOnHome: false,
    // TV system volume (0–100) while Ember is in the foreground.
    // null = don't change it (new installs); existing configs keep their level.
    volumeAtHome: null,
    // TV system volume (0–100) when launching another app / input. null = don't change.
    volumeOnAppLaunch: null,
    // System LG gallery screensaver wait (enum 3/10/20/30 only). 0 = off.
    // When customScreensaver is on, Ember pushes this to 30 so the
    // system saver does not interrupt the in-app slideshow first.
    screensaverMinutes: 30,
    // In-app Ember screensaver (slideshow + clock while on home).
    customScreensaver: true,
    customScreensaverMinutes: 5,
    customScreensaverSlideSec: 20,
    // Show the home clock/date/weather block in the saver.
    customScreensaverInfo: true
  }
};

/** Valid gallery screensaver wait times on recent webOS OLEDs. */
export const SCREENSAVER_MINUTES_ALLOWED = [3, 10, 20, 30];

/**
 * Snap a stored/UI minutes value to a valid TV enum (or 0 for off).
 * @param {unknown} minutes
 * @returns {number}
 */
export function coerceScreensaverMinutes(minutes: unknown): number {
  if (minutes === 0 || minutes === '0' || minutes === 'off' || minutes === false) {
    return 0;
  }
  let n = Math.round(Number(minutes));
  if (isNaN(n) || n < 1) return 20;
  // Legacy Launch Home values that the TV rejects.
  if (n === 5) return 3;
  if (n === 15) return 10;
  if (n === 60 || n > 30) return 30;
  let best = SCREENSAVER_MINUTES_ALLOWED[0];
  let bestDist = Math.abs(n - best);
  for (let i = 1; i < SCREENSAVER_MINUTES_ALLOWED.length; i += 1) {
    const d = Math.abs(n - SCREENSAVER_MINUTES_ALLOWED[i]);
    if (d < bestDist) {
      best = SCREENSAVER_MINUTES_ALLOWED[i];
      bestDist = d;
    }
  }
  return best;
}

// The label is a dictionary key: the pane translates it, the value is stored.
export const TIMEZONE_OPTIONS: Array<{value: string; labelKey: TranslationKey}> = [
  {value: '', labelKey: 'look.timezone.local'},
  {value: 'America/Los_Angeles', labelKey: 'look.timezone.pacific-us'},
  {value: 'America/Denver', labelKey: 'look.timezone.mountain-us'},
  {value: 'America/Chicago', labelKey: 'look.timezone.central-us'},
  {value: 'America/New_York', labelKey: 'look.timezone.eastern-us'},
  {value: 'America/Anchorage', labelKey: 'look.timezone.alaska-us'},
  {value: 'Pacific/Honolulu', labelKey: 'look.timezone.hawaii-us'},
  {value: 'America/Toronto', labelKey: 'look.timezone.eastern-ca'},
  {value: 'America/Vancouver', labelKey: 'look.timezone.pacific-ca'},
  {value: 'Europe/London', labelKey: 'look.timezone.london'},
  {value: 'Europe/Paris', labelKey: 'look.timezone.paris'},
  {value: 'Europe/Berlin', labelKey: 'look.timezone.berlin'},
  {value: 'Europe/Helsinki', labelKey: 'look.timezone.helsinki'},
  {value: 'Asia/Tokyo', labelKey: 'look.timezone.tokyo'},
  {value: 'Asia/Seoul', labelKey: 'look.timezone.seoul'},
  {value: 'Asia/Singapore', labelKey: 'look.timezone.singapore'},
  {value: 'Australia/Sydney', labelKey: 'look.timezone.sydney'},
  {value: 'UTC', labelKey: 'look.timezone.utc'}
];

function deepMerge<T>(target: unknown, source: unknown): T {
  const out: Record<string, unknown> = Object.assign({}, target);
  if (!source || typeof source !== 'object') return out as T;

  for (const key of Object.keys(source as Record<string, unknown>)) {
    const value = (source as Record<string, unknown>)[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = deepMerge(out[key] || {}, value);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

/** One settings migration: brings a config up to a single schema version. */
export type ConfigMigration = (config: Config) => void;

/**
 * Settings migrations, keyed by the schema version they bring a config up to.
 * migrateConfig runs the entries above the stored version, in ascending order;
 * each entry assumes the ones before it have run. Exported so a test can drive
 * a single step in isolation.
 */
export const CONFIG_MIGRATIONS: Record<number, ConfigMigration> = {
  // v2: put Amazon next to Netflix on the home row.
  2: function addAmazonTile(config) {
    const pinned = config.launcher.pinnedApps || [];
    if (pinned.indexOf('amazon.html') < 0) {
      const netflixIndex = pinned.indexOf('netflix');
      if (netflixIndex >= 0) {
        pinned.splice(netflixIndex + 1, 0, 'amazon.html');
      } else {
        pinned.unshift('amazon.html');
      }
      config.launcher.pinnedApps = pinned;
    }
  },

  // v3: music gained a source and a default built-in track.
  3: function normalizeMusicSource(config) {
    config.music = normalizeMusicConfig(config.music);
    if (!config.music.source) {
      config.music.source = config.music.path ? 'usb' : 'builtin';
    }
    if (!config.music.builtin) {
      config.music.builtin = 'midnight-lounge';
    }
  },

  // v4: drop the dead Breezyfin app; add the timezone setting.
  4: function dropBreezyfinAddTimezone(config) {
    config.launcher.pinnedApps = (config.launcher.pinnedApps || []).filter(function (id: string) {
      return id !== 'com.breezyfin.app';
    });
    if (config.launcher.timezone === undefined) {
      config.launcher.timezone = '';
    }
  },

  // v5: "repeat one" was dropped.
  5: function dropRepeatOne(config) {
    if (config.music && config.music.repeat === 'one') {
      config.music.repeat = 'all';
    }
  },

  // v6: Apple TV joins the home row.
  6: function addAppleTvTile(config) {
    const pinned = config.launcher.pinnedApps || [];
    if (pinned.indexOf('com.apple.appletv') < 0) {
      pinned.push('com.apple.appletv');
    }
    config.launcher.pinnedApps = pinned;
  },

  // v7: iPlayer, the browser and Media Discovery join the home row.
  7: function addStreamingTiles(config) {
    const pinned = config.launcher.pinnedApps || [];
    ['bbc.iplayer.lge', 'com.webos.app.browser', 'com.webos.app.mediadiscovery'].forEach(function (id) {
      if (pinned.indexOf(id) < 0) pinned.push(id);
    });
    config.launcher.pinnedApps = pinned;
  },

  // v8: drop the stock LG channels, Live TV and Wuaki tiles.
  8: function dropStockTiles(config) {
    config.launcher.pinnedApps = (config.launcher.pinnedApps || []).filter(function (id: string) {
      return id !== 'com.webos.app.lgchannels' && id !== 'com.webos.app.livetv' && id !== 'tv.wuaki';
    });
  },

  // v9: icon size.
  9: function addIconSize(config) {
    if (!config.launcher.iconSize) {
      config.launcher.iconSize = 'medium';
    }
  },

  // v10: show/hide the date.
  10: function addShowDate(config) {
    if (config.launcher.showDate === undefined) {
      config.launcher.showDate = true;
    }
  },

  // v11: icon alignment.
  11: function addIconAlign(config) {
    if (!config.launcher.iconAlign) {
      config.launcher.iconAlign = 'center';
    }
  },

  // v12: user-added app tiles.
  12: function addCustomApps(config) {
    if (!Array.isArray(config.launcher.customApps)) {
      config.launcher.customApps = [];
    }
  },

  // v13: performance mode.
  13: function addPerfMode(config) {
    if (typeof config.launcher.perfMode !== 'boolean') {
      config.launcher.perfMode = false;
    }
  },

  // v14: icon layout (wrap/scroll) and icons per row.
  14: function addIconLayout(config) {
    if (config.launcher.iconLayout !== 'wrap' && config.launcher.iconLayout !== 'scroll') {
      config.launcher.iconLayout = 'scroll';
    }
    if (typeof config.launcher.iconsPerRow !== 'number') {
      config.launcher.iconsPerRow = 7;
    }
  },

  // v15: launchOnHome. Seed it from the old returnOnAppExit preference so users
  // who already opted into home-intercept keep that behaviour.
  15: function addLaunchOnHome(config) {
    if (typeof config.launcher.launchOnHome !== 'boolean') {
      config.launcher.launchOnHome = !!config.launcher.returnOnAppExit;
    }
  },

  // v16: slimmed built-in music (8 tracks) + optional playlists.
  16: function addMusicPlaylists(config) {
    if (!Array.isArray(config.music.builtinPlaylist)) {
      config.music.builtinPlaylist = [];
    }
    if (!Array.isArray(config.music.usbPlaylist)) {
      config.music.usbPlaylist = [];
    }
    // Drop start-track if it was removed from the package.
    const kept: Record<string, number> = {
      'midnight-lounge': 1,
      'starlight-drift': 1,
      'ocean-haze': 1,
      'warm-glow': 1,
      'backbay-lounge': 1,
      'chill-wave': 1
    };
    if (!kept[config.music.builtin]) {
      config.music.builtin = 'midnight-lounge';
    }
  },

  // v17: re-enable ambient music if it was left off; add the music-bar flag.
  17: function reenableMusic(config) {
    if (!config.music) config.music = {} as MusicConfig;
    config.music.enabled = true;
    config.music.source = config.music.source || 'builtin';
    if (typeof config.music.showBar !== 'boolean') {
      config.music.showBar = false;
    }
    if (typeof config.music.volume !== 'number' || config.music.volume < 0.2) {
      config.music.volume = 0.35;
    }
    // Cinema profile still disables music via profile overlay when selected.
    if (config.profile === 'cinema') {
      config.profile = 'default';
    }
  },

  // v18: TV volume levels. Left at null ("Don't change") so an upgrade never
  // starts overriding the volume set with the remote.
  18: function addVolumeLevels() {},

  // v19: the system screensaver wait.
  19: function addScreensaverMinutes(config) {
    if (typeof config.launcher.screensaverMinutes !== 'number') {
      config.launcher.screensaverMinutes = 20;
    }
  },

  // v20: webOS only accepts screenSaverTimer ∈ {3,10,20,30}. Older builds
  // defaulted to 15 / offered 5 & 60, which the TV silently rejected → 3 min.
  20: function coerceScreensaverWait(config) {
    config.launcher.screensaverMinutes = coerceScreensaverMinutes(
      config.launcher.screensaverMinutes
    );
  },

  // v21: in-app Ember screensaver.
  21: function addCustomScreensaver(config) {
    if (typeof config.launcher.customScreensaver !== 'boolean') {
      config.launcher.customScreensaver = true;
    }
    if (typeof config.launcher.customScreensaverMinutes !== 'number') {
      config.launcher.customScreensaverMinutes = 5;
    }
    if (typeof config.launcher.customScreensaverSlideSec !== 'number') {
      config.launcher.customScreensaverSlideSec = 20;
    }
    // Keep system saver out of the way while the in-app one runs.
    if (config.launcher.customScreensaver &&
        config.launcher.screensaverMinutes > 0 &&
        config.launcher.screensaverMinutes < 30) {
      config.launcher.screensaverMinutes = 30;
    }
  },

  // v22: remote number keys open the home row tile at that position.
  22: function addNumberKeyLaunch(config) {
    if (typeof config.launcher.numberKeyLaunch !== 'boolean') {
      config.launcher.numberKeyLaunch = true;
    }
  },

  // v23: Apple aerial-video background source (selected clip id).
  23: function addAerialClip(config) {
    if (!config.background) config.background = {} as BackgroundConfig;
    if (!config.background.aerial) {
      config.background.aerial = 'aerial-apple-east-asia';
    }
  },

  // v24: shuffle toggle for the aerial Slideshow.
  24: function addAerialShuffle(config) {
    if (!config.background) config.background = {} as BackgroundConfig;
    if (typeof config.background.shuffle !== 'boolean') {
      config.background.shuffle = false;
    }
  },

  // v25: clock shadow, so bright wallpapers no longer wash the clock out.
  25: function addClockShadow(config) {
    if (['off', 'soft', 'strong'].indexOf(config.launcher.clockShadow) < 0) {
      config.launcher.clockShadow = 'strong';
    }
  },

  // v26: one weather style (card/inline/off) and one screensaver info switch.
  26: function weatherStyleAndScreensaverInfo(config) {
    const weather = config.weather as typeof config.weather & {enabled?: unknown};
    if (weather.enabled !== undefined) {
      weather.style = weather.enabled === false ? 'off' : 'card';
      delete weather.enabled;
    }

    const launcher = config.launcher as typeof config.launcher & {
      customScreensaverShowClock?: unknown;
      customScreensaverShowDate?: unknown;
    };
    if (launcher.customScreensaverShowClock !== undefined ||
        launcher.customScreensaverShowDate !== undefined) {
      launcher.customScreensaverInfo =
        launcher.customScreensaverShowClock !== false ||
        launcher.customScreensaverShowDate !== false;
      delete launcher.customScreensaverShowClock;
      delete launcher.customScreensaverShowDate;
    }
  },

  // v27: app tile style, so the glass card can give way to plain icons.
  27: function addTileStyle(config) {
    if (['glass', 'plain'].indexOf(config.launcher.tileStyle) < 0) {
      config.launcher.tileStyle = 'glass';
    }
  },

  // v28: the TV Settings shortcut tile on the home row can be turned off.
  28: function addTvSettingsTile(config) {
    if (typeof config.launcher.tvSettingsTile !== 'boolean') {
      config.launcher.tvSettingsTile = true;
    }
  },

  // v29: the home-screen network status chip.
  29: function addNetworkStatus(config) {
    if (typeof config.launcher.showNetworkStatus !== 'boolean') {
      config.launcher.showNetworkStatus = true;
    }
  }
};

/**
 * Repairs run on every load, not only on an upgrade: values a config can carry
 * at any version. v20's TV-accepted wait can drift after it was migrated.
 */
const CONFIG_REPAIRS: ConfigMigration[] = [
  function repairScreensaverWait(config) {
    if (typeof config.launcher.screensaverMinutes === 'number') {
      const coerced = coerceScreensaverMinutes(config.launcher.screensaverMinutes);
      if (coerced !== config.launcher.screensaverMinutes) {
        config.launcher.screensaverMinutes = coerced;
      }
    }
  },

  // A restored or hand-edited config can disagree with itself. Drop a pinned
  // custom: id whose Custom app record is gone (it shows as a nameless tile)
  // and exact duplicate pinned ids (they show as two tiles for one app).
  function repairDock(config) {
    const launcher = config.launcher;
    const customIds: Record<string, boolean> = {};
    (launcher.customApps || []).forEach(function (entry) {
      if (entry && entry.id) customIds[entry.id] = true;
    });
    const seen: Record<string, boolean> = {};
    launcher.pinnedApps = (launcher.pinnedApps || []).filter(function (id: unknown) {
      if (typeof id !== 'string' || seen[id]) return false;
      if (id.indexOf('custom:') === 0 && !customIds[id]) return false;
      seen[id] = true;
      return true;
    });
    // A Custom app record nobody pins is kept on purpose: no screen shows it,
    // and dropping it on load would delete stored data for no visible gain.
  }
];

/**
 * Bring settings saved by an older Launch Home up to CONFIG_SCHEMA_VERSION.
 * In memory only: the caller saves (loadConfig) or checks them first (a
 * restored backup). Migrations above the stored version run in order; a config
 * already at or past this version only gets the repairs.
 */
export function migrateConfig(config: Config): Config {
  const from = config.version || 1;
  for (let version = from + 1; version <= CONFIG_SCHEMA_VERSION; version += 1) {
    const step = CONFIG_MIGRATIONS[version];
    if (step) step(config);
  }
  if (from < CONFIG_SCHEMA_VERSION) config.version = CONFIG_SCHEMA_VERSION;
  CONFIG_REPAIRS.forEach(function (repair) { repair(config); });
  return config;
}

export function loadConfig(): Config {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const config = !raw
      ? deepMerge<Config>({}, DEFAULT_CONFIG)
      : deepMerge<Config>(DEFAULT_CONFIG, JSON.parse(raw));
    config.background = normalizeBackgroundConfig(config.background);
    config.music = normalizeMusicConfig(config.music);
    const before = JSON.stringify(config);
    migrateConfig(config);
    if (raw && JSON.stringify(config) !== before) saveConfig(config);
    return config;
  } catch (err) {
    const config = deepMerge<Config>({}, DEFAULT_CONFIG);
    config.background = normalizeBackgroundConfig(config.background);
    config.music = normalizeMusicConfig(config.music);
    return config;
  }
}

/** The settings text exactly as stored, before loadConfig() migrates it. */
export function readStoredConfigText(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || '';
  } catch (err) {
    return '';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// Settings that belong to this TV rather than to the person: a restore keeps
// the TV's own values. terminalChecked records what this TV has installed.
// An old config's voiceEnabled is not listed (Ember has no voice assistant any
// more) and is simply ignored.
const DEVICE_SETTINGS: string[][] = [['launcher', 'terminalChecked']];

function valueAt(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (let i = 0; i < path.length; i += 1) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[path[i]];
  }
  return cur;
}

function sameKind(value: unknown, def: unknown): boolean {
  if (def === null) return value === null || typeof value !== 'object';
  if (Array.isArray(def)) return Array.isArray(value);
  if (isPlainObject(def)) return isPlainObject(value);
  return typeof value === typeof def;
}

/**
 * `value` shaped like `def`: a setting of the wrong kind falls back to `cur`
 * (the TV's current value) when that fits, else to the default, and is noted
 * in `skipped` as {path, why: 'type'}. Settings this version doesn't have are
 * kept (it ignores them); from a newer backup (`noteUnknown`) they are noted
 * as {path, why: 'newer'}.
 */
function fitSettings(
  value: unknown,
  def: unknown,
  cur: unknown,
  path: string,
  noteUnknown: boolean,
  skipped: BackupSkip[]
): unknown {
  if (!isPlainObject(def) || !Object.keys(def).length) {
    if (value === undefined) return def;
    if (sameKind(value, def)) return value;
    skipped.push({path: path, why: 'type'});
    return cur !== undefined && sameKind(cur, def) ? cur : def;
  }
  if (!isPlainObject(value)) {
    if (value !== undefined) skipped.push({path: path, why: 'type'});
    return isPlainObject(cur) ? cur : def;
  }
  const out: Record<string, unknown> = {};
  Object.keys(value).forEach(function (key) {
    const sub = path ? path + '.' + key : key;
    if (Object.prototype.hasOwnProperty.call(def, key)) {
      out[key] = fitSettings(value[key], def[key], isPlainObject(cur) ? cur[key] : undefined,
        sub, noteUnknown, skipped);
    } else {
      if (noteUnknown) skipped.push({path: sub, why: 'newer'});
      out[key] = value[key];
    }
  });
  Object.keys(def).forEach(function (key) {
    if (!Object.prototype.hasOwnProperty.call(out, key)) out[key] = def[key];
  });
  return out;
}

/**
 * Settings -> Backup & restore: the settings in a backup, made to fit this
 * version of Ember. A backup from an older version runs through the same
 * migrations as stored settings; from a newer version, settings this version
 * doesn't have are kept but unused. Anything of the wrong kind keeps the TV's
 * current value, and this TV's own settings (DEVICE_SETTINGS) stay as they
 * are. Nothing is saved here.
 *
 * Returns {config, skipped: [{path, why: 'newer' | 'type'}], schema, newer,
 * older}, or null when `data` isn't Ember settings.
 */
export function configFromBackup(data: unknown, current: Config): BackupFitResult | null {
  if (!isPlainObject(data) || !isPlainObject(data.launcher)) return null;
  const schema = typeof data.version === 'number' ? data.version : 1;
  const newer = schema > CONFIG_SCHEMA_VERSION;
  const skipped: BackupSkip[] = [];
  // Work on a copy: migrations change what they are given.
  const merged = deepMerge<Config>(DEFAULT_CONFIG, JSON.parse(JSON.stringify(data)));
  if (!newer) migrateConfig(merged);
  const fitted = fitSettings(merged, DEFAULT_CONFIG, current, '', newer, skipped) as Config;
  fitted.version = CONFIG_SCHEMA_VERSION;
  fitted.background = normalizeBackgroundConfig(fitted.background);
  fitted.music = normalizeMusicConfig(fitted.music);
  DEVICE_SETTINGS.forEach(function (path) {
    const own = valueAt(current, path);
    const parent = valueAt(fitted, path.slice(0, -1));
    if (!isPlainObject(parent)) return;
    if (own === undefined) delete parent[path[path.length - 1]];
    else parent[path[path.length - 1]] = own;
  });
  return {
    config: fitted,
    skipped: skipped,
    schema: schema,
    newer: newer,
    older: schema < CONFIG_SCHEMA_VERSION
  };
}

export function saveConfig(config: Config): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function applyUsbConfig(config: Config, usbConfig: unknown): Config {
  return deepMerge<Config>(config, usbConfig);
}