import {describe, expect, it} from 'vitest';
import {dock} from '@apps/dock.js';
import type {LauncherConfig} from '@lib/types.js';

function launcher(pinned: string[], custom: LauncherConfig['customApps'] = []): LauncherConfig {
  return {pinnedApps: pinned, customApps: custom} as LauncherConfig;
}

const CUSTOM = {
  id: 'custom:1-7',
  launchId: 'com.foo.bar',
  title: 'Foo',
  icon: 'assets/foo.png'
};

describe('dock.entries', () => {
  it('keeps the pinned order and attaches the Custom app record', () => {
    expect(dock.entries(launcher(['netflix', CUSTOM.id], [CUSTOM]))).toEqual([
      {id: 'netflix'},
      {id: CUSTOM.id, custom: CUSTOM}
    ]);
  });

  it('de-dupes exact ids only, so two ids for one app stay two tiles', () => {
    const list = dock.entries(launcher(['netflix', 'netflix', 'amazon', 'amazon.html']));
    expect(list.map(function (entry) { return entry.id; }))
      .toEqual(['netflix', 'amazon', 'amazon.html']);
  });
});

describe('dock.contains', () => {
  it('is alias-aware for a plain id', () => {
    const list = launcher(['amazon.html']);
    expect(dock.contains(list, 'amazon')).toBe(true);
    expect(dock.contains(list, 'com.amazon.amazonvideo.livingroom')).toBe(true);
    expect(dock.contains(list, 'netflix')).toBe(false);
  });

  it('matches a Custom app tile through its launch id', () => {
    const list = launcher([CUSTOM.id], [CUSTOM]);
    expect(dock.contains(list, 'com.foo.bar')).toBe(true);
    expect(dock.contains(list, CUSTOM.id)).toBe(true);
  });

  it('ignores a Custom app record nobody pins', () => {
    expect(dock.contains(launcher([], [CUSTOM]), 'com.foo.bar')).toBe(false);
  });
});

describe('dock.pin', () => {
  it('appends and keeps the existing order', () => {
    const next = dock.pin(launcher(['netflix']), 'com.foo');
    expect(next.pinnedApps).toEqual(['netflix', 'com.foo']);
  });

  it('does nothing for an app already in the Dock, under either id', () => {
    expect(dock.pin(launcher(['amazon.html']), 'amazon').pinnedApps).toEqual(['amazon.html']);
    expect(dock.pin(launcher([CUSTOM.id], [CUSTOM]), 'com.foo.bar').pinnedApps).toEqual([CUSTOM.id]);
  });
});

describe('dock.addCustom', () => {
  it('mints a unique id and appends the record and the tile', () => {
    const next = dock.addCustom(launcher(['netflix']), {
      launchId: 'com.foo.bar', title: 'Foo', icon: 'assets/foo.png'
    });
    expect(next.customApps).toHaveLength(1);
    expect(next.customApps[0].id).toMatch(/^custom:/);
    expect(next.customApps[0].launchId).toBe('com.foo.bar');
    expect(next.pinnedApps).toEqual(['netflix', next.customApps[0].id]);
  });

  it('refuses a second tile for an app already in the Dock', () => {
    const list = launcher(['amazon'], []);
    expect(dock.addCustom(list, {launchId: 'amazon.html', title: 'Prime', icon: ''})).toEqual(list);
  });
});

describe('dock.remove', () => {
  it('drops the tile and its Custom app record', () => {
    const next = dock.remove(launcher(['netflix', CUSTOM.id], [CUSTOM]), CUSTOM.id);
    expect(next.pinnedApps).toEqual(['netflix']);
    expect(next.customApps).toEqual([]);
  });

  it('crosses id spaces: unpinning the plain id takes the Custom tile for the same app', () => {
    const next = dock.remove(launcher(['netflix', CUSTOM.id], [CUSTOM]), 'com.foo.bar');
    expect(next.pinnedApps).toEqual(['netflix']);
    expect(next.customApps).toEqual([]);
  });

  it('drops every alias id of the app', () => {
    const next = dock.remove(launcher(['netflix', 'amazon', 'amazon.html']), 'amazon.html');
    expect(next.pinnedApps).toEqual(['netflix']);
  });

  it('leaves a Custom app record nobody pins alone', () => {
    const next = dock.remove(launcher(['netflix'], [CUSTOM]), 'netflix');
    expect(next.customApps).toEqual([CUSTOM]);
  });
});

describe('dock.move', () => {
  it('swaps neighbours', () => {
    const list = launcher(['a', 'b', 'c']);
    expect(dock.move(list, 1, -1).pinnedApps).toEqual(['b', 'a', 'c']);
    expect(dock.move(list, 1, 1).pinnedApps).toEqual(['a', 'c', 'b']);
  });

  it('does nothing at either end', () => {
    const list = launcher(['a', 'b']);
    expect(dock.move(list, 0, -1).pinnedApps).toEqual(['a', 'b']);
    expect(dock.move(list, 1, 1).pinnedApps).toEqual(['a', 'b']);
  });
});

describe('purity', () => {
  it('never mutates its argument', () => {
    const list = launcher(['netflix', CUSTOM.id], [CUSTOM]);

    const pinned = dock.pin(list, 'com.foo');
    dock.addCustom(list, {launchId: 'com.bar', title: 'Bar', icon: ''});
    dock.remove(list, 'netflix');
    dock.move(list, 0, 1);
    dock.entries(list);

    expect(list.pinnedApps).toEqual(['netflix', CUSTOM.id]);
    expect(list.customApps).toEqual([CUSTOM]);
    // The result copies the records too, so a caller cannot share them.
    expect(pinned.customApps[0]).not.toBe(CUSTOM);
  });
});
