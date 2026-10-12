import {describe, expect, it} from 'vitest';
import {DEFAULT_CONFIG} from '@config/config.js';
import {APP_VERSION} from '@lib/version.js';
import {startLauncherProbe, tvCheckHead, tvCheckSummary} from '@settings/tv-check.js';
import type {Config} from '@lib/types.js';

function configWith(launcher: Partial<Config['launcher']>): Config {
  const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Config;
  config.profile = 'default';
  Object.assign(config.launcher, launcher);
  return config;
}

describe('tvCheckHead', () => {
  it('reports the launcher line from the config', () => {
    const head = tvCheckHead(configWith({perfMode: true, launchOnHome: true, bootOnStart: false}));
    expect(head.startsWith('Launch Home ' + APP_VERSION)).toBe(true);
    expect(head).toContain('| perf on');
    expect(head).toContain('| profile default');
    expect(head).toContain('| Home button on');
    expect(head).toContain('| boot off');
  });

  it('reads the off states too', () => {
    const head = tvCheckHead(configWith({perfMode: false, launchOnHome: false, bootOnStart: false}));
    expect(head).toContain('| perf off');
    expect(head).toContain('| Home button off');
  });
});

describe('tvCheckSummary', () => {
  it('keeps the head and the report above the details marker', () => {
    expect(tvCheckSummary('summary line\n=== details ===\nnoise', 'HEAD')).toBe('HEAD\nsummary line');
  });

  it('keeps the whole report when there is no marker', () => {
    expect(tvCheckSummary('  all of it  ', 'HEAD')).toBe('HEAD\nall of it');
  });
});

describe('startLauncherProbe', () => {
  it('reports the launcher behaviour during the check', () => {
    const probe = startLauncherProbe();
    const line = probe.stop();
    expect(line.startsWith('Launch Home during the check:')).toBe(true);
    expect(line).toContain('foreground seen:');
  });
});
