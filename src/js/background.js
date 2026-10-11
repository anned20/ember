import {MEDIA_VIDEO, normalizeBackgroundConfig, resolveBackgroundMedia} from './backgrounds.js';
import {resolveLoungePaths} from './usb.js';

const PRESETS = {
  'warm-gradient': 'linear-gradient(135deg, #1a1028 0%, #3d1f2e 40%, #7a3b2e 100%)',
  'cool-gradient': 'linear-gradient(145deg, #0b1220 0%, #162447 50%, #1f4068 100%)',
  'midnight': 'linear-gradient(180deg, #050508 0%, #12121a 60%, #1c1c28 100%)',
  'ember': 'radial-gradient(ellipse at 30% 20%, #4a1942 0%, #1a0a14 50%, #080408 100%)'
};

/** Fisher–Yates copy (aerial Slideshow order). */
function shuffled(items) {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function preloadImage(url) {
  return new Promise(function (resolve) {
    if (!url) {
      resolve(false);
      return;
    }
    const img = new Image();
    let settled = false;
    function done(ok) {
      if (settled) return;
      settled = true;
      resolve(!!ok);
    }
    img.onload = function () {
      done(true);
    };
    img.onerror = function () {
      done(false);
    };
    // Older webOS can hang forever on a bad URL — bound the wait.
    setTimeout(function () {
      // naturalWidth > 0 means decode progressed even if onload is flaky.
      done(!!(img.complete && img.naturalWidth > 0));
    }, 8000);
    try {
      img.src = url;
    } catch (err) {
      done(false);
    }
  });
}

export function createBackgroundController(elements, getConfig) {
  const layer = elements.backgroundLayer;
  const scrim = elements.scrim;
  let slideshowTimer = null;
  let slideshowIndex = 0;
  let slideshowMedia = [];
  let usbBackgroundPath = '';
  let refreshGen = 0;
  // Aerial clip: two <video> elements double-buffered in the layer while the
  // source is "aerial". Single loops the chosen clip; Slideshow rides "ended"
  // onto the next, which is preloaded into the idle element near the end of the
  // current one — so the swap cross-fades instead of showing the black frame of
  // a freshly-set src.
  const PRELOAD_LEAD_SEC = 15;
  let videoEls = [];
  let videoFront = 0;
  let videoPlaying = false;
  // Aerial Slideshow: the ordered clips and where we are in them.
  let videoClips = [];
  let videoSlideshow = false;
  let videoIndex = 0;
  let videoPreloaded = -1;
  // Aerial failure handling: failed starts since a clip last played, the id of
  // the load in flight (so a play() rejection and the element's "error" event
  // for the same attempt count once), and whether we've dropped to the gradient.
  let videoFailures = 0;
  let videoAttempt = 0;
  let videoHandledAttempt = 0;
  // Bound to the attempt in flight so the element's "error" event reports the
  // same load as the play() rejection, and a retry detaches the old one.
  let videoErrorListener = null;
  let videoFellBack = false;
  let videoSwapTimer = null;
  // What the wallpaper on screen was made from (see refresh reuse).
  let appliedSignature = '';

  function applyPreset(name, animated) {
    const gradient = PRESETS[name] || PRESETS['warm-gradient'];
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

  // Frosted glass over a moving wallpaper is re-blurred every frame (13 fps on
  // a webOS 25 OLED); body.bg-moving swaps the blur for a tint (main.css).
  function syncMovingBackground() {
    document.body.classList.toggle('bg-moving',
      videoPlaying ||
      layer.classList.contains('ken-burns') || layer.classList.contains('gradient-animated'));
  }

  function applyImage(url) {
    const config = getConfig();
    const bg = normalizeBackgroundConfig(config.background);
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

  function onVideoPlaying() {
    videoPlaying = true;
    videoFailures = 0;
    layer.classList.add('has-video');
    layer.classList.remove('has-image');
    layer.classList.remove('ken-burns');
    syncMovingBackground();
  }

  // Drop the video and put up the configured gradient — what images do when
  // they don't load, so the home screen is never blank.
  function fallbackToGradient(bg) {
    teardownVideo();
    applyPreset(bg.preset || 'warm-gradient', false);
  }

  // How many failed starts to absorb before giving up on aerials: Single gets
  // one retry, Slideshow gets a single pass over the list.
  function maxVideoFailures() {
    return videoSlideshow ? videoClips.length - 1 : 1;
  }

  // A clip would not start (offline, unsupported container). Slideshow skips it
  // and takes the next; Single retries it once. Only when every attempt has
  // failed does the wallpaper drop to the configured gradient.
  function failToGradient(bg) {
    videoFellBack = true;
    // Leave the applied signature cleared so a return (or a settings change)
    // paints aerials again once connectivity is back; until then the gradient
    // holds the screen.
    appliedSignature = '';
    fallbackToGradient(bg);
  }

  function handleVideoFailure(attemptId) {
    // The element's "error" event and the rejected play() both report the same
    // attempt; handle it once. A stale id (a reload already moved on) is ignored.
    if (attemptId !== videoAttempt || attemptId === videoHandledAttempt) return;
    videoHandledAttempt = attemptId;
    // Backgrounded: defer, and let the resume path start the next attempt.
    if (!wallpaperShouldAnimate()) return;
    const bg = normalizeBackgroundConfig(getConfig().background);
    videoFailures += 1;
    if (videoFailures > maxVideoFailures()) {
      failToGradient(bg);
      return;
    }
    const front = frontVideo();
    if (videoSlideshow) {
      // Skip the broken clip and take the next one round the list.
      videoIndex = (videoIndex + 1) % videoClips.length;
    } else if (front) {
      // Single: retry the same clip. Drop the failed source so playVideoClip
      // re-sets it and the TV makes a fresh request.
      front.removeAttribute('src');
      try { front.load(); } catch (err) { /* ignore */ }
    }
    playVideoClip(bg, refreshGen);
  }

  // The two buffers: the front element is on screen, the back one idles as the
  // preload target for the clip after this one.
  function frontVideo() {
    return videoEls[videoFront] || null;
  }

  function backVideo() {
    return videoEls.length > 1 ? videoEls[videoFront ? 0 : 1] : null;
  }

  function nextVideoIndex() {
    return videoClips.length ? (videoIndex + 1) % videoClips.length : 0;
  }

  function revealFront(el) {
    if (!el) return;
    el.classList.remove('is-back');
    el.classList.add('is-front');
  }

  function retire(el) {
    if (!el) return;
    el.classList.remove('is-front');
    el.classList.add('is-back');
  }

  // Slideshow only: a clip reached its natural end, so roll onto the next one
  // (clips are never cut off by a timer). Looping Single clips never end.
  function onVideoEnded(event) {
    if (!videoSlideshow || videoClips.length <= 1) return;
    if (event && event.target !== frontVideo()) return;
    videoIndex = (videoIndex + 1) % videoClips.length;
    swapToPreloaded(refreshGen);
  }

  // Near the end of the clip on screen, load the next one into the idle element
  // so the swap has its first frame ready (and only then — preloading the whole
  // next 2K clip up front doubled the bandwidth the current one is streaming).
  function onVideoTimeUpdate(event) {
    if (!videoSlideshow || videoClips.length <= 1 || videoSwapTimer) return;
    if (event && event.target !== frontVideo()) return;
    if (!wallpaperShouldAnimate()) return;
    const v = frontVideo();
    if (!v || videoPreloaded === nextVideoIndex()) return;
    const dur = v.duration;
    if (!isFinite(dur) || dur <= 0) return;
    if (dur - v.currentTime > PRELOAD_LEAD_SEC) return;
    preloadNext();
  }

  function makeVideo() {
    const v = document.createElement('video');
    v.className = 'background-video';
    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.setAttribute('aria-hidden', 'true');
    v.autoplay = true;
    v.preload = 'auto';
    v.loop = true;
    v.addEventListener('playing', onVideoPlaying);
    v.addEventListener('ended', onVideoEnded);
    v.addEventListener('timeupdate', onVideoTimeUpdate);
    layer.appendChild(v);
    return v;
  }

  function ensureVideo() {
    if (videoEls.length) return;
    videoEls = [makeVideo(), makeVideo()];
    videoFront = 0;
  }

  // Buffer the following clip in the idle element, ready to fade in on "ended".
  function preloadNext() {
    const back = backVideo();
    if (!back || !videoSlideshow || videoClips.length <= 1) return;
    if (videoSwapTimer) return; // the outgoing element is still on screen
    const index = nextVideoIndex();
    const clip = videoClips[index];
    if (!clip) return;
    back.loop = false;
    if (back.getAttribute('src') !== clip.url) {
      back.setAttribute('src', clip.url);
    }
    videoPreloaded = index;
  }

  // Fade the preloaded clip in over the one that just ended. The outgoing
  // element keeps painting its last frame under the incoming one (see CSS), so
  // there is no black gap; only once the fade is done does it get reused as the
  // next preload target.
  function swapToPreloaded(gen) {
    const front = frontVideo();
    const back = backVideo();
    const clip = videoClips[videoIndex];
    if (!back || !clip || back.getAttribute('src') !== clip.url) {
      // Nothing was preloaded in time (a failed or unbounded stream): hard cut.
      playVideoClip(normalizeBackgroundConfig(getConfig().background), gen);
      return;
    }
    revealFront(back);
    retire(front);
    videoFront = videoFront ? 0 : 1;

    const attempt = ++videoAttempt;
    if (videoErrorListener) back.removeEventListener('error', videoErrorListener);
    videoErrorListener = function () {
      handleVideoFailure(attempt);
    };
    back.addEventListener('error', videoErrorListener);
    back.loop = !videoSlideshow;
    let p = null;
    try {
      p = back.play();
    } catch (err) {
      handleVideoFailure(attempt);
      return;
    }
    if (p && p.catch) p.catch(function (err) {
      if (err && err.name === 'AbortError') return;
      if (gen !== refreshGen) return;
      handleVideoFailure(attempt);
    });
    onVideoPlaying();

    const outgoing = front;
    if (videoSwapTimer) clearTimeout(videoSwapTimer);
    videoSwapTimer = setTimeout(function () {
      videoSwapTimer = null;
      if (outgoing) {
        try { outgoing.pause(); } catch (err) { /* ignore */ }
      }
      preloadNext();
    }, 1500);
  }

  // Release the decoders and the network requests (source change or teardown).
  function teardownVideo() {
    videoSlideshow = false;
    videoClips = [];
    videoIndex = 0;
    videoPreloaded = -1;
    if (videoSwapTimer) {
      clearTimeout(videoSwapTimer);
      videoSwapTimer = null;
    }
    const els = videoEls;
    videoEls = [];
    videoFront = 0;
    videoPlaying = false;
    for (let i = 0; i < els.length; i += 1) {
      const v = els[i];
      if (videoErrorListener) {
        try { v.removeEventListener('error', videoErrorListener); } catch (err) { /* ignore */ }
      }
      v.removeEventListener('playing', onVideoPlaying);
      v.removeEventListener('ended', onVideoEnded);
      v.removeEventListener('timeupdate', onVideoTimeUpdate);
      try { v.pause(); } catch (err) { /* ignore */ }
      v.removeAttribute('src');
      try { v.load(); } catch (err) { /* ignore */ }
      if (v.parentNode) v.parentNode.removeChild(v);
    }
    videoErrorListener = null;
    layer.classList.remove('has-video');
    syncMovingBackground();
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

  // Pause the decoder rather than tearing it down, and resume the same stream
  // (play(), never a src change), so returning from an app neither restarts the
  // clip nor re-fetches it. Also starts a first attempt that was skipped while
  // the surface was hidden.
  function syncVideoPlayback() {
    if (!wallpaperShouldAnimate()) {
      for (let i = 0; i < videoEls.length; i += 1) {
        if (!videoEls[i].paused) {
          try { videoEls[i].pause(); } catch (err) { /* ignore */ }
        }
      }
      return;
    }
    const front = frontVideo();
    if (!front) {
      if (videoClips.length) {
        playVideoClip(normalizeBackgroundConfig(getConfig().background), refreshGen);
      }
      return;
    }
    if (!front.paused) return;
    if (front.error) {
      // The clip broke while we were away: start a fresh attempt (retry/skip)
      // rather than play() the dead element, which would reject silently.
      playVideoClip(normalizeBackgroundConfig(getConfig().background), refreshGen);
      return;
    }
    try {
      const p = front.play();
      if (p && p.catch) p.catch(function () {
        // A source that died while we were away can reject here; if the element
        // now reports an error, make a fresh attempt instead of stalling.
        if (front.error) {
          playVideoClip(normalizeBackgroundConfig(getConfig().background), refreshGen);
        }
      });
    } catch (err) { /* ignore */ }
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

  // Play videoClips[videoIndex]: looping in Single mode, once in Slideshow (the
  // next clip then rides in on "ended"). True once playing. False when it fell
  // back to the gradient (a return retries) or when the surface is hidden (the
  // resume path starts it instead of decoding for nobody).
  async function playVideoClip(bg, gen) {
    if (!wallpaperShouldAnimate()) return false;
    if (!videoEls.length) ensureVideo();
    const front = frontVideo();
    if (!front || !videoClips.length) return false;
    const attempt = ++videoAttempt;
    const clip = videoClips[videoIndex % videoClips.length];
    front.loop = !videoSlideshow;
    // Bind the "error" event to this load, and detach the previous load's so a
    // late error from a clip we already moved on from is not counted again.
    if (videoErrorListener) front.removeEventListener('error', videoErrorListener);
    videoErrorListener = function () {
      handleVideoFailure(attempt);
    };
    front.addEventListener('error', videoErrorListener);

    // Gradient poster behind the clip until its first frame paints.
    layer.style.backgroundImage = PRESETS[bg.preset] || PRESETS['warm-gradient'];
    layer.style.backgroundColor = '#0a0a0f';
    layer.classList.add('has-video');
    layer.classList.remove('has-image');
    layer.classList.remove('ken-burns');
    layer.classList.remove('gradient-animated');

    if (front.getAttribute('src') !== clip.url) {
      front.setAttribute('src', clip.url);
    }
    // Reveal now rather than waiting on a "playing" event: the element's own
    // background (dark, like the layer) covers the first-frame gap.
    revealFront(front);
    videoPreloaded = -1;
    try {
      await front.play();
    } catch (err) {
      if (gen !== refreshGen) return false;
      // play() aborted by a pause (the surface hid mid-start) is not a decode
      // failure: keep the element for the resume path, not the gradient.
      if (err && err.name === 'AbortError') return false;
      if (!wallpaperShouldAnimate()) return false;
      handleVideoFailure(attempt);
      return false;
    }
    if (gen !== refreshGen) return false;
    onVideoPlaying();
    return true;
  }

  // Single = loop the chosen clip; Slideshow = cycle the catalog, one clip per
  // "ended". False when it fell back to the gradient (so a return retries).
  async function paintAerial(bg, gen) {
    clearSlideshow();
    const media = await resolveBackgroundMedia(getConfig(), '');
    if (gen !== refreshGen) return false;

    const clips = media.filter(function (item) {
      return item && item.kind === MEDIA_VIDEO && item.url;
    });
    if (!clips.length) {
      fallbackToGradient(bg);
      return false;
    }

    // Offline: don't fire the whole catalog at Apple's CDN; hold the gradient
    // and let a later return try again when connectivity is back.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      fallbackToGradient(bg);
      return false;
    }

    videoSlideshow = bg.mode === 'slideshow' && clips.length > 1;
    videoClips = videoSlideshow && bg.shuffle ? shuffled(clips) : clips;
    videoIndex = 0;
    videoFailures = 0;
    videoHandledAttempt = 0;
    videoPreloaded = -1;
    const ok = await playVideoClip(bg, gen);
    return ok && !videoFellBack;
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

  function startSlideshow(media, intervalSec) {
    slideshowMedia = media;
    slideshowIndex = 0;
    showSlideshowImage();
    slideshowTimer = setInterval(slideshowTick, intervalSec * 1000);
  }

  /**
   * Try each candidate URL until one decodes. webOS 4 may reject one form of
   * path but accept another (relative vs absolute file://).
   */
  async function pickLoadableMedia(candidates) {
    for (let i = 0; i < candidates.length; i += 1) {
      const item = candidates[i];
      if (!item || !item.url) continue;
      // Apply optimistically so the user sees something while we verify.
      applyImage(item.url);
      const ok = await preloadImage(item.url);
      if (ok) return item;
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
  function reportOnlineFailure(bg, images) {
    if (bg.source !== 'url') return;
    const key = images.join(' ');
    if (key === reportedFailure) return;
    reportedFailure = key;
    if (elements.onToast) {
      elements.onToast('The wallpaper link didn\u2019t load as an image. Use a direct image link ' +
        '(it usually ends in .jpg or .png), and check the TV is online.');
    }
  }

  /**
   * @param {{reuse?: boolean}} [opts] reuse: returning from an app. When the
   *   wallpaper settings are unchanged it is already on screen (a slideshow
   *   keeps going); loading it again decoded the 4K photo and asked the TV for
   *   USB folders on every return, which slow TVs felt as lag.
   */
  async function refresh(opts) {
    const config = getConfig();
    const signature = JSON.stringify([
      config.background || {}, config.profile || '', !!(config.launcher && config.launcher.perfMode)
    ]);
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
    if (ok && gen === refreshGen && !videoFellBack) appliedSignature = signature;
  }

  // Put the configured wallpaper up. False when it fell back to a gradient
  // because the pictures didn't load (a return then tries them again).
  async function paint(config, gen) {
    clearSlideshow();
    videoFellBack = false;
    applyScrim();

    const bg = normalizeBackgroundConfig(config.background);

    if (bg.source === 'preset' || bg.source === 'animated-gradient') {
      teardownVideo();
      applyPreset(bg.preset || 'warm-gradient', bg.source === 'animated-gradient');
      return true;
    }

    if (bg.source === 'aerial') {
      return paintAerial(bg, gen);
    }

    // Left the aerial source: release the decoder before painting photos.
    teardownVideo();

    if (!usbBackgroundPath) {
      const paths = await resolveLoungePaths(config);
      if (gen !== refreshGen) return false;
      usbBackgroundPath = paths.backgroundPath || '';
    }

    const media = await resolveBackgroundMedia(config, usbBackgroundPath);
    if (gen !== refreshGen) return false;

    if (!media.length) {
      applyPreset(bg.preset || 'warm-gradient', false);
      return false;
    }

    if (bg.mode === 'slideshow' && media.length > 1) {
      // Verify at least the first image loads; still run the full list.
      const first = await pickLoadableMedia(media);
      if (gen !== refreshGen) return false;
      if (!first) {
        applyPreset(bg.preset || 'warm-gradient', false);
        reportOnlineFailure(bg, images);
        return false;
      }
      startSlideshow(media, bg.slideshowIntervalSec || 300);
      return true;
    }

    const loaded = await pickLoadableMedia(media);
    if (gen !== refreshGen) return false;
    if (!loaded) {
      applyPreset(bg.preset || 'warm-gradient', false);
      reportOnlineFailure(bg, images);
      return false;
    }
    reportedFailure = '';
    return true;
  }

  return {
    refresh: refresh,
    destroy: function () {
      clearSlideshow();
      teardownVideo();
      document.removeEventListener('visibilitychange', syncVideoPlayback);
      window.removeEventListener('focus', syncVideoPlayback);
      window.removeEventListener('blur', syncVideoPlayback);
      bodyClassObserver.disconnect();
    }
  };
}
