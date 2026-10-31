import type { LunaResponse, WebOSServiceHandle } from '@lib/types.js';
import {
  hasWebOS,
  lunaRequest,
  lunaSubscribe,
  rootLuna,
  runLadder,
  TIMEOUTS
} from './luna-transport.js';
import type { LadderRung, LunaRequestOptions } from './luna-transport.js';
import { setVolumeAsRoot } from './root.js';

/** A normalized installed-app list, optionally marked complete. */
export interface NormalizedApps {
  apps: LunaResponse[];
  complete?: boolean;
}

function tryLunaRequest(uri: string, options: LunaRequestOptions) {
  return lunaRequest(uri, options).catch(function () {
    return null;
  });
}

export function launchApp(id: string, params?: Record<string, unknown>) {
  return lunaRequest('luna://com.webos.applicationManager', {
    method: 'launch',
    parameters: {id: id, params: params || {}}
  }, TIMEOUTS.launch);
}

export function getAppInfo(id: string) {
  return lunaRequest('luna://com.webos.applicationManager', {
    method: 'getAppInfo',
    parameters: {id: id}
  }, TIMEOUTS.appInfo);
}

function normalizeListedApps(res?: LunaResponse | null): NormalizedApps {
  if (!res) return {apps: []};

  if (Array.isArray(res.apps) && res.apps.length) {
    return {apps: res.apps};
  }

  if (Array.isArray(res.launchPoints)) {
    return {
      apps: res.launchPoints.map(function (point: LunaResponse): LunaResponse {
        return {
          id: point.id,
          appInfo: point
        };
      })
    };
  }

  return {apps: []};
}

const APP_MANAGER = 'luna://com.webos.applicationManager';
const APP_INSTALL = 'luna://com.webos.appInstallService';

/**
 * Read every installed app. A sandboxed web app can't call the privileged
 * `applicationManager/listApps` directly, so on retail webOS the in-app
 * subscription returns only a handful (or zero). The ladder tries root first —
 * which sees them all — then the in-app fallbacks; only the root rung marks the
 * list complete, since app-catalog.js may treat a missing app as not installed.
 */
export const LIST_APPS_LADDER: LadderRung[] = [
  {
    via: 'rootLuna',
    uri: APP_MANAGER + '/listApps',
    parameters: {},
    waitMs: TIMEOUTS.lunaSendWaitListApps,
    timeoutMs: TIMEOUTS.rootListApps
  },
  {
    via: 'subscribeOnce',
    uri: APP_MANAGER,
    method: 'listLaunchPoints',
    parameters: {},
    timeoutMs: TIMEOUTS.subscribeListApps
  },
  {
    via: 'request',
    uri: APP_MANAGER,
    method: 'listApps',
    parameters: {}
  }
];

function parseListedApps(res: LunaResponse, rung: LadderRung): NormalizedApps {
  const normalized = normalizeListedApps(res);
  if (!normalized.apps.length) throw new Error('no apps returned');
  if (rung.via === 'rootLuna') normalized.complete = true;
  return normalized;
}

export function listApps(): Promise<NormalizedApps> {
  return runLadder(LIST_APPS_LADDER, parseListedApps).catch(function () {
    return {apps: []};
  });
}

/**
 * The apps on LG's own home screen (launch points), in LG's order. Read as
 * root: a sandboxed app is usually refused the full list. Falls back to the
 * in-app subscription, which may return few or none.
 */
const LIST_LAUNCH_POINTS_LADDER: LadderRung[] = [
  {
    via: 'rootLuna',
    uri: APP_MANAGER + '/listLaunchPoints',
    parameters: {},
    waitMs: TIMEOUTS.lunaSendWaitListLaunchPoints,
    timeoutMs: TIMEOUTS.rootListLaunchPoints
  },
  {
    via: 'subscribeOnce',
    uri: APP_MANAGER,
    method: 'listLaunchPoints',
    parameters: {},
    timeoutMs: TIMEOUTS.subscribeListLaunchPoints
  }
];

export function listLaunchPoints() {
  return runLadder(LIST_LAUNCH_POINTS_LADDER, function (res) {
    return (res && res.launchPoints) || [];
  });
}

function pickForegroundId(res: LunaResponse | null | undefined): string {
  if (!res) return '';
  if (res.appId) return res.appId;
  if (Array.isArray(res.foregroundAppInfo) && res.foregroundAppInfo.length) {
    return res.foregroundAppInfo[0].appId || '';
  }
  return '';
}

/**
 * The foreground app. Same privilege wall as listApps: a sandboxed web app is
 * refused applicationManager's direct/subscription call, so root is tried
 * first; the in-app rungs cover desktop previews. Must use -i on this TV's
 * luna-send or stdout is empty (see the root command builder in luna-transport).
 */
const FOREGROUND_LADDER: LadderRung[] = [
  {
    via: 'rootLuna',
    uri: APP_MANAGER + '/getForegroundAppInfo',
    parameters: {subscribe: true},
    waitMs: TIMEOUTS.lunaSendWait,
    timeoutMs: TIMEOUTS.rootForeground
  },
  {
    via: 'subscribeOnce',
    uri: APP_MANAGER,
    method: 'getForegroundAppInfo',
    parameters: {},
    timeoutMs: TIMEOUTS.foreground
  },
  {
    via: 'request',
    uri: APP_MANAGER,
    method: 'getForegroundApp',
    parameters: {},
    timeoutMs: TIMEOUTS.foreground
  }
];

/**
 * Launch an app via root luna-send. More reliable from backgrounded contexts
 * where the sandboxed applicationManager/launch call may be denied or ignored.
 */
export function launchAppViaRoot(id: string) {
  return rootLuna(APP_MANAGER + '/launch', {id: id}, {
    waitMs: TIMEOUTS.lunaSendWait,
    timeoutMs: TIMEOUTS.rootLaunch,
    emptyAs: {returnValue: true}
  });
}

export function getForegroundApp() {
  return runLadder(FOREGROUND_LADDER, function (res) {
    return {appId: pickForegroundId(res)};
  });
}

/**
 * Bring an already-running app to the foreground (or launch it). Used to
 * reclaim input focus when another app has grabbed it without covering us.
 */
export function closeApp(id: string) {
  return lunaRequest('luna://com.webos.applicationManager', {
    method: 'closeByAppId',
    parameters: {id: id}
  });
}

/**
 * Uninstall an app. A sandboxed web app is usually refused the privileged
 * remove (`applicationinstall.management`), so the root path through Homebrew
 * Channel is the real one; `-2 No such id` means the id is not installed.
 */
export function removeApp(id: string) {
  return lunaRequest(APP_INSTALL, {
    method: 'remove',
    parameters: {id: id}
  }, TIMEOUTS.appRemove).catch(function () {
    return rootLuna(APP_INSTALL + '/remove', {id: id}, {
      waitMs: TIMEOUTS.lunaSendWait,
      timeoutMs: TIMEOUTS.rootAppRemove
    });
  });
}

export function getAllInputStatus() {
  return lunaRequest('luna://com.webos.service.eim', {
    method: 'getAllInputStatus',
    parameters: {subscribe: false}
  });
}

/** The input service's list read as root, for when the in-app call fails. */
export function getAllInputStatusViaRoot(): Promise<LunaResponse> {
  return rootLuna('luna://com.webos.service.eim/getAllInputStatus', {}, {
    waitMs: TIMEOUTS.lunaSendWaitInputs,
    timeoutMs: TIMEOUTS.rootInputs
  }).then(function (data) {
    if (!data || data.returnValue === false || !Array.isArray(data.devices)) {
      throw new Error('getAllInputStatus failed');
    }
    return data;
  });
}

function getInputStatus(inputId: string) {
  return lunaRequest('luna://com.webos.service.eim', {
    method: 'getInputStatus',
    parameters: {id: inputId}
  });
}

function switchInputViaApiAdapter(inputId: string) {
  return lunaRequest('luna://com.webos.service.apiadapter/tv', {
    method: 'switchInput',
    parameters: {inputId: inputId}
  });
}

function switchInputViaEim(inputId: string) {
  return getInputStatus(inputId).then(function (status) {
    if (status && status.appId) {
      return launchApp(status.appId);
    }
    throw new Error('Input has no launchable app');
  });
}

function switchInputViaExtinputs(inputId: string) {
  const hdmiMatch = inputId.match(/^HDMI_(\d+)$/i);
  if (!hdmiMatch) {
    return Promise.reject(new Error('extinputs only supports HDMI inputs'));
  }

  const mediaId = hdmiMatch[1];

  return lunaRequest('luna://com.webos.service.utp.extinputs', {
    method: 'open',
    parameters: {
      inputSourceType: 'HDMI',
      options: {mediaId: mediaId}
    }
  }).catch(function () {
    return lunaRequest('luna://com.webos.service.utp.extinputs', {
      method: 'open',
      parameters: {
        inputSourceType: 'HDMI',
        inputSource: 'HDMI_' + mediaId
      }
    });
  });
}

export function switchInput(inputId: string, device?: {appId?: string} | null) {
  if (device && device.appId) {
    return launchApp(device.appId).catch(function () {
      return switchInputViaApiAdapter(inputId)
        .catch(function () { return switchInputViaEim(inputId); })
        .catch(function () { return switchInputViaExtinputs(inputId); });
    });
  }

  return switchInputViaApiAdapter(inputId)
    .catch(function () { return switchInputViaEim(inputId); })
    .catch(function () { return switchInputViaExtinputs(inputId); });
}

export function getStorageDevices() {
  return lunaRequest('luna://com.webos.service.pdm', {
    method: 'getAttachedStorageDeviceList',
    parameters: {subscribe: false}
  }).catch(function () {
    return tryLunaRequest('luna://com.webos.service.pdm', {
      method: 'getDeviceList',
      parameters: {subscribe: false}
    });
  });
}

/**
 * Set the TV system volume (0–100). Best-effort across webOS audio services.
 * Used when entering Ember vs launching an external app.
 */
export function setSystemVolume(level: number | string) {
  let n = Math.round(Number(level));
  if (isNaN(n)) n = 0;
  if (n < 0) n = 0;
  if (n > 100) n = 100;

  if (!hasWebOS()) {
    return Promise.resolve({returnValue: false, skipped: true});
  }

  const params = {volume: n};
  const uris = [
    'luna://com.webos.audio',
    'luna://com.webos.service.audio',
    'luna://com.webos.service.apiadapter/audio'
  ];

  function tryAt(i: number): Promise<LunaResponse> {
    if (i >= uris.length) {
      return Promise.reject(new Error('setVolume unavailable'));
    }
    return lunaRequest(uris[i], {method: 'setVolume', parameters: params}).catch(function () {
      return tryAt(i + 1);
    });
  }

  return tryAt(0).catch(function () {
    // Last resort: shell via root (Homebrew Channel) for stubborn firmware.
    return setVolumeAsRoot(n).then(function (res) {
      return res.returnValue ? {returnValue: true, via: 'root'} : {returnValue: false};
    });
  });
}

/**
 * Subscribe to TV system volume changes. On webOS the physical remote volume
 * keys are handled by the platform, so we listen for volume updates and mirror
 * them on the on-screen bar. Returns an unsubscribe function.
 */
export function subscribeVolume(onChange: (volume: number, muted: boolean) => void): () => void {
  if (typeof onChange !== 'function') {
    return function () {};
  }

  function extractVolume(res: LunaResponse | null | undefined): number | null {
    if (!res) return null;
    if (res.volume && typeof res.volume.volume === 'number') return res.volume.volume;
    if (res.volumeStatus && typeof res.volumeStatus.volume === 'number') return res.volumeStatus.volume;
    if (typeof res.volume === 'number') return res.volume;
    return null;
  }

  function extractMuted(res: LunaResponse | null | undefined): boolean {
    if (!res) return false;
    if (res.volume && typeof res.volume.muted === 'boolean') return res.volume.muted;
    if (res.volumeStatus && typeof res.volumeStatus.muteStatus === 'boolean') return res.volumeStatus.muteStatus;
    if (typeof res.muted === 'boolean') return res.muted;
    return false;
  }

  function requestOn(uri: string): WebOSServiceHandle | null {
    return lunaSubscribe(uri, {
      method: 'getVolume',
      parameters: {subscribe: true},
      onSuccess: function (res) {
        const volume = extractVolume(res);
        if (volume !== null) onChange(volume, extractMuted(res));
      },
      onFailure: function () {}
    });
  }

  const handle = requestOn('luna://com.webos.audio') || requestOn('luna://com.webos.service.audio');

  return function () {
    if (handle && typeof handle.cancel === 'function') {
      handle.cancel();
    }
  };
}