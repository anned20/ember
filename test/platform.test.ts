import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  getSdkVersion,
  isSupportedPlatform,
  isSupportedWebOS,
  parseSdkVersion,
  resetSdkVersionCache
} from '@luna/platform.js';
import {setLunaAdapter} from '@luna/luna-transport.js';
import type {LunaAdapter} from '@luna/luna-transport.js';
import type {WebOSServiceRequestOptions} from '@lib/types.js';

const CHROMIUM_86 = 'Mozilla/5.0 (Linux) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.0 Safari/537.36';
const CHROMIUM_87 = 'Mozilla/5.0 (Linux) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36';
const CHROMIUM_120 = 'Mozilla/5.0 (Linux) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

afterEach(() => {
  setLunaAdapter(null);
  resetSdkVersionCache();
  delete (window as {webOS?: unknown}).webOS;
});

describe('supported-platform decision', () => {
  it('parses the numeric part of an sdkVersion', () => {
    expect(parseSdkVersion('7.0')).toBe(7);
    expect(parseSdkVersion(10)).toBe(10);
    expect(parseSdkVersion('')).toBe(0);
    expect(parseSdkVersion(null)).toBe(0);
    expect(parseSdkVersion(undefined)).toBe(0);
  });

  it('accepts webOS 22 (sdk 7) as the floor', () => {
    expect(isSupportedWebOS(7)).toBe(true);
    expect(isSupportedWebOS(6)).toBe(false);
  });

  const cases: Array<[string, number | string | null, string, boolean]> = [
    ['webOS 6 (sdk 6)', 6, CHROMIUM_120, false],
    ['webOS 22 (sdk 7)', 7, CHROMIUM_120, true],
    ['webOS 25 (sdk 10)', 10, CHROMIUM_120, true],
    ['webOS 22 as "7.0"', '7.0', CHROMIUM_120, true],
    ['unknown sdk, Chromium 86', 0, CHROMIUM_86, false],
    ['unknown sdk, Chromium 87', 0, CHROMIUM_87, true],
    ['empty sdk, Chromium 86', '', CHROMIUM_86, false],
    ['empty sdk, Chromium 87', '', CHROMIUM_87, true]
  ];

  it.each(cases)('decides %s', (_label, sdk, userAgent, expected) => {
    expect(isSupportedPlatform(sdk, userAgent)).toBe(expected);
  });
});

describe('getSdkVersion', () => {
  it('reads sdkVersion through the Luna bus when deviceInfo is absent', async () => {
    const sent: Array<{uri: string; options: WebOSServiceRequestOptions}> = [];
    const adapter: LunaAdapter = {
      request: function (uri, options) {
        sent.push({uri: uri, options: options});
        options.onSuccess!({returnValue: true, sdkVersion: '10'});
        return {cancel: vi.fn()};
      }
    };
    setLunaAdapter(adapter);

    await expect(getSdkVersion()).resolves.toBe(10);
    expect(sent[0].uri).toBe('luna://com.webos.service.tv.systemproperty');
    expect(sent[0].options.method).toBe('getSystemInfo');
  });

  it('prefers window.webOS.deviceInfo when present', async () => {
    (window as {webOS?: unknown}).webOS = {
      deviceInfo: function (cb: (info: {sdkVersion: string}) => void) {
        cb({sdkVersion: '9'});
      }
    };

    await expect(getSdkVersion()).resolves.toBe(9);
  });

  it('resolves 0 when the TV cannot be asked', async () => {
    setLunaAdapter({
      request: function (_uri, options) {
        options.onFailure!(new Error('no bus'));
        return {cancel: vi.fn()};
      }
    });

    await expect(getSdkVersion()).resolves.toBe(0);
  });
});
