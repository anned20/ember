import {describe, expect, it, vi} from 'vitest';
import {
  CONFIG_MIGRATIONS, CONFIG_SCHEMA_VERSION, DEFAULT_CONFIG, migrateConfig
} from '@config/config.js';
import {importLegacySettings, parseBackup} from '@settings/settings-backup.js';
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
