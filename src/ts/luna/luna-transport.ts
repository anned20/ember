// The Luna transport: the one place that talks to the webOS bus.
//
// Every device call funnels through here — one-shot requests, subscribe-once
// reads, and shell commands run as root through Homebrew Channel. Timeouts and
// fallback order live here as data behind this interface, so a device call is a
// small description and a test can swap the bus for a fake adapter.

import type {LunaResponse, WebOSServiceHandle, WebOSServiceRequestOptions} from '@lib/types.js';

/** Method + parameters for a Luna request. */
export interface LunaRequestOptions {
  method: string;
  parameters?: Record<string, unknown>;
}

/**
 * Device latency policy, in milliseconds. Root exec and Luna subscriptions can
 * hang indefinitely after a failed launch; naming every budget here keeps the
 * magic numbers out of call sites and lets them be tuned in one place.
 */
export const TIMEOUTS = {
  // Luna request round-trips.
  launch: 5000,
  appInfo: 4000,
  appRemove: 6000,
  foreground: 4000,
  subscribeListApps: 5000,
  subscribeListLaunchPoints: 5000,

  // Root exec: the budget for one whole shell command.
  rootDefault: 10000,
  rootReadFile: 8000,
  rootListApps: 6000,
  rootListLaunchPoints: 8000,
  rootForeground: 5000,
  rootLaunch: 5000,
  rootAppRemove: 15000,
  rootInputs: 7000,
  rootHomeWatcher: 20000,
  rootHomeWatcherProbe: 5000,
  rootHomeWatcherStop: 8000,
  rootBootLaunchEnable: 12000,
  rootBootLaunchDisable: 8000,
  rootVoiceEnable: 150000,
  rootVoiceProbe: 8000,
  rootVoiceDisable: 45000,
  rootTvCheck: 150000,
  rootChannelsList: 20000,
  rootChannelNow: 12000,
  rootChannelOpen: 20000,
  rootScreensaver: 10000,

  // luna-send's -w flag, in seconds, inside a rootLuna command.
  lunaSendWait: 4000,
  lunaSendWaitListApps: 5000,
  lunaSendWaitListLaunchPoints: 6000,
  lunaSendWaitInputs: 5000
} as const;

/**
 * The webOS bus, behind an interface. The transport only ever reaches the
 * device through this, so a test can substitute a fake without a real runtime.
 */
export interface LunaAdapter {
  request(uri: string, options: WebOSServiceRequestOptions): WebOSServiceHandle;
}

/** True when a real webOS Luna bus is present (false in the desktop preview). */
export function hasWebOS(): boolean {
  return typeof window !== 'undefined' && !!window.webOS && !!window.webOS.service;
}

/** The error a `returnValue: false` reply means, or null when it succeeded. */
function lunaError(res: LunaResponse | null | undefined): Error | null {
  if (res && res.returnValue === false) {
    return new Error(res.errorText || 'Luna call failed');
  }
  return null;
}

const deviceAdapter: LunaAdapter = {
  request: function (uri, options) {
    if (!hasWebOS()) throw new Error('webOS Luna bus unavailable');
    return window.webOS!.service.request(uri, options);
  }
};

let bus: LunaAdapter = deviceAdapter;

/** Replace the Luna bus (tests). Pass null to restore the real device bus. */
export function setLunaAdapter(adapter: LunaAdapter | null): void {
  bus = adapter || deviceAdapter;
}

/**
 * Reject if the wrapped promise doesn't settle within `ms`. Without this, a
 * Luna call that hangs after a failed app launch would stall the whole UI.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise(function (resolve, reject) {
    const timer: ReturnType<typeof setTimeout> = setTimeout(function () {
      reject(new Error('Luna call timed out'));
    }, ms);
    promise.then(function (value) {
      clearTimeout(timer);
      resolve(value);
    }, function (err) {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * One Luna request. Rejects on `returnValue: false` or a bus failure, and
 * applies `timeoutMs` when given.
 */
export function lunaRequest(
  uri: string,
  options: LunaRequestOptions,
  timeoutMs?: number
): Promise<LunaResponse> {
  const promise = new Promise<LunaResponse>(function (resolve, reject) {
    try {
      bus.request(uri, {
        method: options.method,
        parameters: options.parameters || {},
        onSuccess: function (res) {
          const err = lunaError(res);
          if (err) { reject(err); return; }
          resolve(res || {});
        },
        onFailure: function (err) {
          reject(err || new Error('Luna call failed'));
        }
      });
    } catch (err) {
      reject(err);
    }
  });
  return timeoutMs ? withTimeout(promise, timeoutMs) : promise;
}

/** Open a subscription and hand back its cancel handle, or null if refused. */
export function lunaSubscribe(
  uri: string,
  options: WebOSServiceRequestOptions
): WebOSServiceHandle | null {
  try {
    return bus.request(uri, options);
  } catch (err) {
    return null;
  }
}

/**
 * Some applicationManager list methods only return data through a subscription
 * on retail webOS. Open a subscribe request, resolve on the first payload, then
 * cancel so we behave like a one-shot call.
 */
export function lunaSubscribeOnce(
  uri: string,
  options: LunaRequestOptions,
  timeoutMs?: number
): Promise<LunaResponse> {
  const parameters = Object.assign({subscribe: true}, options.parameters || {});

  const promise = new Promise<LunaResponse>(function (resolve, reject) {
    let settled = false;
    let handle: WebOSServiceHandle | null = null;

    function finish(fn: (value: any) => void, value: any): void {
      if (settled) return;
      settled = true;
      if (handle && typeof handle.cancel === 'function') {
        try { handle.cancel(); } catch (err) { /* ignore */ }
      }
      fn(value);
    }

    handle = lunaSubscribe(uri, {
      method: options.method,
      parameters: parameters,
      onSuccess: function (res) {
        const err = lunaError(res);
        if (err) { finish(reject, err); return; }
        finish(resolve, res || {});
      },
      onFailure: function (err) {
        finish(reject, err || new Error('Luna call failed'));
      }
    });

    if (!handle) finish(reject, new Error('webOS Luna bus unavailable'));
  });

  return timeoutMs ? withTimeout(promise, timeoutMs) : promise;
}

/**
 * Run a shell command through the Homebrew Channel root service. On a rooted TV
 * with the service elevated this executes as root; otherwise it fails or runs
 * unprivileged. Resolves with the raw exec response.
 */
export function execRoot(command: string, timeoutMs?: number): Promise<LunaResponse> {
  return lunaRequest('luna://org.webosbrew.hbchannel.service', {
    method: 'exec',
    parameters: {command: command}
  }, timeoutMs);
}

/**
 * Build a root `luna-send` command line for this TV's 2011-era binary.
 *
 * That build requires `-i` (interactive) or it prints nothing; `-n 1` exits
 * after one reply; `-w` is a hard timeout. Newer TVs accept the same flags.
 */
export function lunaSendRootCommand(uri: string, payloadJson: string | null, waitMs?: number): string {
  const wait = waitMs || TIMEOUTS.lunaSendWait;
  const payload = payloadJson == null ? '{}' : String(payloadJson);
  // Single-quoted payload; escape any embedded single quotes for the shell.
  const safePayload = payload.replace(/'/g, "'\\''");
  return "luna-send -i -n 1 -w " + wait + " -f '" + uri + "' '" + safePayload + "'";
}

/** The text a root exec printed, from either of Homebrew Channel's fields. */
export function readExecStdout(res: LunaResponse | null | undefined): string {
  let out = res && res.stdoutString ? String(res.stdoutString) : '';
  if (!out && res && res.stdoutBytes) {
    try { out = String(atob(res.stdoutBytes)); } catch (err) { /* ignore */ }
  }
  return out.trim();
}

export interface RootLunaOptions {
  /** luna-send's -w value, in seconds. */
  waitMs?: number;
  /** Budget for the whole root exec. */
  timeoutMs?: number;
  /** Return this instead of rejecting when the command prints nothing. */
  emptyAs?: LunaResponse;
}

/**
 * Call a Luna method *as root*: run `luna-send` through Homebrew Channel, then
 * parse its JSON reply and reject on `returnValue: false`. This is the single
 * home of the root-exec + parse idiom — a sandboxed web app is refused the
 * privileged applicationManager methods, so these calls go through root.
 *
 * `uri` carries the method (e.g. `luna://com.webos.applicationManager/listApps`).
 */
export function rootLuna(
  uri: string,
  params?: Record<string, unknown> | null,
  options?: RootLunaOptions
): Promise<LunaResponse> {
  const opts = options || {};
  const payload = params == null ? null : JSON.stringify(params);
  const command = lunaSendRootCommand(uri, payload, opts.waitMs || TIMEOUTS.lunaSendWait);
  const name = uri.replace(/^.*\//, '');
  return execRoot(command, opts.timeoutMs || TIMEOUTS.rootDefault).then(function (res) {
    const out = readExecStdout(res);
    if (!out) {
      if (opts.emptyAs) return opts.emptyAs;
      throw new Error('empty ' + name + ' output');
    }
    const data = JSON.parse(out);
    if (data && data.returnValue === false) {
      throw new Error(data.errorText || name + ' failed');
    }
    return data;
  });
}

/** One rung of a fallback ladder: how to reach Luna, and how long to wait. */
export type LadderRung =
  | {via: 'rootLuna'; uri: string; parameters?: Record<string, unknown>; waitMs?: number; timeoutMs?: number}
  | {via: 'subscribeOnce'; uri: string; method: string; parameters?: Record<string, unknown>; timeoutMs?: number}
  | {via: 'request'; uri: string; method: string; parameters?: Record<string, unknown>; timeoutMs?: number};

/** Run a single rung. */
function lunaAttempt(rung: LadderRung): Promise<LunaResponse> {
  if (rung.via === 'rootLuna') {
    return rootLuna(rung.uri, rung.parameters || {}, {
      waitMs: rung.waitMs,
      timeoutMs: rung.timeoutMs
    });
  }
  if (rung.via === 'subscribeOnce') {
    return lunaSubscribeOnce(
      rung.uri,
      {method: rung.method, parameters: rung.parameters || {}},
      rung.timeoutMs
    );
  }
  return lunaRequest(
    rung.uri,
    {method: rung.method, parameters: rung.parameters || {}},
    rung.timeoutMs
  );
}

/**
 * Walk a fallback ladder: try each rung in order and resolve with the first
 * result `parse` accepts. A rung is skipped when its call fails *or* when
 * `parse` throws (e.g. a list that came back empty); the last rung's error is
 * what surfaces.
 */
export function runLadder<T>(
  rungs: LadderRung[],
  parse: (res: LunaResponse, rung: LadderRung) => T
): Promise<T> {
  function attempt(index: number): Promise<T> {
    const rung = rungs[index];
    return lunaAttempt(rung).then(function (res) {
      return parse(res, rung);
    }).catch(function (err) {
      if (index + 1 >= rungs.length) throw err;
      return attempt(index + 1);
    });
  }
  return attempt(0);
}
