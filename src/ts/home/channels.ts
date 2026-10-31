/**
 * Home -> Channels chip: Live TV's channels in a strip above the inputs row.
 * The first chip shows what is on now and opens Live TV; the others switch
 * Live TV to that channel. The chip only appears when the TV has channels
 * tuned (root.js getTvChannels): a TV used only with a set-top box has none.
 *
 * Setting launcher.channels: 'favourites' (LG's favourites, or every channel
 * when there are none), 'all', or 'off'.
 */

import {launchApp, launchAppViaRoot} from '@luna/luna.js';
import {getTvChannelNow, getTvChannels, openTvChannel} from '@luna/root.js';
import {indexInRow} from '@focus/focus-row.js';
import {BRAND} from '@lib/brand.js';
import {t} from '@lib/i18n.js';
import type {TvChannel} from '@luna/root.js';
import type {Config, LauncherConfig} from '@lib/types.js';

const LIVE_TV_ID = 'com.webos.app.livetv';
// Channel lists change rarely (a re-tune); read again after this long.
const LIST_MAX_AGE_MS = 30 * 60 * 1000;
// After a failed read (root not answering), read again this soon.
const RETRY_AFTER_FAIL_MS = 60 * 1000;
// The last list read, kept across restarts: reading it needs root, and the
// Channels chip and Live TV input shouldn't vanish when root doesn't answer.
const KEPT_KEY = BRAND.storage.channels;

export interface ChannelStripOptions {
  onToast?: (message: string) => void;
  onBeforeLaunch?: () => void;
  focusControl?: (el: Element | null) => boolean;
  onToggle?: (isOpen: boolean) => void;
  onAvailabilityChange?: () => void;
}

export interface ChannelStripHandle {
  refresh(): Promise<TvChannel[]>;
  available(): boolean;
  hasChannels(): boolean;
  isOpen(): boolean;
  toggle(): void;
  close(): void;
}

// The kept list, or null when this TV's list has never been read.
function keptChannels(): TvChannel[] | null {
  try {
    const kept = JSON.parse(localStorage.getItem(KEPT_KEY) || 'null');
    return kept && Array.isArray(kept.list) ? kept.list : null;
  } catch (err) {
    return null;
  }
}

function keepChannels(list: TvChannel[]): void {
  try {
    localStorage.setItem(KEPT_KEY, JSON.stringify({list: list, at: Date.now()}));
  } catch (err) { /* storage full: read again next time */ }
}

export function createChannelStrip(
  strip: HTMLElement | null,
  getConfig: () => Config,
  options: ChannelStripOptions
): ChannelStripHandle {
  const opts = options || {};
  const kept = keptChannels();
  let channels: TvChannel[] = kept || [];
  // Whether this TV's list has ever been read (now, or kept from before).
  let known = !!kept;
  let loadedAt = 0;
  let loading: Promise<TvChannel[]> | null = null;
  let open = false;

  function mode(): string {
    const launcher = getConfig().launcher || ({} as LauncherConfig);
    const value = launcher.channels;
    return value === 'all' || value === 'off' ? value : 'favourites';
  }

  // TV channels to offer: never hidden/skipped ones or radio; LG's favourites
  // when asked for and there are some.
  function shown(): TvChannel[] {
    if (mode() === 'off') return [];
    const tv = channels.filter(function (c) { return !c.hidden && !c.radio; });
    if (mode() === 'favourites') {
      const favourites = tv.filter(function (c) { return c.favourite; });
      if (favourites.length) return favourites;
    }
    return tv;
  }

  // Live TV input worth offering: any watchable channel, whatever the
  // setting; or the list has never been read (no root yet), when Live TV
  // stays offered rather than hidden.
  function hasChannels(): boolean {
    if (!known) return true;
    return channels.some(function (c) { return !c.hidden && !c.radio; });
  }

  function load(force: boolean): Promise<TvChannel[]> {
    if (loading) return loading;
    if (!force && loadedAt && Date.now() - loadedAt < LIST_MAX_AGE_MS) {
      return Promise.resolve(channels);
    }
    loading = getTvChannels().then(function (list) {
      keepChannels(list);
      return list;
    }, function () {
      return null;
    }).then(function (list) {
      const had = shown().length > 0;
      const hadAny = hasChannels();
      loading = null;
      if (list) {
        channels = list;
        known = true;
        loadedAt = Date.now();
      } else {
        // Keep the last list; read again in a minute, not in half an hour.
        loadedAt = Date.now() - LIST_MAX_AGE_MS + RETRY_AFTER_FAIL_MS;
      }
      if ((had !== shown().length > 0 || hadAny !== hasChannels()) && opts.onAvailabilityChange) {
        opts.onAvailabilityChange();
      }
      return channels;
    });
    return loading;
  }

  function chip(number: string, name: string, extraClass?: string):
    {button: HTMLButtonElement; number: HTMLSpanElement; label: HTMLSpanElement} {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'channel-chip focusable' + (extraClass ? ' ' + extraClass : '');
    button.dataset.focusIndex = String(indexInRow('channels', strip!.children.length));
    const num = document.createElement('span');
    num.className = 'channel-number';
    num.textContent = number;
    const label = document.createElement('span');
    label.className = 'channel-name';
    label.textContent = name;
    button.appendChild(num);
    button.appendChild(label);
    strip!.appendChild(button);
    return {button: button, number: num, label: label};
  }

  function openLiveTv() {
    if (opts.onBeforeLaunch) opts.onBeforeLaunch();
    close();
    return launchApp(LIVE_TV_ID).catch(function () {
      return launchAppViaRoot(LIVE_TV_ID);
    }).catch(function () {
      if (opts.onToast) opts.onToast(t('channels.openFailed'));
    });
  }

  function select(channel: TvChannel): void {
    if (opts.onBeforeLaunch) opts.onBeforeLaunch();
    close();
    openTvChannel(channel).catch(function () {
      if (opts.onToast) opts.onToast(t('channels.switchFailed', {channel: channel.name}));
    });
  }

  function render(): HTMLButtonElement {
    strip!.innerHTML = '';
    // What's on now: a text preview (a web app can't show the tuner's picture).
    const now = chip(t('inputs.liveTv'), t('channels.nowPlaying'), 'channel-chip-now');
    now.button.addEventListener('click', openLiveTv);
    getTvChannelNow().then(function (info) {
      if (!open) return;
      const channel = [info.number, info.name].filter(Boolean).join(' ');
      now.label.textContent = channel
        ? channel + (info.programme ? ' · ' + info.programme : '')
        : t('channels.watchLive');
    }).catch(function () {
      now.label.textContent = t('channels.watchLive');
    });
    shown().forEach(function (channel) {
      const c = chip(channel.number, channel.name);
      c.button.addEventListener('click', function () { select(channel); });
    });
    return now.button;
  }

  function show(): void {
    open = true;
    strip!.hidden = false;
    if (opts.onToggle) opts.onToggle(true);
    const first = render();
    if (opts.focusControl) opts.focusControl(first);
    // Pick up a re-tune while the strip is open.
    void load(false).then(function () {
      if (open && strip!.children.length - 1 !== shown().length) render();
    });
  }

  function close(): void {
    if (!open) return;
    open = false;
    strip!.hidden = true;
    strip!.innerHTML = '';
    if (opts.onToggle) opts.onToggle(false);
  }

  return {
    // Read the channel list if it is older than LIST_MAX_AGE_MS (at start and
    // on each return to Ember).
    refresh: function () { return load(false); },
    available: function () { return shown().length > 0; },
    hasChannels: hasChannels,
    isOpen: function () { return open; },
    toggle: function () {
      if (open) close();
      else show();
    },
    close: close
  };
}
