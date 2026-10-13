import {normalizeBackgroundConfig} from './backgrounds.js';
import {resolveBackgroundMedia} from './background-sources.js';
import {createMediaPlayback} from './media-playback.js';
import {presetGradient, probeImage} from './media.js';
import type {AerialChange} from './media-playback.js';
import type {MediaDescriptor} from './media.js';
import {resolveLoungePaths} from '@lib/usb.js';
import type {BackgroundConfig, Config} from '@lib/types.js';

export type {AerialChange} from './media-playback.js';

export interface BackgroundElements {
  backgroundLayer: HTMLElement;
  scrim: HTMLElement;
  onAerialChange?: (change: AerialChange) => void;
  onToast?: (message: string) => void;
}

export interface BackgroundController {
  refresh(opts?: {reuse?: boolean}): Promise<void>;
  stepAerial(direction: number): AerialChange | null;
  /**
   * Whether the wallpaper is presenting an aerial clip right now: the clip is
   * revealed on screen, not merely configured. False while the source is not
   * aerial, while a clip is still loading behind its poster, and after a
   * fallback to the gradient. The in-app saver reuses the wallpaper's clip only
   * when this is true (see screensaver.ts).
   */
  isPresentingAerial(): boolean;
  destroy(): void;
}

export function createBackgroundController(
  elements: BackgroundElements,
  getConfig: () => Config
): BackgroundController {
  const layer = elements.backgroundLayer;
  const scrim = elements.scrim;
  let slideshowTimer: ReturnType<typeof setInterval> | null = null;
  let slideshowIndex = 0;
  let slideshowMedia: MediaDescriptor[] = [];
  let usbBackgroundPath = '';
  let refreshGen = 0;
  let videoPlaying = false;
  // Live "an aerial clip is on screen" flag for the saver's reuse decision,
  // toggled by the engine's reveal (onPlaying) and release (onStop/onFallback).
  let aerialOnScreen = false;
  // What the wallpaper on screen was made from (see refresh reuse).
  let appliedSignature = '';

  function applyGradientCss(gradient: string, animated: boolean) {
    layer.style.backgroundImage = gradient;
    layer.style.backgroundColor = '#0a0a0f';
    layer.style.backgroundSize = 'cover';
    layer.style.backgroundPosition = 'center center';
    layer.style.backgroundRepeat = 'no-repeat';
    layer.classList.remove('has-image');
    layer.classList.remove('ken-burns');
    layer.classList.toggle('gradient-animated', !!animated);
    syncMovingBackground();
  }

  function applyPreset(name: string, animated: boolean) {
    applyGradientCss(presetGradient(name), animated);
  }

  // Frosted glass over a moving wallpaper is re-blurred every frame (13 fps on
  // a webOS 25 OLED); body.bg-moving swaps the blur for a tint (main.css).
  function syncMovingBackground() {
    document.body.classList.toggle('bg-moving',
      videoPlaying ||
      layer.classList.contains('ken-burns') || layer.classList.contains('gradient-animated'));
  }

  function applyImage(url: string) {
    const config = getConfig();
    const bg: BackgroundConfig = normalizeBackgroundConfig(config.background);
    // Quote-safe CSS url(); escape backslashes and quotes for file paths.
    const safe = String(url).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    layer.style.backgroundColor = '#0a0a0f';
    layer.style.backgroundImage = 'url("' + safe + '")';
    layer.style.backgroundSize = 'cover';
    layer.style.backgroundPosition = 'center center';
    layer.style.backgroundRepeat = 'no-repeat';
    layer.classList.add('has-image');
    layer.classList.remove('gradient-animated');

    if (bg.kenBurns) {
      layer.classList.add('ken-burns');
    } else {
      layer.classList.remove('ken-burns');
    }
    syncMovingBackground();
  }

  function applyScrim() {
    const config = getConfig();
    const opacity = (config.background && config.background.overlayOpacity) || 0.45;
    scrim.style.opacity = String(opacity);
  }

  function clearSlideshow() {
    if (slideshowTimer) {
      clearInterval(slideshowTimer);
      slideshowTimer = null;
    }
  }

  // Whether the wallpaper should be in motion right now. Not while our surface
  // is backgrounded to another app (document.hidden) or while an overlay such as
  // LG Settings holds the remote (body.app-inactive) — the two states that still
  // the 4K photo slideshow and the CSS zoom/gradient in main.css. The in-app
  // Settings panel is neither: the wallpaper is its backdrop, so it keeps moving.
  function wallpaperShouldAnimate() {
    if (document.hidden) return false;
    if (document.body && document.body.classList.contains('app-inactive')) return false;
    return true;
  }

  // The aerial video state machine, shared with the in-app screensaver.
  const media = createMediaPlayback({
    mount: layer,
    getConfig: getConfig,
    shouldAnimate: wallpaperShouldAnimate,
    videoClassName: 'background-video',
    onChange: elements.onAerialChange,
    // Gradient poster behind the clip until its first frame paints.
    onClipStart: function (gradient) {
      layer.style.backgroundImage = gradient;
      layer.style.backgroundColor = '#0a0a0f';
      layer.classList.add('has-video');
      layer.classList.remove('has-image');
      layer.classList.remove('ken-burns');
      layer.classList.remove('gradient-animated');
    },
    onPlaying: function () {
      videoPlaying = true;
      aerialOnScreen = true;
      layer.classList.add('has-video');
      layer.classList.remove('has-image');
      layer.classList.remove('ken-burns');
      syncMovingBackground();
    },
    onStop: function () {
      videoPlaying = false;
      aerialOnScreen = false;
      layer.classList.remove('has-video');
      syncMovingBackground();
    },
    onFallback: function (gradient) {
      // Leaving the signature unset is what lets a later return retry the clips
      // once connectivity is back (see refresh).
      appliedSignature = '';
      applyGradientCss(gradient, false);
    }
  });

  function syncVideoPlayback() {
    media.sync();
  }

  document.addEventListener('visibilitychange', syncVideoPlayback);
  window.addEventListener('focus', syncVideoPlayback);
  window.addEventListener('blur', syncVideoPlayback);
  // app-inactive is a class flip (main.js) with no event of its own; a body
  // observer catches it the same way main.css reacts to the class.
  const bodyClassObserver = new MutationObserver(syncVideoPlayback);
  if (document.body) {
    bodyClassObserver.observe(document.body, {attributes: true, attributeFilter: ['class']});
  }

  function showSlideshowImage() {
    if (!slideshowMedia.length) return;
    applyImage(slideshowMedia[slideshowIndex % slideshowMedia.length].url);
    slideshowIndex += 1;
  }

  // Not while another app or TV Settings (an overlay) is in front: the next
  // 4K photo would be decoded and drawn underneath for nobody to see.
  function slideshowTick() {
    if (!wallpaperShouldAnimate()) return;
    showSlideshowImage();
  }

  function startSlideshow(mediaList: MediaDescriptor[], intervalSec: number) {
    slideshowMedia = mediaList;
    slideshowIndex = 0;
    showSlideshowImage();
    slideshowTimer = setInterval(slideshowTick, intervalSec * 1000);
  }

  /**
   * Try each candidate URL until one decodes. webOS 4 may reject one form of
   * path but accept another (relative vs absolute file://).
   */
  async function pickLoadableMedia(candidates: MediaDescriptor[]): Promise<MediaDescriptor | null> {
    for (let i = 0; i < candidates.length; i += 1) {
      const item = candidates[i];
      if (!item || !item.url) continue;
      // Apply optimistically so the user sees something while we verify.
      applyImage(item.url);
      const res = await probeImage(item.url);
      if (res.ok) return item;
    }
    return null;
  }

  // The online wallpaper link last reported as not loading (once per link).
  let reportedFailure = '';

  /**
   * An online wallpaper didn't load: say so once per link. Without this the
   * home screen quietly showed a gradient, which read as "the wallpaper
   * setting does nothing" (seen with an image host's page link pasted in
   * place of the image's own link).
   */
  function reportOnlineFailure(bg: BackgroundConfig, urls: string[]) {
    if (bg.source !== 'url') return;
    const key = urls.join(' ');
    if (key === reportedFailure) return;
    reportedFailure = key;
    if (elements.onToast) {
      elements.onToast('The wallpaper link didn\u2019t load as an image. Use a direct image link ' +
        '(it usually ends in .jpg or .png), and check the TV is online.');
    }
  }

  // What the wallpaper on screen was made from. Computed from the resolved
  // config so a remote clip switch can be folded in after it is persisted.
  function configSignature(config?: Config): string {
    const c = config || getConfig();
    return JSON.stringify([
      c.background || {}, c.profile || '', !!(c.launcher && c.launcher.perfMode)
    ]);
  }

  /**
   * @param {{reuse?: boolean}} [opts] reuse: returning from an app. When the
   *   wallpaper settings are unchanged it is already on screen (a slideshow
   *   keeps going); loading it again decoded the 4K photo and asked the TV for
   *   USB folders on every return, which slow TVs felt as lag.
   */
  async function refresh(opts?: {reuse?: boolean}): Promise<void> {
    const config = getConfig();
    const signature = configSignature(config);
    if (opts && opts.reuse && appliedSignature && signature === appliedSignature) {
      applyScrim();
      // Returning from an app: the clip is already loaded (unpainted changes are
      // ignored), so just resume the decoder we paused on the way out.
      syncVideoPlayback();
      return;
    }
    appliedSignature = '';
    const gen = ++refreshGen;
    const ok = await paint(config, gen);
    // Not while the aerial fell back to its gradient: leaving the signature
    // unset is what lets a later return retry the clips once online.
    if (ok && gen === refreshGen && !media.hasFallenBack()) appliedSignature = signature;
  }

  // Put the configured wallpaper up. False when it fell back to a gradient
  // because the pictures didn't load (a return then tries them again).
  async function paint(config: Config, gen: number): Promise<boolean> {
    clearSlideshow();
    applyScrim();

    const bg: BackgroundConfig = normalizeBackgroundConfig(config.background);

    if (bg.source === 'preset' || bg.source === 'animated-gradient') {
      media.stop();
      applyPreset(bg.preset || 'warm-gradient', bg.source === 'animated-gradient');
      return true;
    }

    if (bg.source === 'aerial') {
      return media.play();
    }

    // Left the aerial source: release the decoder before painting photos.
    media.stop();

    if (!usbBackgroundPath) {
      const paths = await resolveLoungePaths(config);
      if (gen !== refreshGen) return false;
      usbBackgroundPath = paths.backgroundPath || '';
    }

    const resolved = await resolveBackgroundMedia(config, usbBackgroundPath);
    if (gen !== refreshGen) return false;

    if (!resolved.length) {
      applyPreset(bg.preset || 'warm-gradient', false);
      return false;
    }

    const urls = resolved.map(function (item) { return item.url; });

    if (bg.mode === 'slideshow' && resolved.length > 1) {
      // Verify at least the first image loads; still run the full list.
      const first = await pickLoadableMedia(resolved);
      if (gen !== refreshGen) return false;
      if (!first) {
        applyPreset(bg.preset || 'warm-gradient', false);
        reportOnlineFailure(bg, urls);
        return false;
      }
      startSlideshow(resolved, bg.slideshowIntervalSec || 300);
      return true;
    }

    const loaded = await pickLoadableMedia(resolved);
    if (gen !== refreshGen) return false;
    if (!loaded) {
      applyPreset(bg.preset || 'warm-gradient', false);
      reportOnlineFailure(bg, urls);
      return false;
    }
    reportedFailure = '';
    return true;
  }

  return {
    refresh: refresh,

    /**
     * Channel Up / Channel Down (and Blue) on an aerial wallpaper: step to the
     * next / previous clip, delegated to the media engine. Returns the landed
     * clip ({id, title, mode}) or null when there is nothing to switch to.
     */
    stepAerial: function (direction: number): AerialChange | null {
      const change = media.step(direction);
      // The host's persistence lands first (the engine's onChange); only then
      // fold the new choice into the reuse signature.
      if (change) appliedSignature = configSignature();
      return change;
    },

    isPresentingAerial: function () { return aerialOnScreen; },

    destroy: function () {
      clearSlideshow();
      media.destroy();
      document.removeEventListener('visibilitychange', syncVideoPlayback);
      window.removeEventListener('focus', syncVideoPlayback);
      window.removeEventListener('blur', syncVideoPlayback);
      bodyClassObserver.disconnect();
    }
  };
}
