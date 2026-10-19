// The background-source seam: one adapter per source behind a single
// `BackgroundSource` interface. `resolveBackgroundMedia` deepens the old entry
// point into a registry lookup, so adding or changing a source means writing one
// adapter instead of editing a switch in four places. Each adapter resolves the
// config (already normalised) into `MediaDescriptor`s that carry their full
// metadata, including an aerial clip's id and title.

import type {TranslationKey} from '@lib/i18n.js';
import {AERIAL_BACKGROUNDS} from './aerials.js';
import {
  builtinImageUrl,
  findRemoteBackgroundById,
  getRemoteBackgroundUrls,
  isImageUrl,
  jpegForTv,
  loadBuiltinManifest,
  normalizeBackgroundConfig,
  UNSPLASH_PARAMS_4K,
  UNSPLASH_PARAMS_LITE
} from './backgrounds.js';
import {MEDIA_GRADIENT, MEDIA_IMAGE, MEDIA_VIDEO, presetGradient, probeImage} from './media.js';
import type {MediaDescriptor, MediaKind} from './media.js';
import {discoverBackgroundImages, joinPath} from '@lib/usb.js';
import type {AerialBackground, BackgroundConfig, Config} from '@lib/types.js';

/** One background source: resolve the config into the media to play. */
export interface BackgroundSource {
  /** What to play now, given the normalised config and the USB path. */
  resolve(bg: BackgroundConfig, usbPath: string): Promise<MediaDescriptor[]>;
  /**
   * The whole set for this source, regardless of Display mode. Hosts that always
   * want motion (the in-app screensaver) ask for this instead of forcing
   * mode = 'slideshow' to coax the list out of `resolve`.
   */
  catalog(bg: BackgroundConfig, usbPath: string): Promise<MediaDescriptor[]>;
}

function descriptors(urls: string[], kind: MediaKind): MediaDescriptor[] {
  return urls.map(function (url) {
    return {kind: kind, url: url};
  });
}

/** The Apple aerial clip with this id, or null. */
function findAerialBackgroundById(id: string): AerialBackground | null {
  if (!id) return null;
  for (let i = 0; i < AERIAL_BACKGROUNDS.length; i += 1) {
    if (AERIAL_BACKGROUNDS[i].id === id) return AERIAL_BACKGROUNDS[i];
  }
  return null;
}

/** A clip descriptor that keeps its catalog id and title (see stepAerial). */
function videoDescriptor(clip: AerialBackground): MediaDescriptor {
  return {kind: MEDIA_VIDEO, url: clip.url, id: clip.id, title: clip.title};
}

function aerialCatalog(): MediaDescriptor[] {
  return AERIAL_BACKGROUNDS.map(videoDescriptor);
}

/* -------------------------------------------------------------------------- */
/* Performance mode (1920px copies) — builtin/url photo resolution             */
/* -------------------------------------------------------------------------- */

// Performance mode: 1920px wallpapers (~¼ of the pixels to decode and hold in
// memory on slower TVs); otherwise the 4K originals. Applied when an image is
// picked for display, so saved choices never change.
//
// The IPK only packages the 4K built-ins. Their 1920px copies are downloaded
// from this repo (assets/backgrounds/1920/, excluded from the package) via
// jsDelivr, pinned to the tag that added them so the URLs never change; the
// CDN marks them immutable, so the TV caches each one after the first view.
// Offline or unreachable → the packaged 4K is used instead.
const LITE_WALLPAPER_BASE =
  'https://cdn.jsdelivr.net/gh/anned20/ember@v0.0.104/assets/backgrounds/1920/';
const LITE_RETRY_MS = 10 * 60 * 1000;

let liteImages = false;
let liteProbe: {ok: boolean; at: number} | null = null; // can the CDN copies load?

export function setLiteImages(on: unknown): void {
  liteImages = !!on;
}

/** Downloadable 1920px copy of a packaged built-in, from any of its URL forms. */
function liteBuiltinUrl(url: string): string {
  const m = /(?:^|\/)assets\/backgrounds\/([^/?#]+\.jpg)(?:[?#]|$)/.exec(String(url || ''));
  return m ? LITE_WALLPAPER_BASE + m[1] : '';
}

/** One reachability check per session (re-tried every 10 min after a miss). */
function liteCopiesReachable(sampleUrl: string): Promise<boolean> {
  const now = Date.now();
  if (liteProbe && (liteProbe.ok || now - liteProbe.at < LITE_RETRY_MS)) {
    return Promise.resolve(liteProbe.ok);
  }
  return probeImage(sampleUrl).then(function (res) {
    liteProbe = {ok: res.ok, at: Date.now()};
    return res.ok;
  });
}

/**
 * Performance mode for built-ins. A single photo gets the 1920px download
 * first and its packaged 4K copy as a fallback (the background controller
 * tries them in order). A photo list (slideshow, screensaver) has no per-image
 * fallback, so it switches to the downloads only once they're known to load.
 */
function liteBuiltinImages(images: string[], mode: string): Promise<string[]> {
  const lite = images.map(liteBuiltinUrl);
  if (!lite[0]) return Promise.resolve(images);
  if (mode !== 'slideshow') return Promise.resolve([lite[0]].concat(images));
  return liteCopiesReachable(lite[0]).then(function (ok) {
    return ok ? images.map(function (url, i) { return lite[i] || url; }) : images;
  });
}

/**
 * Unsplash with auto=format sends AVIF to a browser that says it takes AVIF,
 * and some TVs (a webOS 9 set) say so but never show it. Downscale / re-encode
 * the URLs a display will actually be shown, never the saved choice.
 */
function sizeForDisplay(url: string): string {
  const s = String(url || '');
  if (liteImages && /^https:\/\/pbs\.twimg\.com\/media\//.test(s)) {
    return s.replace(/([?&])name=[a-z0-9]+/i, '$1name=large');
  }
  return liteImages && /^https:\/\/images\.unsplash\.com\/photo-/.test(s) &&
    s.indexOf(UNSPLASH_PARAMS_4K) > 0
    ? s.replace(UNSPLASH_PARAMS_4K, UNSPLASH_PARAMS_LITE)
    : s;
}

/** Apply Performance mode and the TV-safe JPEG form to a resolved photo list. */
async function photoDescriptors(
  urls: string[],
  mode: string,
  source: string
): Promise<MediaDescriptor[]> {
  if (!liteImages) return descriptors(urls.map(jpegForTv), MEDIA_IMAGE);
  if (source === 'builtin') return descriptors(await liteBuiltinImages(urls, mode), MEDIA_IMAGE);
  return descriptors(urls.map(sizeForDisplay).map(jpegForTv), MEDIA_IMAGE);
}

/* -------------------------------------------------------------------------- */
/* The adapters                                                                */
/* -------------------------------------------------------------------------- */

function presetDescriptor(bg: BackgroundConfig): Promise<MediaDescriptor[]> {
  return Promise.resolve([{kind: MEDIA_GRADIENT, url: presetGradient(bg.preset)}]);
}

// A gradient has no separate "whole set": resolve and catalog are the same.
const presetSource: BackgroundSource = {resolve: presetDescriptor, catalog: presetDescriptor};

async function builtinUrls(bg: BackgroundConfig, full: boolean): Promise<string[]> {
  const manifest = await loadBuiltinManifest();
  if (full || bg.mode === 'slideshow') {
    // One URL per photo (absolute file:// when possible).
    return manifest
      .map(function (entry) { return builtinImageUrl(entry.file); })
      .filter(Boolean);
  }
  // The selected photo, in its single URL form.
  const entry = manifest.find(function (item) {
    return item.id === bg.builtin;
  }) || manifest[0];
  return entry ? [builtinImageUrl(entry.file)].filter(Boolean) : [];
}

const builtinSource: BackgroundSource = {
  resolve: async function (bg) {
    return photoDescriptors(await builtinUrls(bg, false), bg.mode, 'builtin');
  },
  catalog: async function (bg) {
    return photoDescriptors(await builtinUrls(bg, true), 'slideshow', 'builtin');
  }
};

function urlImageUrls(bg: BackgroundConfig, full: boolean): string[] {
  if (full || bg.mode === 'slideshow') {
    // Explicit list first; otherwise cycle the curated remote catalog.
    return bg.urls.length ? bg.urls.filter(isImageUrl) : getRemoteBackgroundUrls();
  }
  if (bg.url && isImageUrl(bg.url)) return [bg.url];
  const remote = findRemoteBackgroundById(bg.remote);
  return remote && isImageUrl(remote.url) ? [remote.url] : [];
}

const urlSource: BackgroundSource = {
  resolve: async function (bg) {
    return photoDescriptors(urlImageUrls(bg, false), bg.mode, 'url');
  },
  catalog: async function (bg) {
    return photoDescriptors(urlImageUrls(bg, true), 'slideshow', 'url');
  }
};

async function usbUrls(bg: BackgroundConfig, usbPath: string): Promise<string[]> {
  if (bg.file) {
    const fileUrl = bg.file.indexOf('/') === 0
      ? bg.file
      : joinPath(bg.path || usbPath || '', bg.file);
    return [fileUrl];
  }
  const folder = bg.path || usbPath || '';
  return folder ? discoverBackgroundImages(folder) : [];
}

function usbDescriptors(bg: BackgroundConfig, usbPath: string): Promise<MediaDescriptor[]> {
  return usbUrls(bg, usbPath).then(function (urls) {
    return photoDescriptors(urls, bg.mode, 'usb');
  });
}

// USB has no mode distinction: resolve and catalog return the same set.
const usbSource: BackgroundSource = {resolve: usbDescriptors, catalog: usbDescriptors};

const aerialSource: BackgroundSource = {
  resolve: function (bg) {
    if (bg.mode === 'slideshow') return Promise.resolve(aerialCatalog());
    const clip = findAerialBackgroundById(bg.aerial) || AERIAL_BACKGROUNDS[0];
    if (!clip || !clip.url) return Promise.resolve([]);
    return Promise.resolve([videoDescriptor(clip)]);
  },
  catalog: function () {
    return Promise.resolve(aerialCatalog());
  }
};

function emptyResolve(): Promise<MediaDescriptor[]> {
  return Promise.resolve([]);
}

const emptySource: BackgroundSource = {resolve: emptyResolve, catalog: emptyResolve};

const SOURCES: Record<string, BackgroundSource> = {
  'preset': presetSource,
  'animated-gradient': presetSource,
  'builtin': builtinSource,
  'url': urlSource,
  'usb': usbSource,
  'aerial': aerialSource
};

/** The adapter for a source name, or one that resolves nothing (a stray value). */
export function sourceFor(name: string): BackgroundSource {
  return SOURCES[name] || emptySource;
}

/** The ordered source list the settings pane reads, so the set lives in one place. */
export const SOURCE_OPTIONS: Array<{value: string; labelKey: TranslationKey}> = [
  {value: 'preset', labelKey: 'background.source.preset'},
  {value: 'animated-gradient', labelKey: 'background.source.animatedGradient'},
  {value: 'builtin', labelKey: 'background.source.builtin'},
  {value: 'usb', labelKey: 'background.source.usb'},
  {value: 'url', labelKey: 'background.source.url'},
  {value: 'aerial', labelKey: 'background.source.aerial'}
];

/** The single resolver: the config's source, normalised, decides the adapter. */
export async function resolveBackgroundMedia(
  config: Config,
  usbPath: string
): Promise<MediaDescriptor[]> {
  const bg = normalizeBackgroundConfig(config.background);
  return sourceFor(bg.source).resolve(bg, usbPath);
}

/** The whole set a source offers, for hosts that always want motion. */
export async function resolveBackgroundCatalog(
  config: Config,
  usbPath: string
): Promise<MediaDescriptor[]> {
  const bg = normalizeBackgroundConfig(config.background);
  return sourceFor(bg.source).catalog(bg, usbPath);
}
