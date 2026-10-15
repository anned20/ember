import {afterEach, describe, expect, it, vi} from 'vitest';
import {compareVersions, fetchLatestRelease, updateVerdict} from '@lib/update-check.js';

describe('compareVersions', () => {
  it('orders dotted numeric versions', () => {
    expect(compareVersions('0.4.0', '0.4.0')).toBe(0);
    expect(compareVersions('0.4.0', '0.4.1')).toBe(-1);
    expect(compareVersions('0.4.1', '0.4.0')).toBe(1);
    expect(compareVersions('0.4.0', '0.5.0')).toBe(-1);
    // The case the whole feature exists for: 0.10.0 is newer than 0.9.0.
    expect(compareVersions('0.9.0', '0.10.0')).toBe(-1);
    expect(compareVersions('1.0.0', '0.9.9')).toBe(1);
  });

  it('ignores a leading v, a pre-release suffix and a missing segment', () => {
    expect(compareVersions('v0.5.0', '0.5.0')).toBe(0);
    expect(compareVersions('v0.5.0', 'v0.4.9')).toBe(1);
    expect(compareVersions('0.4', '0.4.0')).toBe(0);
    expect(compareVersions('0.5.0-rc1', '0.5.0')).toBe(0);
  });

  it('has no answer for text that is not a version', () => {
    expect(compareVersions('nightly', '0.4.0')).toBeNull();
    expect(compareVersions('0.4.0', 'v')).toBeNull();
  });
});

describe('updateVerdict', () => {
  it('names a newer release without its v', () => {
    expect(updateVerdict('0.4.0', 'v0.5.0')).toEqual({state: 'available', latest: '0.5.0'});
    expect(updateVerdict('0.4.0', 'v0.4.1')).toEqual({state: 'available', latest: '0.4.1'});
  });

  it('reports the running version as current, even when it is ahead', () => {
    expect(updateVerdict('0.4.0', 'v0.4.0').state).toBe('current');
    expect(updateVerdict('1.0.0', 'v0.9.9').state).toBe('current');
  });

  it('never reads an unreadable tag as up to date', () => {
    expect(updateVerdict('0.4.0', 'nightly')).toEqual({state: 'unknown', latest: ''});
    expect(updateVerdict('0.4.0', '')).toEqual({state: 'unknown', latest: ''});
  });
});

describe('fetchLatestRelease', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the tag out of GitHub\u2019s reply', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, text: async () => '{"tag_name":"v0.5.0"}'})));

    await expect(fetchLatestRelease()).resolves.toBe('v0.5.0');
  });

  it('rejects when GitHub turns it away or sends no tag', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ok: false, status: 403, text: async () => '{}'})));
    await expect(fetchLatestRelease()).rejects.toThrow('403');

    vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, text: async () => '{"message":"Not Found"}'})));
    await expect(fetchLatestRelease()).rejects.toThrow('no release tag');
  });
});
