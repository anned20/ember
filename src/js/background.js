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
  // Aerial clip: one <video> filling the layer while the source is "aerial".
  let videoEl = null;
  let videoPlaying = false;
  // Aerial Slideshow: the ordered clips and where we are in them.
  let videoClips = [];
  let videoSlideshow = false;
  let videoIndex = 0;

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
    layer.classList.add('has-video');
    layer.classList.remove('has-image');
    layer.classList.remove('ken-burns');
    syncMovingBackground();
  }

  // The clip would not play (offline, unsupported container): the configured
  // gradient, exactly as images fall back, so the home screen is never blank.
  function onVideoError() {
    const bg = normalizeBackgroundConfig(getConfig().background);
    teardownVideo();
    applyPreset(bg.preset || 'warm-gradient', false);
  }

  // Slideshow only: a clip reached its natural end, so roll onto the next one
  // (clips are never cut off by a timer). Looping Single clips never end.
  function onVideoEnded() {
    if (!videoSlideshow || !videoClips.length) return;
    videoIndex = (videoIndex + 1) % videoClips.length;
    playVideoClip(normalizeBackgroundConfig(getConfig().background), refreshGen);
  }

  function ensureVideo() {
    if (videoEl) return videoEl;
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
    v.addEventListener('error', onVideoError);
    v.addEventListener('playing', onVideoPlaying);
    v.addEventListener('ended', onVideoEnded);
    layer.appendChild(v);
    videoEl = v;
    return v;
  }

  // Release the decoder and the network request (source change or teardown).
  function teardownVideo() {
    videoSlideshow = false;
    videoClips = [];
    videoIndex = 0;
    if (!videoEl) return;
    const v = videoEl;
    videoEl = null;
    videoPlaying = false;
    v.removeEventListener('error', onVideoError);
    v.removeEventListener('playing', onVideoPlaying);
    v.removeEventListener('ended', onVideoEnded);
    try { v.pause(); } catch (err) { /* ignore */ }
    v.removeAttribute('src');
    try { v.load(); } catch (err) { /* ignore */ }
    if (v.parentNode) v.parentNode.removeChild(v);
    layer.classList.remove('has-video');
    syncMovingBackground();
  }

  // Play videoClips[videoIndex]: looping in Single mode, once in Slideshow (the
  // next clip then rides in on "ended"). True once playing; false when it fell
  // back to the gradient, so a return retries.
  async function playVideoClip(bg, gen) {
    const clip = videoClips[videoIndex % videoClips.length];
    const video = ensureVideo();
    video.loop = !videoSlideshow;

    // Gradient poster behind the clip until its first frame paints.
    layer.style.backgroundImage = PRESETS[bg.preset] || PRESETS['warm-gradient'];
    layer.style.backgroundColor = '#0a0a0f';
    layer.classList.add('has-video');
    layer.classList.remove('has-image');
    layer.classList.remove('ken-burns');
    layer.classList.remove('gradient-animated');

    if (video.getAttribute('src') !== clip.url) {
      video.setAttribute('src', clip.url);
    }
    try {
      await video.play();
    } catch (err) {
      if (gen !== refreshGen) return false;
      onVideoError();
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
      teardownVideo();
      applyPreset(bg.preset || 'warm-gradient', false);
      return false;
    }

    videoSlideshow = bg.mode === 'slideshow' && clips.length > 1;
    videoClips = videoSlideshow && bg.shuffle ? shuffled(clips) : clips;
    videoIndex = 0;
    return playVideoClip(bg, gen);
  }

  function showSlideshowImage() {
    if (!slideshowMedia.length) return;
    applyImage(slideshowMedia[slideshowIndex % slideshowMedia.length].url);
    slideshowIndex += 1;
  }

  // Not while another app or TV Settings (an overlay) is in front: the next
  // 4K photo would be decoded and drawn underneath for nobody to see.
  function slideshowTick() {
    if (document.hidden || document.body.classList.contains('app-inactive')) return;
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

  // What the wallpaper on screen was made from (see refresh reuse).
  let appliedSignature = '';
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
      return;
    }
    appliedSignature = '';
    const gen = ++refreshGen;
    if (await paint(config, gen) && gen === refreshGen) appliedSignature = signature;
  }

  // Put the configured wallpaper up. False when it fell back to a gradient
  // because the pictures didn't load (a return then tries them again).
  async function paint(config, gen) {
    clearSlideshow();
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
    }
  };
}
