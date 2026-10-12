// The media-playback engine: the aerial video state machine, extracted from the
// near-verbatim copies the wallpaper (`background.ts`) and the in-app
// screensaver (`screensaver.ts`) each carried. It plays the video descriptors a
// source resolves, keeps the Single-retry vs Slideshow-skip behaviour exactly,
// and drops to the configured gradient when every attempt has failed. The host
// supplies the mount element, the config accessor, the "should animate"
// predicate and the callbacks that paint its own poster/classes; the engine
// notifies rather than owning the host's policy.

import {normalizeBackgroundConfig} from './backgrounds.js';
import {resolveBackgroundCatalog, resolveBackgroundMedia} from './background-sources.js';
import {MEDIA_VIDEO, presetGradient, shuffled} from './media.js';
import type {MediaDescriptor} from './media.js';
import type {BackgroundConfig, Config} from '@lib/types.js';

export interface AerialChange {
  id: string;
  title: string;
  mode: string;
}

export interface MediaPlaybackOptions {
  /** Where the engine mounts its <video>. */
  mount: HTMLElement;
  getConfig: () => Config;
  /**
   * Whether the surface should be in motion right now. Not while backgrounded
   * to another app (document.hidden) or while an overlay such as LG Settings
   * holds the remote (body.app-inactive).
   */
  shouldAnimate: () => boolean;
  /** A manual Channel Up/Down landed on a clip (the host persists Single). */
  onChange?: (change: AerialChange) => void;
  /** The class name for the mounted <video>. */
  videoClassName: string;
  /** A clip attempt is starting: paint the poster and set the host's classes. */
  onClipStart?: (gradient: string, el: HTMLVideoElement) => void;
  /** The clip's first frame is up. */
  onPlaying?: (el: HTMLVideoElement) => void;
  /** Every attempt failed: show this gradient (the screen is never blank). */
  onFallback?: (gradient: string) => void;
  /** The <video> was released: drop the host's classes. */
  onStop?: () => void;
  /** Test seam: build the media element instead of a real <video>. */
  createVideo?: () => HTMLVideoElement;
}

export interface MediaPlayback {
  /** Resolve the current config's clips and start playing. False on fallback. */
  play(): Promise<boolean>;
  /** Pause on hidden/inactive and resume the same stream (never a src change). */
  sync(): void;
  /** Channel Up/Down stepping; null when not aerial or fallen back. */
  step(direction: number): AerialChange | null;
  /** Release the decoder and the element. */
  stop(): void;
  /** stop() and mark the engine dead (visibility callbacks become no-ops). */
  destroy(): void;
  hasFallenBack(): boolean;
}

function defaultCreateVideo(className: string): HTMLVideoElement {
  const v = document.createElement('video');
  v.className = className;
  v.muted = true;
  v.defaultMuted = true;
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.setAttribute('webkit-playsinline', '');
  v.setAttribute('aria-hidden', 'true');
  v.autoplay = true;
  v.preload = 'auto';
  v.loop = true;
  return v;
}

export function createMediaPlayback(options: MediaPlaybackOptions): MediaPlayback {
  const mount = options.mount;
  const getConfig = options.getConfig;
  const shouldAnimate = options.shouldAnimate;

  // A generation counter: every play()/stop() invalidates in-flight attempts so
  // a stale play()/error from a clip we already left is ignored.
  let gen = 0;
  let videoEl: HTMLVideoElement | null = null;
  // Aerial Slideshow: the ordered clips and where we are in them.
  let videoClips: MediaDescriptor[] = [];
  // The settings catalog, for Single-mode stepping (the "next clip" order).
  let videoCatalog: MediaDescriptor[] = [];
  let videoSlideshow = false;
  let videoIndex = 0;
  // Failed starts since a clip last played, the id of the load in flight (so a
  // play() rejection and the element's "error" event count once), and whether
  // we've dropped to the gradient.
  let videoFailures = 0;
  let videoAttempt = 0;
  let videoHandledAttempt = 0;
  let videoErrorListener: (() => void) | null = null;
  let videoFellBack = false;
  let destroyed = false;

  function ensureVideo(): HTMLVideoElement {
    if (videoEl) return videoEl;
    const v = options.createVideo ? options.createVideo() : defaultCreateVideo(options.videoClassName);
    v.addEventListener('playing', onVideoPlaying);
    v.addEventListener('ended', onVideoEnded);
    mount.appendChild(v);
    videoEl = v;
    return v;
  }

  function onVideoPlaying(): void {
    videoFailures = 0;
    if (options.onPlaying && videoEl) options.onPlaying(videoEl);
  }

  // Slideshow only: a clip reached its natural end, so roll onto the next one
  // (clips are never cut off by a timer). Looping Single clips never end.
  function onVideoEnded(): void {
    if (!videoSlideshow || videoClips.length <= 1) return;
    videoIndex = (videoIndex + 1) % videoClips.length;
    playVideoClip(normalizeBackgroundConfig(getConfig().background), gen);
  }

  // Release the decoder and the network request (source change or teardown).
  function teardownVideo(): void {
    videoSlideshow = false;
    videoClips = [];
    videoIndex = 0;
    if (!videoEl) return;
    const v = videoEl;
    videoEl = null;
    if (videoErrorListener) v.removeEventListener('error', videoErrorListener);
    videoErrorListener = null;
    v.removeEventListener('playing', onVideoPlaying);
    v.removeEventListener('ended', onVideoEnded);
    try { v.pause(); } catch (err) { /* ignore */ }
    v.removeAttribute('src');
    try { v.load(); } catch (err) { /* ignore */ }
    if (v.parentNode) v.parentNode.removeChild(v);
    if (options.onStop) options.onStop();
  }

  // How many failed starts to absorb before giving up on aerials: Single gets
  // one retry, Slideshow gets a single pass over the list.
  function maxVideoFailures(): number {
    return videoSlideshow ? videoClips.length - 1 : 1;
  }

  // Drop the video and put up the gradient — what images do when they don't
  // load, so the surface is never blank.
  function failToGradient(bg: BackgroundConfig): void {
    videoFellBack = true;
    teardownVideo();
    if (options.onFallback) options.onFallback(presetGradient(bg.preset));
  }

  // A clip would not start (offline, unsupported container). Slideshow skips it
  // and takes the next; Single retries it once. Only when every attempt has
  // failed does the surface drop to the configured gradient.
  function handleVideoFailure(attemptId: number, myGen: number): void {
    // The element's "error" event and the rejected play() both report the same
    // attempt; handle it once. A stale id (a reload already moved on) is ignored.
    if (attemptId !== videoAttempt || attemptId === videoHandledAttempt) return;
    if (myGen !== gen) return;
    videoHandledAttempt = attemptId;
    // Backgrounded: defer, and let the resume path start the next attempt.
    if (!shouldAnimate()) return;
    const bg = normalizeBackgroundConfig(getConfig().background);
    videoFailures += 1;
    if (videoFailures > maxVideoFailures()) {
      failToGradient(bg);
      return;
    }
    if (videoSlideshow) {
      // Skip the broken clip and take the next one round the list.
      videoIndex = (videoIndex + 1) % videoClips.length;
    } else if (videoEl) {
      // Single: retry the same clip. Drop the failed source so the next attempt
      // re-sets it and the TV makes a fresh request.
      videoEl.removeAttribute('src');
      try { videoEl.load(); } catch (err) { /* ignore */ }
    }
    playVideoClip(bg, myGen);
  }

  // Play videoClips[videoIndex]: looping in Single mode, once in Slideshow (the
  // next clip then rides in on "ended"). True once playing.
  async function playVideoClip(bg: BackgroundConfig, myGen: number): Promise<boolean> {
    if (!videoClips.length) return false;
    if (!shouldAnimate()) return false;
    const attempt = ++videoAttempt;
    const clip = videoClips[videoIndex % videoClips.length];
    const video = ensureVideo();
    video.loop = !videoSlideshow;
    // Bind the "error" event to this load, and detach the previous load's so a
    // late error from a clip we already moved on from is not counted again.
    if (videoErrorListener) video.removeEventListener('error', videoErrorListener);
    videoErrorListener = function () {
      handleVideoFailure(attempt, myGen);
    };
    video.addEventListener('error', videoErrorListener);

    if (options.onClipStart) options.onClipStart(presetGradient(bg.preset), video);
    if (video.getAttribute('src') !== clip.url) {
      video.setAttribute('src', clip.url);
    }
    try {
      await video.play();
    } catch (err: any) {
      if (myGen !== gen) return false;
      // play() aborted by a pause (the surface hid mid-start) is not a decode
      // failure: keep the element for the resume path, not the gradient.
      if (err && err.name === 'AbortError') return false;
      if (!shouldAnimate()) return false;
      handleVideoFailure(attempt, myGen);
      return false;
    }
    if (myGen !== gen) return false;
    onVideoPlaying();
    return true;
  }

  async function play(): Promise<boolean> {
    const myGen = ++gen;
    videoFellBack = false;
    const config = getConfig();
    const bg = normalizeBackgroundConfig(config.background);

    let resolved: MediaDescriptor[] = [];
    try {
      resolved = await resolveBackgroundMedia(config, '');
    } catch (err) {
      resolved = [];
    }
    if (myGen !== gen) return false;

    const clips = resolved.filter(function (item) {
      return item && item.kind === MEDIA_VIDEO && item.url;
    });
    if (!clips.length) {
      failToGradient(bg);
      return false;
    }

    // Offline: don't fire the whole catalog at Apple's CDN; hold the gradient
    // and let a later return try again when connectivity is back.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      failToGradient(bg);
      return false;
    }

    videoSlideshow = bg.mode === 'slideshow' && clips.length > 1;
    videoClips = videoSlideshow && bg.shuffle ? shuffled(clips) : clips;
    videoIndex = 0;
    videoFailures = 0;
    videoHandledAttempt = 0;

    // The settings catalog, so Single-mode stepping walks the whole set even
    // though `resolve` returned only the chosen clip.
    let catalog: MediaDescriptor[] = [];
    try {
      catalog = await resolveBackgroundCatalog(config, '');
    } catch (err) {
      catalog = [];
    }
    if (myGen !== gen) return false;
    const catalogClips = catalog.filter(function (item) {
      return item && item.kind === MEDIA_VIDEO && item.url;
    });
    videoCatalog = catalogClips.length ? catalogClips : clips;

    const ok = await playVideoClip(bg, myGen);
    return ok && !videoFellBack;
  }

  function clipIndex(list: MediaDescriptor[], clip: MediaDescriptor): number {
    for (let i = 0; i < list.length; i += 1) {
      if ((clip.id && list[i].id === clip.id) || list[i].url === clip.url) return i;
    }
    return 0;
  }

  /**
   * Channel Up / Channel Down on an aerial wallpaper: step to the next /
   * previous clip. Single steps the settings catalog; Slideshow steps the order
   * actually playing (shuffled if enabled). Returns the landed clip
   * ({id, title, mode}) or null when there is nothing to switch to.
   */
  function step(direction: number): AerialChange | null {
    const dir = direction < 0 ? -1 : 1;
    const bg = normalizeBackgroundConfig(getConfig().background);
    if (bg.source !== 'aerial') return null;
    if (videoFellBack) return null;
    if (!videoClips.length) return null;

    let clip: MediaDescriptor;
    if (videoSlideshow) {
      if (videoClips.length < 2) return null;
      videoIndex = (videoIndex + dir + videoClips.length) % videoClips.length;
      clip = videoClips[videoIndex];
    } else {
      const current = videoClips[videoIndex % videoClips.length];
      const catalog = videoCatalog.length ? videoCatalog : videoClips;
      const nextIndex = (clipIndex(catalog, current) + dir + catalog.length) % catalog.length;
      clip = catalog[nextIndex];
      // Single plays one clip: swap in the landed clip as the one on screen.
      videoClips = [clip];
      videoIndex = 0;
    }
    if (!clip || !clip.url) return null;

    // A manual pick starts clean: don't inherit a pending failure count.
    videoFailures = 0;
    videoHandledAttempt = 0;
    playVideoClip(bg, gen);

    const change = {
      id: clip.id || '',
      title: clip.title || '',
      mode: videoSlideshow ? 'slideshow' : 'single'
    };
    // Tell the host first so its persistence (Single) lands before it folds the
    // new choice into its reuse signature — a later return reuses this clip.
    if (options.onChange) options.onChange(change);
    return change;
  }

  // Pause the decoder rather than tearing it down, and resume the same stream
  // (play(), never a src change), so returning from an app neither restarts the
  // clip nor re-fetches it. Also starts a first attempt that was skipped while
  // the surface was hidden.
  function sync(): void {
    if (destroyed) return;
    if (!shouldAnimate()) {
      if (videoEl && !videoEl.paused) {
        try { videoEl.pause(); } catch (err) { /* ignore */ }
      }
      return;
    }
    if (!videoEl) {
      if (videoClips.length) {
        playVideoClip(normalizeBackgroundConfig(getConfig().background), gen);
      }
      return;
    }
    if (!videoEl.paused) return;
    if (videoEl.error) {
      // The clip broke while we were away: start a fresh attempt (retry/skip)
      // rather than play() the dead element, which would reject silently.
      playVideoClip(normalizeBackgroundConfig(getConfig().background), gen);
      return;
    }
    try {
      const p = videoEl.play();
      if (p && p.catch) p.catch(function () {
        // A source that died while we were away can reject here; if the element
        // now reports an error, make a fresh attempt instead of stalling.
        if (videoEl && videoEl.error) {
          playVideoClip(normalizeBackgroundConfig(getConfig().background), gen);
        }
      });
    } catch (err) { /* ignore */ }
  }

  function stop(): void {
    gen += 1;
    // A deliberate teardown (a source change, or destroy): clear the fallback
    // flag so the host's reuse signature can be set again after repainting.
    videoFellBack = false;
    teardownVideo();
  }

  function destroy(): void {
    destroyed = true;
    stop();
  }

  return {
    play: play,
    sync: sync,
    step: step,
    stop: stop,
    destroy: destroy,
    hasFallenBack: function () { return videoFellBack; }
  };
}
