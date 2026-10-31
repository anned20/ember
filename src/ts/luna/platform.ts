import {lunaRequest} from './luna-transport.js';

/**
 * The declared supported-platform floor: webOS 22.
 *
 * webOS 22 reports `sdkVersion` 7; the year-branded releases follow 8 = 23,
 * 9 = 24, 10 = 25. The mapping is recorded in
 * `docs/adr/0001-webos-22-floor.md`. Anything below is unsupported.
 */
export const MIN_WEBOS_SDK = 7;

/** Chromium 87 ships with webOS 22 and is the real engine requirement. */
export const MIN_CHROMIUM_MAJOR = 87;

let cachedSdkVersion: number | null = null;

export function parseSdkVersion(raw?: string | number | null): number {
  if (raw === null || raw === undefined || raw === '') return 0;
  const match = String(raw).match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
}

export async function getSdkVersion(): Promise<number> {
  if (cachedSdkVersion !== null) return cachedSdkVersion;

  const webos = window.webOS;
  if (webos && typeof webos.deviceInfo === 'function') {
    cachedSdkVersion = await new Promise<number>(function (resolve) {
      webos.deviceInfo!(function (info) {
        resolve(parseSdkVersion(info && info.sdkVersion));
      });
    });
    return cachedSdkVersion;
  }

  try {
    const res = await lunaRequest('luna://com.webos.service.tv.systemproperty', {
      method: 'getSystemInfo',
      parameters: {keys: ['sdkVersion']}
    });
    cachedSdkVersion = parseSdkVersion(res.sdkVersion);
  } catch (err) {
    cachedSdkVersion = 0;
  }

  return cachedSdkVersion;
}

/** Forget the cached sdkVersion, so a later read asks the TV again. */
export function resetSdkVersionCache(): void {
  cachedSdkVersion = null;
}

/** A known webOS sdkVersion is supported when it is at or above the floor. */
export function isSupportedWebOS(sdkVersion: number): boolean {
  return sdkVersion >= MIN_WEBOS_SDK;
}

/** The Chromium major from a user agent, or 0 when it cannot be read. */
function chromiumMajor(userAgent?: string | null): number {
  const match = String(userAgent || '').match(/(?:Chromium|Chrome)\/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

/** The secondary signal: a Chromium engine new enough for the floor. */
function isSupportedUserAgent(userAgent?: string | null): boolean {
  return chromiumMajor(userAgent) >= MIN_CHROMIUM_MAJOR;
}

/**
 * The supported-platform decision. A TV that answered with a known
 * `sdkVersion` is judged on it; when it did not answer (0/empty — the desktop
 * preview, or a TV whose Luna call failed) accept only a Chromium >= 87 engine,
 * which is the real requirement.
 */
export function isSupportedPlatform(
  rawSdkVersion?: string | number | null,
  userAgent?: string | null
): boolean {
  const sdk = parseSdkVersion(rawSdkVersion);
  if (sdk > 0) return isSupportedWebOS(sdk);
  return isSupportedUserAgent(userAgent);
}
