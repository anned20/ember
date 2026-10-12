// Shared media primitives for the background domain: the descriptor shape a
// source resolves into, the gradient preset table, the shuffle and the single
// image-decode probe. The source adapters, the media-playback engine, the two
// hosts (the wallpaper and the in-app screensaver) and the settings pane all
// read these, so a preset or a "loads?" timeout is defined once.

export type MediaKind = 'image' | 'video' | 'gradient';

export const MEDIA_IMAGE: MediaKind = 'image';
export const MEDIA_VIDEO: MediaKind = 'video';
export const MEDIA_GRADIENT: MediaKind = 'gradient';

/** A resolved wallpaper entry: an image URL, an aerial video URL or a gradient. */
export interface MediaDescriptor {
  kind: MediaKind;
  url: string;
  /** Aerial clips carry their catalog id so a host need not look the URL up. */
  id?: string;
  title?: string;
}

export const DEFAULT_PRESET = 'warm-gradient';

/** The one gradient table: the wallpaper, the screensaver and the pane share it. */
export const PRESETS: Record<string, string> = {
  'warm-gradient': 'linear-gradient(135deg, #1a1028 0%, #3d1f2e 40%, #7a3b2e 100%)',
  'cool-gradient': 'linear-gradient(145deg, #0b1220 0%, #162447 50%, #1f4068 100%)',
  'midnight': 'linear-gradient(180deg, #050508 0%, #12121a 60%, #1c1c28 100%)',
  'ember': 'radial-gradient(ellipse at 30% 20%, #4a1942 0%, #1a0a14 50%, #080408 100%)'
};

/** The gradient labels the settings pane reads from the same table. */
export const PRESET_OPTIONS: Array<{value: string; label: string}> = [
  {value: 'warm-gradient', label: 'Warm gradient'},
  {value: 'cool-gradient', label: 'Cool gradient'},
  {value: 'midnight', label: 'Midnight'},
  {value: 'ember', label: 'Ember'}
];

/** The CSS for a named preset, falling back to the default. */
export function presetGradient(name: string): string {
  return PRESETS[name] || PRESETS[DEFAULT_PRESET];
}

/** Fisher–Yates copy (aerial Slideshow order). */
export function shuffled<T>(items: T[]): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/** The one timeout policy for "does this image decode". */
export const IMAGE_PROBE_TIMEOUT_MS = 8000;

export interface ProbeResult {
  ok: boolean;
  width: number;
  height: number;
  /** The loaded element, so a caller can keep the decoded copy warm. */
  image: HTMLImageElement | null;
}

/**
 * Load and decode an image, bounded by one timeout, so the wallpaper, the
 * screensaver and the settings pane agree on what "loads" means.
 */
export function probeImage(url: string): Promise<ProbeResult> {
  return new Promise<ProbeResult>(function (resolve) {
    if (!url) {
      resolve({ok: false, width: 0, height: 0, image: null});
      return;
    }
    const img = new Image();
    let settled = false;
    function done(ok: boolean): void {
      if (settled) return;
      settled = true;
      resolve({ok: ok, width: img.naturalWidth || 0, height: img.naturalHeight || 0, image: img});
    }
    img.onload = function () {
      if (typeof img.decode === 'function') {
        img.decode().then(function () { done(true); }, function () { done(true); });
      } else {
        done(true);
      }
    };
    img.onerror = function () { done(false); };
    // Older webOS can hang forever on a bad URL — bound the wait.
    setTimeout(function () {
      // naturalWidth > 0 means decode progressed even if onload is flaky.
      done(!!(img.complete && img.naturalWidth > 0));
    }, IMAGE_PROBE_TIMEOUT_MS);
    try {
      img.src = url;
    } catch (err) {
      done(false);
    }
  });
}
