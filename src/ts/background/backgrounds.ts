import {fetchJson, joinPath} from '@lib/usb.js';
import {resolveAppUrl, withAssetVersion} from '@lib/compat.js';
import {APP_VERSION} from '@lib/version.js';
import {AERIAL_BACKGROUNDS} from './aerials.js';
import type {BackgroundConfig, BuiltinBackground, RemoteBackground} from '@lib/types.js';

const BUILTIN_MANIFEST = 'assets/backgrounds/manifest.json';
const BUILTIN_BASE = 'assets/backgrounds/';

/**
 * Hard-coded list matching assets/backgrounds/manifest.json.
 * Used when the manifest fetch fails (no USB / packaged asset unavailable).
 */
const BUILTIN_BACKGROUNDS_FALLBACK: BuiltinBackground[] = [
  {id: 'azure-cove', title: 'Azure Cove', file: 'azure-cove.jpg'},
  {id: 'palm-shore', title: 'Palm Shore', file: 'palm-shore.jpg'},
  {id: 'mountain-sunset', title: 'Mountain Sunset', file: 'mountain-sunset.jpg'},
  {id: 'sunny-peaks', title: 'Sunny Peaks', file: 'sunny-peaks.jpg'},
  {id: 'starry-night', title: 'Starry Night', file: 'starry-night.jpg'}
];

/**
 * Online-only curated photos (URLs only — never packaged in the .ipk).
 * Nature set (Unsplash) + anime girls (Wallhaven SFW face/smile shots). TV must be online.
 * See docs/background-sources.md.
 */
// 3840px + high quality for sharp 4K TVs (still CDN-only, not packaged).
export const UNSPLASH_PARAMS_4K = '?w=3840&q=92&auto=format&fit=crop';
export const UNSPLASH_PARAMS_LITE = '?w=1920&q=85&auto=format&fit=crop';

function u(photoId: string): string {
  return 'https://images.unsplash.com/photo-' + photoId + UNSPLASH_PARAMS_4K;
}

/**
 * Unsplash with auto=format sends AVIF to a browser that says it takes AVIF,
 * and some TVs (a webOS 9 set) say so but never show it: those wallpapers and
 * their thumbnails stayed blank while JPEGs from other hosts loaded. Ask
 * Unsplash for a JPEG, which every TV shows. Other URLs are left alone.
 */
export function jpegForTv(url: string): string {
  const s = String(url || '');
  if (!/^https?:\/\/(images|plus)\.unsplash\.com\//i.test(s) || /[?&]fm=/i.test(s)) return s;
  const q = s.indexOf('?');
  if (q < 0) return s + '?fm=jpg';
  const params = s.slice(q + 1).split('&').map(function (param) {
    const m = /^auto=(.*)$/i.exec(param);
    if (!m) return param;
    const rest = decodeURIComponent(m[1]).split(',').filter(function (v) {
      return v && v.toLowerCase() !== 'format';
    });
    return rest.length ? 'auto=' + rest.join(',') : '';
  }).filter(Boolean);
  params.push('fm=jpg');
  return s.slice(0, q) + '?' + params.join('&');
}

/** An image posted on X, full size from its image CDN (pbs.twimg.com). */
function twimg(mediaId: string): string {
  return 'https://pbs.twimg.com/media/' + mediaId + '?format=jpg&name=orig';
}

/** Wallhaven full-size direct image URL (SFW anime; free wallpaper host; not packaged). */
function wh(id: string, ext?: string): string {
  const prefix = String(id).slice(0, 2);
  return 'https://w.wallhaven.cc/full/' + prefix + '/wallhaven-' + id + '.' + (ext || 'jpg');
}

export const REMOTE_BACKGROUNDS: RemoteBackground[] = [
  // —— Luxury tropical beaches (Unsplash; palms, sun, shoreline; remote-only) ——
  {id: 'remote-37-luxury-golden-shore', title: 'Luxury · Golden shore', url: u('1507525428034-b723cf961d3e')},
  {id: 'remote-38-luxury-palm-loungers', title: 'Luxury · Palm loungers', url: u('1602002418816-5c0aeef426aa')},
  {id: 'remote-39-luxury-maldives', title: 'Luxury · Maldives lagoon', url: u('1573843981267-be1999ff37cd')},
  {id: 'remote-40-luxury-palm-cove', title: 'Luxury · Palm cove', url: u('1519046904884-53103b34b206')},
  // —— SpaceX rockets ——
  // Starship lifting off over the coast at Starbase, Texas: an image posted on
  // X (4096x2304), served from X's image CDN.
  {id: 'remote-41-rockets-starship', title: 'Rockets · Starship launch', url: twimg('HTU8ja-XgAE6GwQ')},
  // Falcon Heavy launch reflected in the water (SpaceX on Unsplash).
  {id: 'remote-42-rockets-falcon-heavy', title: 'Rockets · Falcon Heavy', url: u('1517976487492-5750f3195933')},
  // —— Unsplash nature (remote-01 … remote-24) ——
  // Was a portrait aerial beach (cropped poorly on TV); now a premium landscape.
  {id: 'remote-01-cliff-ocean', title: 'Alpine mirror', url: u('1493246507139-91e8fad9978e')},
  {id: 'remote-02-sunflowers', title: 'Sunflower field', url: u('1568858916099-f6eec036a480')},
  {id: 'remote-03-mountain-light', title: 'Mountain light', url: u('1469474968028-56623f02e42e')},
  {id: 'remote-04-turquoise-lagoon', title: 'Turquoise lagoon', url: u('1559827260-dc66d52bef19')},
  {id: 'remote-05-golden-valley', title: 'Golden valley', url: u('1506905925346-21bda4d32df4')},
  {id: 'remote-06-lavender-rows', title: 'Lavender rows', url: u('1499002238440-d264edd596ec')},
  {id: 'remote-07-desert-dunes', title: 'Desert dunes', url: u('1509316785289-025f5b846b35')},
  {id: 'remote-08-northern-lights', title: 'Northern lights', url: u('1531366936337-7c912a4589a7')},
  {id: 'remote-09-sakura-path', title: 'Sakura path', url: u('1522383225653-ed111181a951')},
  {id: 'remote-10-city-night', title: 'City night', url: u('1480714378408-67cf0d13bc1b')},
  {id: 'remote-11-hot-air', title: 'Hot air balloons', url: u('1507608616759-54f48f0af0ee')},
  {id: 'remote-12-safari', title: 'Safari plain', url: u('1516426122078-c23e76319801')},
  {id: 'remote-14-island-sunset', title: 'Island sunset', url: u('1476514525535-07fb3b4ae5f1')},
  {id: 'remote-15-flower-meadow', title: 'Flower meadow', url: u('1490750967868-88aa4486c946')},
  // Famous Arashiyama bamboo grove path (Kyoto); was rice terraces.
  {id: 'remote-16-rice-terraces', title: 'Kyoto bamboo', url: wh('4dvkzm')},
  {id: 'remote-17-aurora-lake', title: 'Aurora lake', url: u('1483347756197-71ef80e95f73')},
  {id: 'remote-18-travel-canyon', title: 'Travel canyon', url: u('1469854523086-cc02fe5d8800')},
  {id: 'remote-19-forest-path', title: 'Forest path', url: u('1418065460487-3e41a6c84dc5')},
  {id: 'remote-20-underwater-reef', title: 'Underwater reef', url: u('1544551763-46a013bb70d5')},
  {id: 'remote-21-misty-mountains', title: 'Misty mountains', url: u('1501785888041-af3ef285b470')},
  {id: 'remote-22-star-mountain', title: 'Star mountain', url: u('1519681393784-d120267933ba')},
  {id: 'remote-23-underwater-blue', title: 'Underwater blue', url: u('1583212292454-1fe6229603b7')},
  {id: 'remote-24-yosemite', title: 'Valley vista', url: u('1501594907352-04cda38ebc29')},
  // —— Anime girls: SFW face shots / smiles (Wallhaven CDN; remote-only, not packaged) ——
  {id: 'remote-25-anime-bright-smile', title: 'Anime · Bright smile', url: wh('j89655')},
  {id: 'remote-26-anime-close-up', title: 'Anime · Close-up smile', url: wh('exk1m8')},
  {id: 'remote-27-anime-peace-wink', title: 'Anime · Peace & wink', url: wh('yxpwmx', 'png')},
  {id: 'remote-28-anime-heart-balloons', title: 'Anime · Heart balloons', url: wh('gpdyrq')},
  {id: 'remote-29-anime-purple-fun', title: 'Anime · Purple fun', url: wh('737jv9')},
  {id: 'remote-30-anime-sun-glasses', title: 'Anime · Cool shades', url: wh('l88xol')},
  {id: 'remote-31-anime-soft-gaze', title: 'Anime · Soft gaze', url: wh('5womd7')},
  {id: 'remote-32-anime-pink-breeze', title: 'Anime · Pink breeze', url: wh('3z8er9')},
  {id: 'remote-33-anime-gentle-smile', title: 'Anime · Gentle smile', url: wh('wy1wd7')},
  {id: 'remote-34-anime-confetti', title: 'Anime · Confetti day', url: wh('jxqml5')},
  {id: 'remote-35-anime-sakura-look', title: 'Anime · Sakura look', url: wh('yjpw9l')},
  {id: 'remote-36-anime-laughing', title: 'Anime · Laughing', url: wh('vpmd6m')}
];

export function getRemoteBackgroundUrls(): string[] {
  return REMOTE_BACKGROUNDS.map(function (entry) {
    return entry.url;
  }).filter(isImageUrl);
}

export function findRemoteBackgroundById(id: string): RemoteBackground | null {
  if (!id) return null;
  for (let i = 0; i < REMOTE_BACKGROUNDS.length; i += 1) {
    if (REMOTE_BACKGROUNDS[i].id === id) return REMOTE_BACKGROUNDS[i];
  }
  return null;
}

export function findRemoteBackgroundByUrl(url: string): RemoteBackground | null {
  if (!url) return null;
  const needle = String(url).trim();
  for (let i = 0; i < REMOTE_BACKGROUNDS.length; i += 1) {
    if (REMOTE_BACKGROUNDS[i].url === needle) return REMOTE_BACKGROUNDS[i];
  }
  return null;
}

/**
 * Smaller preview URL for the settings photo picker (same CDN asset, lower w/q).
 * Falls back to the full URL when the host is unknown.
 */
export function remoteThumbUrl(url: string): string {
  if (!url) return '';
  let out = String(url);
  if (/images\.unsplash\.com/i.test(out)) {
    if (/([?&])w=\d+/i.test(out)) {
      out = out.replace(/([?&])w=\d+/i, '$1w=640');
    } else {
      out += (out.indexOf('?') >= 0 ? '&' : '?') + 'w=640';
    }
    if (/([?&])q=\d+/i.test(out)) {
      out = out.replace(/([?&])q=\d+/i, '$1q=70');
    }
    return jpegForTv(out);
  }
  if (/images\.pexels\.com/i.test(out)) {
    if (/([?&])w=\d+/i.test(out)) {
      return out.replace(/([?&])w=\d+/i, '$1w=640');
    }
    return out + (out.indexOf('?') >= 0 ? '&' : '?') + 'w=640';
  }
  // X: its 680px size.
  if (/^https:\/\/pbs\.twimg\.com\/media\//i.test(out)) {
    return out.replace(/([?&])name=[a-z0-9]+/i, '$1name=small');
  }
  // Wallhaven full → large thumb (faster settings picker).
  // https://w.wallhaven.cc/full/yj/wallhaven-yjk6ml.jpg → https://th.wallhaven.cc/lg/yj/yjk6ml.jpg
  const whMatch = out.match(/w\.wallhaven\.cc\/full\/([a-z0-9]{2})\/wallhaven-([a-z0-9]+)\./i);
  if (whMatch) {
    return 'https://th.wallhaven.cc/lg/' + whMatch[1] + '/' + whMatch[2] + '.jpg';
  }
  return out;
}

let builtinCache: BuiltinBackground[] | null = null;

export function normalizeBackgroundConfig(bg: Partial<BackgroundConfig> | null | undefined): BackgroundConfig {
  const out = Object.assign({}, bg || {}) as BackgroundConfig;

  if (!out.source) {
    if (!out.mode || out.mode === 'preset') {
      out.source = 'preset';
      out.mode = 'static';
    } else {
      out.source = 'usb';
    }
  }

  if (!out.mode) out.mode = 'static';
  if (!out.builtin) out.builtin = 'azure-cove';
  // Preserve empty string = "custom URL"; only default when unset.
  if (typeof out.remote !== 'string') {
    out.remote = REMOTE_BACKGROUNDS[0] ? REMOTE_BACKGROUNDS[0].id : '';
  }
  if (!out.url) out.url = '';
  if (!Array.isArray(out.urls)) out.urls = [];
  // Selected Apple aerial clip (source "aerial").
  if (!out.aerial) out.aerial = AERIAL_BACKGROUNDS[0] ? AERIAL_BACKGROUNDS[0].id : '';
  if (typeof out.shuffle !== 'boolean') out.shuffle = false;

  return out;
}

function normalizeManifestList(list: unknown): BuiltinBackground[] | null {
  if (!Array.isArray(list) || !list.length) return null;
  const cleaned = list.filter(function (entry) {
    return entry && entry.id && entry.file;
  });
  return cleaned.length ? cleaned as BuiltinBackground[] : null;
}

export async function loadBuiltinManifest(): Promise<BuiltinBackground[]> {
  if (builtinCache) return builtinCache;

  try {
    const manifestUrl = withAssetVersion(
      resolveAppUrl(BUILTIN_MANIFEST),
      APP_VERSION
    );
    const manifest = await fetchJson(manifestUrl);
    const loaded = normalizeManifestList(manifest && manifest.backgrounds);
    builtinCache = loaded || BUILTIN_BACKGROUNDS_FALLBACK.slice();
  } catch (err) {
    builtinCache = BUILTIN_BACKGROUNDS_FALLBACK.slice();
  }

  return builtinCache;
}

/**
 * The one URL for a packaged background image: absolute `file://` when it can
 * be resolved, versioned so WAM does not keep a stale copy after an update.
 */
export function builtinImageUrl(file: string): string {
  if (!file) return '';
  const rel = joinPath(BUILTIN_BASE, file);
  const absolute = resolveAppUrl(rel);
  return withAssetVersion(absolute || rel, APP_VERSION);
}

export function getBuiltinImageUrl(id: string, manifest?: BuiltinBackground[] | null): string {
  const list = manifest || builtinCache || BUILTIN_BACKGROUNDS_FALLBACK;
  const entry = list.find(function (item) {
    return item.id === id;
  }) || list[0];

  if (!entry) return '';
  return builtinImageUrl(entry.file);
}

export function parseUrlList(text: string): string[] {
  if (!text) return [];

  return text
    .split(/\r?\n/)
    .map(function (line) {
      return line.trim();
    })
    .filter(function (line) {
      return line && /^https?:\/\//i.test(line);
    });
}

export function isImageUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

