import {describe, expect, it} from 'vitest';
import {lgHomeAppsToAdd} from '@apps/lg-home.js';
import type {LaunchPoint} from '@apps/lg-home.js';
import type {LauncherConfig} from '@lib/types.js';

function launcher(pinned: string[], custom: LauncherConfig['customApps'] = []): LauncherConfig {
  return {pinnedApps: pinned, customApps: custom} as LauncherConfig;
}

function ids(points: Array<{id: string}>): string[] {
  return lgHomeAppsToAdd(points as LaunchPoint[], launcher([]));
}

describe('lgHomeAppsToAdd', () => {
  it('keeps Ember, anything else in its id namespace and a leftover Launch Home out of the dock', () => {
    expect(ids([
      {id: 'com.ember.launcher'},
      {id: 'com.ember.voice'},
      {id: 'org.webosbrew.lounge.launcher'},
      {id: 'org.webosbrew.lounge.voice'},
      {id: 'netflix'}
    ])).toEqual(['netflix']);
  });

  it('skips an app already in the Dock under another id', () => {
    expect(lgHomeAppsToAdd([{id: 'amazon'}], launcher(['amazon.html']))).toEqual([]);
  });

  it('skips a Custom app tile through its launch id', () => {
    const custom = [{id: 'custom:1-7', launchId: 'com.foo.bar', title: 'Foo', icon: ''}];
    expect(lgHomeAppsToAdd([{id: 'com.foo.bar'}], launcher(['custom:1-7'], custom))).toEqual([]);
  });

  it('offers an app whose Custom app record nobody pins any more', () => {
    const custom = [{id: 'custom:1-7', launchId: 'com.foo.bar', title: 'Foo', icon: ''}];
    expect(lgHomeAppsToAdd([{id: 'com.foo.bar'}], launcher([], custom))).toEqual(['com.foo.bar']);
  });
});

