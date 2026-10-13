/**
 * The single source of the app's identity: its names, ids, storage keys, TV
 * paths and root-hook names. Everything else derives from here — the TypeScript
 * modules import this file, scripts/build.ts stamps the manifests from it, and
 * scripts/generate-brand.ts writes scripts/brand.sh and voice/daemon/brand.py
 * for the shipped shell scripts and the Python daemon.
 *
 * Do not edit brand.sh or brand.py by hand: run `npm run brand`.
 * test/brand.test.ts fails when they drift from this file.
 */

// The file-name slug behind the paths, root hooks and the voice service name.
// Renaming the app's filesystem footprint starts here.
const SLUG = 'ember';
// The localStorage namespace (the config, apps, weather… keys).
const STORAGE_PREFIX = 'ember';

const NAME = 'Ember';
const APP_ID = 'com.ember.launcher';
const VOICE_APP_ID = 'com.ember.voice';

const APPS_DIR = '/media/developer/apps/usr/palm/applications';
const APP_DIR = APPS_DIR + '/' + APP_ID;
const CONFIG_DIR = '/home/root/.config/' + SLUG;

export const BRAND = {
  name: NAME,
  voiceName: NAME + ' Voice',
  tagline: 'Warm, bright, yours.',
  voiceTagline: 'Voice answers for ' + NAME,
  vendor: 'ember',

  appId: APP_ID,
  voiceAppId: VOICE_APP_ID,
  slug: SLUG,

  // Where the app and its two config folders live on the TV.
  appDir: APP_DIR,
  appsDir: APPS_DIR,
  voiceCardDir: APPS_DIR + '/' + VOICE_APP_ID,
  configDir: CONFIG_DIR,
  voiceConfigDir: CONFIG_DIR + '-voice',
  initdDir: '/var/lib/webosbrew/init.d',
  // /tmp/ember-* names are built as tmpPrefix + '-…'.
  tmpPrefix: '/tmp/' + SLUG,
  voiceSocket: '/var/run/' + SLUG + '-voice.sock',

  // The voice daemon's "hello" service name, the backup file's kind, and the
  // marker luna.js splits multi-file root reads on.
  voiceServiceName: SLUG + '-voice',
  backupKind: SLUG + '-settings',
  fileMark: '@@' + SLUG + '-file@@',

  storagePrefix: STORAGE_PREFIX,
  storage: {
    config: STORAGE_PREFIX + '.config.v1',
    apps: STORAGE_PREFIX + '.apps.v1',
    appIcons: STORAGE_PREFIX + '.appIcons.v1',
    weather: STORAGE_PREFIX + '.weather.v1',
    channels: STORAGE_PREFIX + '.channels.v1',
    lastRunVersion: STORAGE_PREFIX + '.lastRunVersion',
    backupLast: STORAGE_PREFIX + '.backup.last'
  },

  // Filenames under initdDir.
  hooks: {
    homeWatcher: '40-' + SLUG + '-watcher',
    voice: '45-' + SLUG + '-voice',
    boot: '50-' + SLUG + '-boot'
  },

  // Names from earlier identities. The app id and config/USB locations let a
  // first start read Launch Home's settings backups; the namespace, voice id,
  // init.d hooks and /tmp prefixes are for dock filtering and hook cleanup.
  legacy: {
    appId: 'org.webosbrew.lounge.launcher',
    appIdNamespace: 'org.webosbrew.lounge.',
    voiceAppId: 'org.webosbrew.lounge.voice',
    configDir: '/home/root/.config/launch-home',
    usbFolder: 'lounge',
    usbSettingsFile: 'launch-home-settings.json',
    hooks: [
      '40-launch-home-watcher',
      '45-launch-home-voice',
      '50-launch-home-boot',
      '40-lounge-home',
      '50-lounge-boot'
    ],
    tmpPrefixes: ['/tmp/launch-home', '/tmp/lounge-home']
  },

  // On a USB drive.
  usbFolder: 'ember',
  usbSettingsFile: SLUG + '-settings.json'
} as const;

export type Brand = typeof BRAND;

/**
 * The id namespace this app owns (its own apps and the voice card), used to
 * keep them out of the dock.
 */
export const BRAND_ID_NAMESPACE = APP_ID.slice(0, APP_ID.lastIndexOf('.') + 1);
