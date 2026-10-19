/**
 * In-app screensaver for Ember.
 *
 * After idle timeout while Ember is foreground, shows a full-screen
 * photo slideshow (from the same background sources as the home wallpaper)
 * with an optional large clock. Any remote key / pointer dismisses it.
 *
 * Runs only inside this app — does not replace the system-wide LG saver when
 * other apps are open. When active, motion (slideshow + slow Ken Burns) helps
 * OLED burn-in protection and makes the system saver less likely to steal focus.
 *
 * It is a thin host over the media-playback engine (the same video state
 * machine the wallpaper uses); its own policy is the crossfade pair, the clock,
 * the idle timer and the dismiss gestures.
 */

import {setClockTime} from '@lib/clock-format.js';
import {activeLocale} from '@lib/i18n.js';
import {normalizeBackgroundConfig} from './backgrounds.js';
import {resolveBackgroundCatalog, resolveBackgroundMedia} from './background-sources.js';
import {MEDIA_VIDEO, presetGradient, probeImage} from './media.js';
import type {MediaDescriptor, ProbeResult} from './media.js';
import {createMediaPlayback} from './media-playback.js';
import type {MediaPlayback} from './media-playback.js';
import {resolveLoungePaths} from '@lib/usb.js';
import type {BackgroundConfig, Config, LauncherConfig} from '@lib/types.js';

export interface CustomScreensaverOptions {
  rootEl: HTMLElement;
  getConfig: () => Config;
  /**
   * Whether the home wallpaper is presenting an aerial clip right now (the
   * background controller's `isPresentingAerial`). When it is, an aerial saver
   * reuses that warm clip instead of mounting a second, cold decoder.
   */
  isWallpaperAerial?: () => boolean;
  /** true while settings open / not foreground. */
  isBlocked?: () => boolean;
  onShow?: () => void;
  onHide?: () => void;
}

export interface CustomScreensaver {
  start(): void;
  stop(): void;
  resetIdle(): void;
  isActive(): boolean;
  applyConfig(): void;
  preview(): void;
  hide(): void;
}

interface ImageItem {
  url: string;
  gradient: boolean;
  kind?: string;
}

interface ImageContent {
  kind: 'images';
  items: ImageItem[];
}

type ScreensaverContent = {kind: 'video'} | ImageContent;

function formatDate(date: Date, timezone: string): string {
  const options: Intl.DateTimeFormatOptions = {weekday: 'long', day: 'numeric', month: 'long'};
  if (timezone) options.timeZone = timezone;
  try {
    return new Intl.DateTimeFormat(activeLocale(), options).format(date);
  } catch (err) {
    delete options.timeZone;
    return new Intl.DateTimeFormat(activeLocale(), options).format(date);
  }
}

export function createCustomScreensaver(options: CustomScreensaverOptions): CustomScreensaver {
  const rootEl = options.rootEl;
  const getConfig = options.getConfig;
  const isWallpaperAerial = typeof options.isWallpaperAerial === 'function'
    ? options.isWallpaperAerial
    : function () { return false; };
  const isBlocked = typeof options.isBlocked === 'function'
    ? options.isBlocked
    : function () { return false; };
  const onShow = options.onShow || function () {};
  const onHide = options.onHide || function () {};

  if (!rootEl) {
    return {
      start: function () {},
      stop: function () {},
      resetIdle: function () {},
      isActive: function () { return false; },
      applyConfig: function () {},
      preview: function () {},
      hide: function () {}
    };
  }

  const bgA = rootEl.querySelector<HTMLElement>('.custom-screensaver-bg-a');
  const bgB = rootEl.querySelector<HTMLElement>('.custom-screensaver-bg-b');
  const timeEl = rootEl.querySelector<HTMLElement>('.custom-screensaver-time');
  const dateEl = rootEl.querySelector<HTMLElement>('.custom-screensaver-date');

  let active = false;
  let stopped = true;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let slideTimer: ReturnType<typeof setInterval> | null = null;
  let clockTimer: ReturnType<typeof setInterval> | null = null;
  let images: ImageItem[] = [];
  let slideIndex = 0;
  let useA = true;
  let dismissArmed = false;
  let loadGen = 0;
  let slideGen = 0;
  let decodingPhoto: HTMLImageElement | null = null;
  let usbBackgroundPath = '';
  // The shared video state machine (aerial clips). Created on first use and
  // destroyed with the module; `stop`/`hide` release the decoder via it.
  let media: MediaPlayback | null = null;

  // app-inactive is a class flip (main.js) with no event of its own; a body
  // observer catches it the same way the home wallpaper's does.
  const bodyClassObserver = new MutationObserver(function () { syncVideo(); });

  function cfg(): {
    enabled: boolean;
    idleMinutes: number;
    slideSec: number;
    showClock: boolean;
    showDate: boolean;
    timezone: string;
    clockFormat?: string;
  } {
    const launcher: Partial<LauncherConfig> = getConfig().launcher || {};
    return {
      enabled: launcher.customScreensaver !== false,
      idleMinutes: typeof launcher.customScreensaverMinutes === 'number'
        ? launcher.customScreensaverMinutes
        : 5,
      slideSec: typeof launcher.customScreensaverSlideSec === 'number'
        ? launcher.customScreensaverSlideSec
        : 20,
      showClock: launcher.customScreensaverShowClock !== false,
      showDate: launcher.customScreensaverShowDate !== false,
      timezone: launcher.timezone || ''
    };
  }

  function clearIdleTimer() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function clearSlideTimer() {
    if (slideTimer) {
      clearInterval(slideTimer);
      slideTimer = null;
    }
  }

  function clearClockTimer() {
    if (clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  }

  function paintClock() {
    const c = cfg();
    const now = new Date();
    if (timeEl) {
      if (c.showClock) setClockTime(timeEl, now, c.timezone, c.clockFormat === '12');
      else timeEl.textContent = '';
      timeEl.hidden = !c.showClock;
    }
    if (dateEl) {
      dateEl.textContent = c.showDate ? formatDate(now, c.timezone) : '';
      dateEl.hidden = !c.showDate;
    }
  }

  // Whether the clip should be decoding right now. Not while our surface is
  // backgrounded to another app (document.hidden) or while an overlay such as
  // LG Settings holds the remote (body.app-inactive) — the same two states the
  // home wallpaper uses.
  function saverShouldPlay() {
    if (document.hidden) return false;
    if (document.body && document.body.classList.contains('app-inactive')) return false;
    return true;
  }

  function mediaEngine(): MediaPlayback {
    if (!media) {
      media = createMediaPlayback({
        mount: rootEl,
        getConfig: getConfig,
        shouldAnimate: function () { return active && saverShouldPlay(); },
        videoClassName: 'custom-screensaver-video',
        // The engine keeps the clip hidden until its first frame; paint the
        // configured gradient as the poster it is revealed over, so a buffering
        // clip reads as the gradient rather than the near-black saver base.
        onClipStart: function (gradient) {
          showImageFrame(gradient, true);
        },
        onFallback: function (gradient) {
          showVideoFallback(gradient);
        }
      });
    }
    return media;
  }

  // Pause on hidden/inactive and resume the same stream (play(), never a src
  // change), delegated to the engine.
  function syncVideo() {
    if (media) media.sync();
  }

  function applyLayer(el: HTMLElement | null, urlOrGradient: string, isGradient: boolean) {
    if (!el) return;
    if (isGradient) {
      el.style.backgroundImage = urlOrGradient;
      el.classList.remove('is-photo');
    } else {
      const safe = String(urlOrGradient).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      el.style.backgroundImage = 'url("' + safe + '")';
      el.classList.add('is-photo');
    }
  }

  function showSlide(index: number) {
    if (!images.length) return;
    const item = images[index % images.length];
    const gen = ++slideGen;
    // Resolve once the photo is downloaded and decoded (or after a timeout), so
    // the crossfade never starts on a photo that is still decoding. The element
    // is kept until the next slide so the decoded copy stays warm.
    const ready: Promise<ProbeResult | null> = item.gradient
      ? Promise.resolve(null)
      : probeImage(item.url);
    ready.then(function (res) {
      if (gen !== slideGen || !active) return;
      if (res && res.image) decodingPhoto = res.image;
      const front = useA ? bgA : bgB;
      const back = useA ? bgB : bgA;
      applyLayer(back, item.url, item.gradient);
      // Cross-fade: back fades in on top, then the old front drops out.
      if (back) {
        back.classList.add('is-front');
        back.classList.remove('is-back');
      }
      if (front) {
        front.classList.remove('is-front');
        front.classList.add('is-back');
      }
      useA = !useA;
    });
  }

  /**
   * Resolve what to show while the saver is up: aerial clips (video) when the
   * source is aerial, otherwise the whole photo set (motion-friendly). Returns
   * {kind:'video'} or {kind:'images', items}.
   */
  async function loadContent(): Promise<ScreensaverContent | null> {
    const gen = ++loadGen;
    const config = getConfig();
    const bg: BackgroundConfig = normalizeBackgroundConfig(config.background);

    if (bg.source === 'aerial') {
      // The media engine resolves the clips and falls back to the gradient when
      // they will not play (offline included), so no resolution here.
      return {kind: 'video'};
    }

    const out: ImageItem[] = [];

    if (bg.source === 'preset' || bg.source === 'animated-gradient') {
      out.push({url: presetGradient(bg.preset), gradient: true});
      return {kind: 'images', items: out};
    }

    if (!usbBackgroundPath) {
      try {
        const paths = await resolveLoungePaths(config);
        if (gen !== loadGen) return null;
        usbBackgroundPath = paths.backgroundPath || '';
      } catch (err) {
        usbBackgroundPath = '';
      }
    }

    // Prefer a multi-image set for motion (OLED-friendly) — the catalog asks the
    // source for the whole set rather than forcing mode = 'slideshow'.
    let list: MediaDescriptor[] = [];
    try {
      list = await resolveBackgroundCatalog(config, usbBackgroundPath);
    } catch (err) {
      list = [];
    }
    if (gen !== loadGen) return null;

    if (!list.length) {
      // Fall back to whatever the home wallpaper would use (single image).
      try {
        list = await resolveBackgroundMedia(config, usbBackgroundPath);
      } catch (err2) {
        list = [];
      }
    }
    if (gen !== loadGen) return null;

    // Deduplicate while preserving order. Video never reaches here (aerial is
    // handled above); the guard keeps a stray clip out of the photo cross-fade.
    const seen: Record<string, boolean> = {};
    for (let i = 0; i < list.length; i += 1) {
      const item = list[i];
      if (!item || !item.url || item.kind === MEDIA_VIDEO || seen[item.url]) continue;
      seen[item.url] = true;
      out.push({kind: item.kind, url: item.url, gradient: false});
    }

    if (!out.length) {
      out.push({url: presetGradient('midnight'), gradient: true});
    }
    return {kind: 'images', items: out};
  }

  function startSlideshow() {
    clearSlideTimer();
    // show() already painted the current photo on the front layer; fading it
    // into a second copy of itself read as a zoom jump.
    if (images.length <= 1) return;
    const sec = Math.max(8, cfg().slideSec || 20);
    slideTimer = setInterval(function () {
      slideIndex += 1;
      showSlide(slideIndex);
    }, sec * 1000);
  }

  // Paint an image or gradient on the front layer and reset the back layer, so
  // the crossfade always starts from a clean pair.
  function showImageFrame(urlOrGradient: string, isGradient: boolean) {
    if (bgA) {
      bgA.classList.add('is-front');
      bgA.classList.remove('is-back');
      applyLayer(bgA, urlOrGradient, isGradient);
    }
    if (bgB) {
      bgB.classList.add('is-back');
      bgB.classList.remove('is-front');
    }
  }

  // The transparent-over-the-wallpaper state (aerial reuse): a class on the
  // saver root, mirrored on the body so `body.settings-open` can let the
  // wallpaper show through the panel (main.css).
  function setReusingWallpaper(on: boolean) {
    rootEl.classList.toggle('reuses-wallpaper', on);
    document.body.classList.toggle('reuses-wallpaper', on);
  }

  // Release the decoder (leaving the saver, or the surface backgrounding).
  function teardownVideo() {
    if (media) media.stop();
  }

  function showVideoFallback(gradient: string) {
    teardownVideo();
    clearSlideTimer();
    const fallback = gradient || presetGradient('midnight');
    images = [{url: fallback, gradient: true}];
    showImageFrame(fallback, true);
  }

  function startImageContent(list: ImageItem[]) {
    // Coming from aerials: drop the clip so it does not play over the photos.
    setReusingWallpaper(false);
    teardownVideo();
    images = list;
    slideIndex = 0;
    useA = true;
    // Paint first frame immediately (crossfade starts empty otherwise).
    if (list[0]) showImageFrame(list[0].url, list[0].gradient);
    startSlideshow();
  }

  function startVideoContent() {
    images = [];
    clearSlideTimer();
    // Aerial source: when the home wallpaper is already presenting the clip,
    // reuse it (no second decoder) and render only the scrim and clock. When it
    // is not (the aerial fell back, or the surface is not showing one), keep
    // today's behaviour and play through the saver's own engine.
    if (isWallpaperAerial()) {
      teardownVideo();
      setReusingWallpaper(true);
      return;
    }
    setReusingWallpaper(false);
    mediaEngine().play();
  }

  // Load and start whatever the current settings call for; used on show and when
  // the settings change while the saver is up.
  async function beginContent(): Promise<void> {
    const content = await loadContent();
    if (!active || !content) return;
    if (content.kind === 'video') startVideoContent();
    else startImageContent(content.items);
  }

  function show(opts?: {force?: boolean}) {
    const force = !!(opts && opts.force);
    if (active) return;
    if (stopped) {
      if (!force) return;
      // Force preview: start listeners first.
      stopped = false;
      attachListeners();
    }
    if (!force) {
      if (isBlocked()) return;
      if (!cfg().enabled) return;
    }

    active = true;
    dismissArmed = false;
    clearIdleTimer();
    rootEl.hidden = false;
    rootEl.removeAttribute('hidden');
    rootEl.setAttribute('aria-hidden', 'false');
    rootEl.classList.add('visible');
    // Instant paint — no wait for CSS transition opacity 0→1 on first frame.
    rootEl.style.opacity = '1';
    document.body.classList.add('custom-screensaver-active');

    paintClock();
    clearClockTimer();
    clockTimer = setInterval(paintClock, 15000);

    beginContent();

    // Ignore the key/click that might still be settling; arm dismiss shortly.
    // Force previews stay up longer before dismiss is armed (remote bounce).
    setTimeout(function () {
      if (active) dismissArmed = true;
    }, force ? 1200 : 400);

    try { onShow(); } catch (err) { /* ignore */ }
  }

  function hide() {
    if (!active) return;
    active = false;
    dismissArmed = false;
    slideGen += 1; // drop any crossfade still waiting on a decode
    teardownVideo();
    setReusingWallpaper(false);
    clearSlideTimer();
    clearClockTimer();
    rootEl.classList.remove('visible');
    rootEl.style.opacity = '';
    rootEl.setAttribute('aria-hidden', 'true');
    rootEl.hidden = true;
    rootEl.setAttribute('hidden', '');
    document.body.classList.remove('custom-screensaver-active');
    try { onHide(); } catch (err) { /* ignore */ }
    scheduleIdle();
  }

  function scheduleIdle() {
    clearIdleTimer();
    if (stopped || active) return;
    if (!cfg().enabled) return;
    if (isBlocked()) return;
    if (typeof document !== 'undefined' && document.hidden) return;

    let mins = cfg().idleMinutes;
    if (isNaN(mins) || mins < 1) mins = 5;
    if (mins > 180) mins = 180;
    idleTimer = setTimeout(function () {
      idleTimer = null;
      show();
    }, mins * 60 * 1000);
  }

  function resetIdle() {
    if (active) {
      if (dismissArmed) hide();
      return;
    }
    scheduleIdle();
  }

  function isWakeEvent(event: Event | null): boolean {
    if (!event) return true;
    const t = event.type || '';
    // Magic Remote pointer drift should not dismiss; real presses / keys do.
    return t === 'keydown' || t === 'keyup' || t === 'pointerdown' ||
      t === 'mousedown' || t === 'click' || t === 'wheel' || t === 'touchstart';
  }

  function onActivity(event: Event) {
    if (stopped) return;
    if (active) {
      // Swallow all input while up so nothing under the overlay (dock tiles,
      // or Settings during a preview) reacts — including before dismiss arms.
      if (event) {
        try {
          event.preventDefault();
          event.stopPropagation();
        } catch (err) { /* ignore */ }
      }
      if (dismissArmed && isWakeEvent(event)) hide();
      return;
    }
    scheduleIdle();
  }

  // Dismiss/activity listeners plus the video lifecycle drivers. Attached once
  // on start (or a force preview) and removed on stop.
  function attachListeners() {
    document.addEventListener('keydown', onActivity, true);
    document.addEventListener('keyup', onActivity, true);
    document.addEventListener('pointerdown', onActivity, true);
    document.addEventListener('mousedown', onActivity, true);
    document.addEventListener('click', onActivity, true);
    document.addEventListener('wheel', onActivity, true);
    document.addEventListener('mousemove', onActivity, true);
    document.addEventListener('touchstart', onActivity, true);
    document.addEventListener('visibilitychange', syncVideo);
    bodyClassObserver.observe(document.body, {attributes: true, attributeFilter: ['class']});
  }

  function detachListeners() {
    document.removeEventListener('keydown', onActivity, true);
    document.removeEventListener('keyup', onActivity, true);
    document.removeEventListener('pointerdown', onActivity, true);
    document.removeEventListener('mousedown', onActivity, true);
    document.removeEventListener('click', onActivity, true);
    document.removeEventListener('wheel', onActivity, true);
    document.removeEventListener('mousemove', onActivity, true);
    document.removeEventListener('touchstart', onActivity, true);
    document.removeEventListener('visibilitychange', syncVideo);
    bodyClassObserver.disconnect();
  }

  function start() {
    if (!stopped) {
      scheduleIdle();
      return;
    }
    stopped = false;
    attachListeners();
    scheduleIdle();
  }

  function stop() {
    stopped = true;
    clearIdleTimer();
    hide();
    detachListeners();
    if (media) {
      media.destroy();
      media = null;
    }
  }

  function applyConfig() {
    if (stopped) return;
    if (!cfg().enabled) {
      clearIdleTimer();
      if (active) hide();
      return;
    }
    if (active) {
      paintClock();
      // Settings changed under the saver: reload so a new source (e.g. aerial)
      // takes over rather than leaving the old content up.
      beginContent();
    } else {
      scheduleIdle();
    }
  }

  return {
    start: start,
    stop: stop,
    resetIdle: resetIdle,
    isActive: function () { return active; },
    applyConfig: applyConfig,
    /**
     * Force-show (settings Preview / SSH flag / launch params).
     * Ignores enabled toggle and isBlocked so demos always appear.
     */
    preview: function () {
      if (stopped) start();
      // Hide any half-state then force show.
      if (active) {
        active = false;
        slideGen += 1;
        teardownVideo();
        clearSlideTimer();
        clearClockTimer();
      }
      show({force: true});
    },
    hide: hide
  };
}
