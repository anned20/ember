import {describe, expect, it} from 'vitest';
import {
  CONFIG_MIGRATIONS, CONFIG_SCHEMA_VERSION, DEFAULT_CONFIG, migrateConfig
} from '../src/ts/config.js';
import type {Config} from '../src/ts/types.js';

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
