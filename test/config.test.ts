import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
  CONFIG_MIGRATIONS, CONFIG_SCHEMA_VERSION, DEFAULT_CONFIG, configFromBackup, loadConfig, migrateConfig
} from '@config/config.js';
import {importLegacySettings, parseBackup} from '@settings/settings-backup.js';
import {BRAND} from '@lib/brand.js';
import type {Config} from '@lib/types.js';

/** A config tree at `version`, built on the current defaults. */
function configAt(version: number): Config {
  const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Config;
  config.version = version;
  return config;
}

describe('config migration registry', () => {
  it('keys a step by every version up to the schema version', () => {
    const keys = Object.keys(CONFIG_MIGRATIONS).map(Number).sort((a, b) => a - b);
    const expected: number[] = [];
    for (let v = 2; v <= CONFIG_SCHEMA_VERSION; v += 1) expected.push(v);
    expect(keys).toEqual(expected);
  });

  it('runs a single step in isolation', () => {
    const config = configAt(22);
    delete (config.background as Partial<Config['background']>).aerial;
    CONFIG_MIGRATIONS[23](config);
    expect(config.background.aerial).toBe('aerial-apple-east-asia');
  });

  it('backfills the clock shadow without overruling an explicit choice', () => {
    const missing = configAt(24);
    delete (missing.launcher as Partial<Config['launcher']>).clockShadow;
    migrateConfig(missing);
    expect(missing.launcher.clockShadow).toBe('strong');

    const chosen = configAt(24);
    chosen.launcher.clockShadow = 'off';
    migrateConfig(chosen);
    expect(chosen.launcher.clockShadow).toBe('off');
  });

  it('backfills the tile style without overruling an explicit choice (v27)', () => {
    const missing = configAt(26);
    delete (missing.launcher as Partial<Config['launcher']>).tileStyle;
    migrateConfig(missing);
    expect(missing.launcher.tileStyle).toBe('glass');

    const chosen = configAt(26);
    chosen.launcher.tileStyle = 'plain';
    migrateConfig(chosen);
    expect(chosen.launcher.tileStyle).toBe('plain');
  });

  it('backfills the TV Settings tile without overruling an explicit choice (v28)', () => {
    const missing = configAt(27);
    delete (missing.launcher as Partial<Config['launcher']>).tvSettingsTile;
    migrateConfig(missing);
    expect(missing.launcher.tvSettingsTile).toBe(true);

    const hidden = configAt(27);
    hidden.launcher.tvSettingsTile = false;
    migrateConfig(hidden);
    expect(hidden.launcher.tvSettingsTile).toBe(false);
  });

  it('backfills the network status chip without overruling an explicit choice (v29)', () => {
    const missing = configAt(28);
    delete (missing.launcher as Partial<Config['launcher']>).showNetworkStatus;
    migrateConfig(missing);
    expect(missing.launcher.showNetworkStatus).toBe(true);

    const hidden = configAt(28);
    hidden.launcher.showNetworkStatus = false;
    migrateConfig(hidden);
    expect(hidden.launcher.showNetworkStatus).toBe(false);
  });

  it('collapses the old weather and saver toggles into the new settings (v26)', () => {
    const off = configAt(25);
    delete (off.weather as Partial<Config['weather']>).style;
    (off.weather as Config['weather'] & {enabled?: boolean}).enabled = false;
    const offLauncher = off.launcher as Config['launcher'] & {
      customScreensaverShowClock?: boolean;
      customScreensaverShowDate?: boolean;
    };
    offLauncher.customScreensaverShowClock = false;
    offLauncher.customScreensaverShowDate = false;

    migrateConfig(off);

    expect(off.weather.style).toBe('off');
    expect('enabled' in off.weather).toBe(false);
    expect(off.launcher.customScreensaverInfo).toBe(false);
    expect('customScreensaverShowClock' in off.launcher).toBe(false);
    expect('customScreensaverShowDate' in off.launcher).toBe(false);

    const kept = configAt(25);
    delete (kept.weather as Partial<Config['weather']>).style;
    (kept.weather as Config['weather'] & {enabled?: boolean}).enabled = true;
    const keptLauncher = kept.launcher as Config['launcher'] & {
      customScreensaverShowClock?: boolean;
      customScreensaverShowDate?: boolean;
    };
    keptLauncher.customScreensaverShowClock = true;
    keptLauncher.customScreensaverShowDate = false;

    migrateConfig(kept);

    expect(kept.weather.style).toBe('card');
    expect(kept.launcher.customScreensaverInfo).toBe(true);
  });

  it('applies only the steps above the stored version, in order', () => {
    const config = configAt(22);
    delete (config.background as Partial<Config['background']>).aerial;
    (config.background as Partial<Config['background']>).shuffle = undefined;

    migrateConfig(config);

    expect(config.version).toBe(CONFIG_SCHEMA_VERSION);
    expect(config.background.aerial).toBe('aerial-apple-east-asia');
    expect(config.background.shuffle).toBe(false);
  });

  it('leaves a config already at the schema version alone', () => {
    const config = configAt(CONFIG_SCHEMA_VERSION);
    const before = JSON.stringify(config);
    migrateConfig(config);
    expect(JSON.stringify(config)).toBe(before);
  });

  it('backfills a v1 config through the whole chain', () => {
    const config = configAt(1);
    config.launcher.pinnedApps = ['netflix'];
    delete (config.launcher as Partial<Config['launcher']>).iconSize;

    migrateConfig(config);

    expect(config.version).toBe(CONFIG_SCHEMA_VERSION);
    // v2 slotted Amazon in right after Netflix.
    expect(config.launcher.pinnedApps.indexOf('amazon.html'))
      .toBe(config.launcher.pinnedApps.indexOf('netflix') + 1);
    expect(config.launcher.iconSize).toBe('medium');
  });
});

/** A settings backup written by Launch Home, before the Ember rename. */
const LEGACY_APP_ID = 'org.webosbrew.lounge.launcher';

function legacyBackupText(overrides: Record<string, unknown>, savedAt: string, version?: number): string {
  const config = Object.assign(JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Config, overrides);
  config.version = version || CONFIG_SCHEMA_VERSION;
  return JSON.stringify({
    app: LEGACY_APP_ID,
    kind: 'launch-home-settings',
    format: 1,
    appVersion: '0.1.1',
    schema: config.version,
    reason: 'manual',
    savedAt: savedAt,
    config: config
  });
}

describe('Launch Home backup compatibility', () => {
  it('reads a backup that carries the Launch Home app id', () => {
    const parsed = parseBackup(legacyBackupText({}, '2024-01-01T00:00:00Z'), 'USB');
    expect(parsed).not.toBeNull();
    expect(parsed?.appVersion).toBe('0.1.1');
  });

  it('still rejects a file that is not a settings backup', () => {
    expect(parseBackup(JSON.stringify({app: 'com.other.app', config: {}}), 'TV')).toBeNull();
  });
});

describe('first-run import', () => {
  it('imports the newest Launch Home backup on a fresh start', async () => {
    const result = await importLegacySettings('', DEFAULT_CONFIG, async () => [
      {where: 'TV', text: legacyBackupText({}, '2024-01-01T00:00:00Z')},
      {where: 'USB', text: legacyBackupText({launcher: {glassTint: 'dark'}}, '2024-06-01T00:00:00Z')}
    ]);
    expect(result?.launcher.glassTint).toBe('dark');
  });

  it('brings an old-schema backup forward through the migrations', async () => {
    const result = await importLegacySettings('', DEFAULT_CONFIG, async () => [
      {where: 'TV', text: legacyBackupText({launcher: {glassTint: 'blue'}}, '2024-01-01T00:00:00Z', 1)}
    ]);
    expect(result?.launcher.glassTint).toBe('blue');
    expect(result?.version).toBe(CONFIG_SCHEMA_VERSION);
  });

  it('fills the network status field in a backup that predates it', () => {
    const config = configAt(28);
    delete (config.launcher as Partial<Config['launcher']>).showNetworkStatus;

    const fit = configFromBackup(config, DEFAULT_CONFIG);

    expect(fit?.older).toBe(true);
    expect(fit?.config.launcher.showNetworkStatus).toBe(true);
  });

  it('does not import when Ember already has a stored config', async () => {
    const result = await importLegacySettings('{"version":' + CONFIG_SCHEMA_VERSION + '}', DEFAULT_CONFIG,
      async () => [{where: 'TV', text: legacyBackupText({}, '2024-06-01T00:00:00Z')}]);
    expect(result).toBeNull();
  });

  it('starts on defaults when there is no backup', async () => {
    expect(await importLegacySettings('', DEFAULT_CONFIG, async () => [])).toBeNull();
  });

  it('ignores a backup that has no Ember or Launch Home settings', async () => {
    const foreign = JSON.stringify({app: 'com.other.app', config: {launcher: {}}});
    expect(await importLegacySettings('', DEFAULT_CONFIG, async () => [{where: 'TV', text: foreign}])).toBeNull();
  });
});

describe('the Dock repair', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  function stored(launcher: Partial<Config['launcher']>): void {
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Config;
    Object.assign(config.launcher, launcher);
    localStorage.setItem(BRAND.storage.config, JSON.stringify(config));
  }

  it('drops a pinned custom: id whose Custom app record is gone', () => {
    stored({pinnedApps: ['netflix', 'custom:1-7'], customApps: []});
    expect(loadConfig().launcher.pinnedApps).toEqual(['netflix']);
  });

  it('keeps a custom: id that still has its record', () => {
    const custom = [{id: 'custom:1-7', launchId: 'com.foo.bar', title: 'Foo', icon: ''}];
    stored({pinnedApps: ['netflix', 'custom:1-7'], customApps: custom});
    expect(loadConfig().launcher.pinnedApps).toEqual(['netflix', 'custom:1-7']);
  });

  it('drops an exactly duplicated pinned id, keeping the first', () => {
    stored({pinnedApps: ['netflix', 'netflix', 'amazon.html']});
    expect(loadConfig().launcher.pinnedApps).toEqual(['netflix', 'amazon.html']);
  });

  it('keeps a Custom app record nobody pins', () => {
    const custom = [{id: 'custom:1-7', launchId: 'com.foo.bar', title: 'Foo', icon: ''}];
    stored({pinnedApps: ['netflix'], customApps: custom});

    const loaded = loadConfig();
    expect(loaded.launcher.customApps).toEqual(custom);
    expect(loaded.launcher.pinnedApps).toEqual(['netflix']);
  });

  it('repairs a restored backup too', () => {
    const backup = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Config;
    backup.launcher.pinnedApps = ['netflix', 'custom:gone', 'netflix'];

    const fitted = configFromBackup(backup, DEFAULT_CONFIG);
    expect(fitted!.config.launcher.pinnedApps).toEqual(['netflix']);
  });
});

describe('the Language setting', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('defaults to Automatic', () => {
    expect(DEFAULT_CONFIG.launcher.language).toBe('auto');
  });

  it('is filled in for a config stored before it existed, leaving the rest alone', () => {
    const stored = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Config;
    delete (stored.launcher as Partial<Config['launcher']>).language;
    stored.launcher.clockShadow = 'soft';
    localStorage.setItem(BRAND.storage.config, JSON.stringify(stored));

    const loaded = loadConfig();
    expect(loaded.launcher.language).toBe('auto');
    expect(loaded.launcher.clockShadow).toBe('soft');
  });

  it('travels with a backup', () => {
    const current = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Config;
    current.launcher.language = 'en';
    const backup = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Config;
    backup.launcher.language = 'nl';

    const fitted = configFromBackup(backup, current);
    expect(fitted?.config.launcher.language).toBe('nl');
  });
});
