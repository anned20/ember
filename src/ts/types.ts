// Shared domain vocabulary for Launch Home.
//
// Cross-module shapes live here: the settings/config tree, the app record and
// catalog shapes, backup fit/restore results, music tracks, and the ambient
// webOS device globals plus the `__LOUNGE_VERSION__` build define. Module-local
// types stay with their module.

/* -------------------------------------------------------------------------- */
/* Backgrounds, music, weather, launcher config                                */
/* -------------------------------------------------------------------------- */

export interface AerialBackground {
  id: string;
  title: string;
  url: string;
}

/** A packaged background from assets/backgrounds/manifest.json. */
export interface BuiltinBackground {
  id: string;
  title: string;
  file: string;
}

/** A curated online wallpaper (see REMOTE_BACKGROUNDS). */
export interface RemoteBackground {
  id: string;
  title: string;
  url: string;
}

export interface BackgroundConfig {
  source: string;
  mode: string;
  preset: string;
  builtin: string;
  remote: string;
  aerial: string;
  url: string;
  urls: string[];
  path: string;
  file: string;
  slideshowIntervalSec: number;
  overlayOpacity: number;
  kenBurns: boolean;
  shuffle: boolean;
}

export interface MusicConfig {
  enabled: boolean;
  source: string;
  builtin: string;
  builtinPlaylist: string[];
  path: string;
  usbPlaylist: string[];
  shuffle: boolean;
  repeat: string;
  volume: number;
  fadeSec: number;
  pauseOnLaunch: boolean;
  resumeOnReturn: boolean;
  showBar: boolean;
}

export interface WeatherLocation {
  name: string;
  latitude: number;
  longitude: number;
  countryCode: string;
}

export interface WeatherConfig {
  enabled: boolean;
  units: string;
  location: WeatherLocation;
}

/** A user-added app tile (Settings → Apps → Add an app). */
export interface CustomApp {
  id: string;
  launchId?: string;
  title: string;
  icon: string;
}

export interface LauncherConfig {
  pinnedApps: string[];
  customApps: CustomApp[];
  inputs: string[];
  inputLabels: Record<string, string>;
  addedInputs: string[];
  channels: string;
  showClock: boolean;
  showDate: boolean;
  clockFormat: string;
  glassTint: string;
  glassBorder: string;
  focusColour: string;
  allAppsTile: boolean;
  numberKeyLaunch: boolean;
  clockAlign: string;
  clockSize: string;
  timezone: string;
  iconSize: string;
  iconAlign: string;
  iconLayout: string;
  iconsPerRow: number;
  bundledIcons: boolean;
  perfMode: boolean;
  bootOnStart: boolean;
  returnOnAppExit: boolean;
  launchOnHome: boolean;
  voiceEnabled: boolean;
  volumeAtHome: number | null;
  volumeOnAppLaunch: number | null;
  screensaverMinutes: number;
  customScreensaver: boolean;
  customScreensaverMinutes: number;
  customScreensaverSlideSec: number;
  customScreensaverShowClock: boolean;
  customScreensaverShowDate: boolean;
  terminalChecked?: boolean;
}

export type DeepPartial<T> = T extends Array<unknown>
  ? T
  : T extends object
    ? {[K in keyof T]?: DeepPartial<T[K]>}
    : T;

export interface Config {
  version: number;
  profile: string;
  profiles: Record<string, DeepPartial<Config>>;
  background: BackgroundConfig;
  music: MusicConfig;
  weather: WeatherConfig;
  launcher: LauncherConfig;
}

/* -------------------------------------------------------------------------- */
/* App records and catalog                                                     */
/* -------------------------------------------------------------------------- */

export interface AppRecord {
  id: string;
  launchId?: string;
  title: string;
  icon: string;
}

/** Normalized installed-app catalog, keyed by app id. */
export type AppCatalog = Record<string, AppRecord>;

/* -------------------------------------------------------------------------- */
/* USB / music tracks                                                          */
/* -------------------------------------------------------------------------- */

export interface UsbTrack {
  url: string;
  title: string;
  artist: string;
}

export interface MusicTrack extends UsbTrack {
  urls?: string[];
  description?: string;
  id?: string;
  file?: string;
}

/** A packaged track from assets/music/manifest.json. */
export interface BuiltinMusicEntry {
  id: string;
  title: string;
  artist: string;
  file: string;
  description?: string;
}

/* -------------------------------------------------------------------------- */
/* Backup fit / restore                                                        */
/* -------------------------------------------------------------------------- */

export type BackupSkipReason = 'type' | 'newer';

export interface BackupSkip {
  path: string;
  why: BackupSkipReason;
}

export interface BackupFitResult {
  config: Config;
  skipped: BackupSkip[];
  schema: number;
  newer: boolean;
  older: boolean;
}

/** Callback registered with voice-ws addVoiceListener. */
export type VoiceListener = (eventName: string, payload: Record<string, any>) => void;

/* -------------------------------------------------------------------------- */
/* webOS device globals + build define                                         */
/* -------------------------------------------------------------------------- */

/** Luna responses are untyped payloads; callers read fields by name. */
export type LunaResponse = Record<string, any>;

export interface WebOSServiceRequestOptions {
  method: string;
  parameters?: Record<string, unknown>;
  onSuccess?: (res: LunaResponse) => void;
  onFailure?: (err: unknown) => void;
}

export interface WebOSServiceHandle {
  cancel?: () => void;
}

export interface WebOSService {
  request(uri: string, options: WebOSServiceRequestOptions): WebOSServiceHandle;
}

export interface WebOS {
  service: WebOSService;
  deviceInfo?: (cb: (info: LunaResponse) => void) => void;
}

export interface PalmSystem {
  launchParams?: string;
}

export interface WebOSSystem {
  launchParams?: string;
}

declare global {
  /** Injected by esbuild (`scripts/build.ts`) and vitest's `define`. */
  const __LOUNGE_VERSION__: string;

  interface Window {
    webOS?: WebOS;
    PalmSystem?: PalmSystem;
    webOSSystem?: WebOSSystem;
  }
}
