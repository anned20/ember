import {lunaRequest} from './luna.js';

let cachedSdkVersion: number | null = null;

export function parseSdkVersion(raw?: string | null): number {
  if (!raw) return 0;
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

/** webOS 6.x TVs (sdk 6) and later year-branded releases (sdk 9+). */
export function isModernWebOS(sdkVersion: number): boolean {
  return sdkVersion >= 6;
}