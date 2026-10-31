/**
 * The home-screen Network status chip: the TV's link type plus whether the
 * internet is actually reachable.
 *
 * The link comes from the connection manager's getStatus subscription. The
 * internet answer is a probe, not LG's `isInternetConnectionAvailable` flag:
 * that flag stays true when the router has no uplink. Two hosts are tried
 * (Cloudflare, then the weather host) so a regional block of one host does not
 * look like an outage, and one failed probe is retried after ten seconds
 * before the chip turns amber. Probing pauses while another app or the in-app
 * screensaver is in front.
 *
 * If the connection manager refuses the subscription, the chip degrades to a
 * plain internet globe instead of guessing a link type.
 */

import {t} from '@lib/i18n.js';
import {lunaSubscribe} from '@luna/luna-transport.js';
import type {TranslationKey} from '@lib/i18n.js';
import type {Config, LauncherConfig, WebOSServiceHandle} from '@lib/types.js';

/** What the chip paints. `unknown` means there is nothing honest to show yet. */
export type NetworkState =
  | 'wifi'
  | 'ethernet'
  | 'no-internet'
  | 'offline'
  | 'internet'
  | 'unknown';

export interface NetworkStatusOptions {
  getConfig: () => Config;
  /** False while another app or the in-app screensaver is in front. */
  isActive: () => boolean;
  onOpenNetworkSettings: () => void;
}

export interface NetworkStatusHandle {
  start(): void;
  stop(): void;
  applyConfig(): void;
  refresh(): void;
}

type LinkState = 'wifi' | 'ethernet' | 'offline';

const CONNECTION_SERVICES = [
  'luna://com.palm.connectionmanager',
  'luna://com.webos.service.connectionmanager'
];
const PROBE_URLS = [
  'https://cloudflare.com/cdn-cgi/trace',
  'https://api.open-meteo.com/v1/forecast'
];
const PROBE_TIMEOUT_MS = 8000;
const RETRY_MS = 10000;
const CHECK_MS = 60000;

const LABELS: Record<Exclude<NetworkState, 'unknown'>, TranslationKey> = {
  wifi: 'network.wifi',
  ethernet: 'network.ethernet',
  internet: 'network.internet',
  'no-internet': 'network.noInternet',
  offline: 'network.offline'
};

const GLYPHS: Record<Exclude<NetworkState, 'unknown'>, string> = {
  // Wi-Fi arcs.
  wifi: '<path d="M2.5 8.5a15 15 0 0 1 19 0"/>' +
    '<path d="M5.5 12a10.5 10.5 0 0 1 13 0"/>' +
    '<path d="M8.5 15.5a6 6 0 0 1 7 0"/>' +
    '<circle cx="12" cy="19" r="1" fill="currentColor" stroke="none"/>',
  // An RJ45 plug.
  ethernet: '<path d="M7 3v4M17 3v4"/>' +
    '<rect x="4" y="7" width="16" height="9" rx="2"/>' +
    '<path d="M8 16v3h8v-3"/>' +
    '<path d="M9 11h.01M12 11h.01M15 11h.01"/>',
  // A globe, for the degraded internet-only reading.
  internet: '<circle cx="12" cy="12" r="9"/>' +
    '<path d="M3 12h18"/>' +
    '<path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18"/>',
  // A globe with an exclamation: link up, uplink missing.
  'no-internet': '<circle cx="10" cy="12" r="7"/>' +
    '<path d="M3 12h14"/>' +
    '<path d="M10 5a11 11 0 0 1 0 14a11 11 0 0 1 0-14"/>' +
    '<path d="M20 7v6"/>' +
    '<circle cx="20" cy="17" r="1" fill="currentColor" stroke="none"/>',
  // A globe with a slash: no link at all.
  offline: '<circle cx="12" cy="12" r="9"/>' +
    '<path d="M3 12h18"/>' +
    '<path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18"/>' +
    '<path d="M4 4l16 16"/>'
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise(function (resolve, reject) {
    const timer: ReturnType<typeof setTimeout> = setTimeout(function () {
      reject(new Error('Network probe timed out'));
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

/** True when the request reached something; a no-cors reply counts. */
function probeHost(url: string): Promise<boolean> {
  return withTimeout(fetch(url, {mode: 'no-cors', cache: 'no-store'}), PROBE_TIMEOUT_MS)
    .then(function () { return true; }, function () { return false; });
}

/** The two-host internet probe; resolves false only when both hosts fail. */
function probeInternet(): Promise<boolean> {
  return probeHost(PROBE_URLS[0]).then(function (ok) {
    return ok ? true : probeHost(PROBE_URLS[1]);
  });
}

export function createNetworkStatus(
  button: HTMLElement | null,
  options: NetworkStatusOptions
): NetworkStatusHandle {
  if (!button) {
    return {start: function () {}, stop: function () {}, applyConfig: function () {}, refresh: function () {}};
  }
  const el = button;

  let started = false;
  let enabled = true;
  let link: LinkState | null = null;
  let refused = false;
  let internet: boolean | null = null;
  let probing = false;
  let checkTimer: ReturnType<typeof setInterval> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let handle: WebOSServiceHandle | null = null;
  let generation = 0;
  let painted = '';

  function launcherConfig(): LauncherConfig {
    return options.getConfig().launcher || ({} as LauncherConfig);
  }

  function paint(): void {
    const state = stateNow();
    if (state === 'unknown') {
      el.hidden = true;
      return;
    }
    el.hidden = !enabled;
    if (!enabled) return;
    if (state !== painted) {
      el.dataset.state = state;
      el.innerHTML = '<svg class="settings-icon-glyph" viewBox="0 0 24 24" fill="none" ' +
        'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
        'stroke-linejoin="round" aria-hidden="true" focusable="false">' +
        GLYPHS[state] + '</svg>';
      painted = state;
    }
    el.setAttribute('aria-label', t(LABELS[state]));
  }

  function stateNow(): NetworkState {
    if (refused) {
      if (internet === null) return 'unknown';
      return internet ? 'internet' : 'no-internet';
    }
    if (link === null) return 'unknown';
    if (link === 'offline') return 'offline';
    if (internet === false) return 'no-internet';
    return link;
  }

  function clearRetry(): void {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  }

  function clearCheck(): void {
    if (checkTimer) clearInterval(checkTimer);
    checkTimer = null;
  }

  function cancelHandle(): void {
    if (handle && typeof handle.cancel === 'function') {
      try { handle.cancel(); } catch (err) { /* ignore */ }
    }
    handle = null;
  }

  function runProbe(confirming: boolean): void {
    if (!started || !enabled || !options.isActive() || probing) return;
    if (!confirming) clearRetry();
    probing = true;
    probeInternet().then(function (ok) {
      probing = false;
      if (!started || !enabled) return;
      if (ok) {
        clearRetry();
        internet = true;
        paint();
        return;
      }
      if (confirming || internet === false) {
        internet = false;
        paint();
        return;
      }
      // One failure is a hiccup until a second probe says otherwise.
      retryTimer = setTimeout(function () {
        retryTimer = null;
        runProbe(true);
      }, RETRY_MS);
    });
  }

  function parseLink(res: Record<string, unknown> | null | undefined): LinkState | null {
    if (!res) return null;
    const wired = res.wired as {state?: unknown} | undefined;
    const wifi = res.wifi as {state?: unknown} | undefined;
    if (wired && wired.state === 'connected') return 'ethernet';
    if (wifi && wifi.state === 'connected') return 'wifi';
    if (wired || wifi) return 'offline';
    return null;
  }

  function subscribeAt(index: number): void {
    if (!started || !enabled) return;
    if (index >= CONNECTION_SERVICES.length) {
      refused = true;
      paint();
      return;
    }
    const gen = ++generation;
    let moved = false;

    function next(): void {
      if (moved || gen !== generation) return;
      moved = true;
      cancelHandle();
      subscribeAt(index + 1);
    }

    let opened: WebOSServiceHandle | null = null;
    try {
      opened = lunaSubscribe(CONNECTION_SERVICES[index], {
        method: 'getStatus',
        parameters: {subscribe: true},
        onSuccess: function (res) {
          if (gen !== generation) return;
          if (res && res.returnValue === false) {
            next();
            return;
          }
          refused = false;
          const reading = parseLink(res);
          if (reading === null) return;
          const wasConnected = link === 'wifi' || link === 'ethernet';
          link = reading;
          if (!wasConnected && reading !== 'offline') runProbe(false);
          paint();
        },
        onFailure: function () {
          if (gen === generation) next();
        }
      });
    } catch (err) {
      opened = null;
    }
    // A synchronous failure already moved on to the next service; bin the
    // handle this call handed back.
    if (gen !== generation) {
      if (opened && typeof opened.cancel === 'function') {
        try { opened.cancel(); } catch (err) { /* ignore */ }
      }
      return;
    }
    if (!opened) next();
    else handle = opened;
  }

  function applyConfig(): void {
    enabled = launcherConfig().showNetworkStatus !== false;
    if (document.body) document.body.classList.toggle('has-network-status', enabled);
    if (!started || !enabled) {
      clearCheck();
      clearRetry();
      paint();
      return;
    }
    if (!handle && !refused) subscribeAt(0);
    if (!checkTimer) {
      checkTimer = setInterval(function () {
        if (enabled && options.isActive()) runProbe(false);
      }, CHECK_MS);
    }
    runProbe(false);
    paint();
  }

  el.addEventListener('click', function (event) {
    event.preventDefault();
    event.stopPropagation();
    options.onOpenNetworkSettings();
  });

  return {
    start: function () {
      if (started) return;
      started = true;
      applyConfig();
    },
    stop: function () {
      started = false;
      clearCheck();
      clearRetry();
      probing = false;
      generation += 1;
      cancelHandle();
      link = null;
      internet = null;
      refused = false;
      painted = '';
      if (document.body) document.body.classList.remove('has-network-status');
    },
    applyConfig: applyConfig,
    refresh: applyConfig
  };
}
