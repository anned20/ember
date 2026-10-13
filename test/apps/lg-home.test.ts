import {describe, expect, it} from 'vitest';
import {lgHomeAppsToAdd} from '@apps/lg-home.js';
import type {LaunchPoint} from '@apps/lg-home.js';

function ids(points: Array<{id: string}>): string[] {
  return lgHomeAppsToAdd(points as LaunchPoint[], [], []);
}

describe('lgHomeAppsToAdd', () => {
  it('keeps Ember, its voice card and a leftover Launch Home out of the dock', () => {
    expect(ids([
      {id: 'com.ember.launcher'},
      {id: 'com.ember.voice'},
      {id: 'org.webosbrew.lounge.launcher'},
      {id: 'org.webosbrew.lounge.voice'},
      {id: 'netflix'}
    ])).toEqual(['netflix']);
  });
});
