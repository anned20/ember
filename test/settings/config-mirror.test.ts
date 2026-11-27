import {describe, expect, it} from 'vitest';
import {decideMirror} from '@settings/config-mirror.js';
import {settingsBackupText} from '@settings/settings-backup.js';
import {DEFAULT_CONFIG} from '@config/config.js';
import type {Config} from '@lib/types.js';

function config(clock: string): Config {
  const c = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Config;
  c.launcher.clockFormat = clock;
  return c;
}

/** A mirror file saved at `savedAt` holding `clock`. */
function mirror(clock: string, savedAt: number): string {
  const data = JSON.parse(settingsBackupText(config(clock), {reason: 'mirror'}));
  data.savedAt = new Date(savedAt).toISOString();
  return JSON.stringify(data);
}

describe('the settings mirror', () => {
  it('is published from when there is none yet', () => {
    expect(decideMirror(null, 0, config('24h'))).toEqual({kind: 'publish'});
  });

  it('is published over when it is unreadable', () => {
    expect(decideMirror('{not json', 5, config('24h'))).toEqual({kind: 'publish'});
  });

  it('is adopted when it is newer than this copy', () => {
    const action = decideMirror(mirror('12h', 2000), 1000, config('24h'));

    expect(action.kind).toBe('adopt');
    if (action.kind === 'adopt') {
      expect(action.config.launcher.clockFormat).toBe('12h');
      expect(action.savedAt).toBe(2000);
    }
  });

  it('is published over when this copy is newer', () => {
    expect(decideMirror(mirror('12h', 1000), 2000, config('24h'))).toEqual({kind: 'publish'});
  });

  it('is left alone when both saved at the same time', () => {
    expect(decideMirror(mirror('12h', 1000), 1000, config('24h'))).toEqual({kind: 'none'});
  });
});
