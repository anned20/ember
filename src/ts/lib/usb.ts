import {getStorageDevices} from '@luna/luna.js';
import {BRAND} from './brand.js';
import type {Config, UsbTrack} from './types.js';

const AUDIO_EXT = ['.mp3', '.aac', '.flac', '.ogg', '.m4a', '.wav'];
const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

/** A raw track entry from a tracks.json manifest. */
interface RawTrackEntry {
  file?: string;
  title?: string;
  artist?: string;
}

/** Paths discovered on a USB drive's Ember folder. */
export interface LoungePaths {
  root: string;
  usbConfig: unknown;
  musicPath: string;
  backgroundPath: string;
}

function stripUrlQuery(name: unknown): string {
  // "assets/music/foo.mp3?v=0.0.58" must still match .mp3
  const s = String(name || '');
  const q = s.indexOf('?');
  const h = s.indexOf('#');
  let end = s.length;
  if (q >= 0 && q < end) end = q;
  if (h >= 0 && h < end) end = h;
  return s.slice(0, end);
}

export function isAudioFile(name: unknown): boolean {
  const lower = stripUrlQuery(name).toLowerCase();
  return AUDIO_EXT.some(function (ext) {
    return lower.endsWith(ext);
  });
}

export function isImageFile(name: unknown): boolean {
  const lower = stripUrlQuery(name).toLowerCase();
  return IMAGE_EXT.some(function (ext) {
    return lower.endsWith(ext);
  });
}

export function normalizeTrack(entry: unknown, basePath: string): UsbTrack | null {
  if (typeof entry === 'string') {
    const url = entry.indexOf('/') === 0 ? entry : joinPath(basePath, entry);
    return {url: url, title: '', artist: ''};
  }

  if (entry && typeof entry === 'object' && (entry as RawTrackEntry).file) {
    const e = entry as RawTrackEntry;
    const file = e.file as string;
    const url = file.indexOf('/') === 0 ? file : joinPath(basePath, file);
    return {
      url: url,
      title: e.title || '',
      artist: e.artist || ''
    };
  }

  return null;
}

export async function findLoungeRoots(): Promise<string[]> {
  const mounts: string[] = [];

  try {
    const res = await getStorageDevices();
    const devices = (res && res.storageDeviceList) || [];

    for (const device of devices) {
      const drives = device.storageDriveList || [];
      for (const drive of drives) {
        if (!drive.isMounted || !drive.mountName) continue;
        mounts.push(drive.mountName);
      }
    }
  } catch (err) {
    // USB discovery may fail in browser dev mode.
  }

  // Prefer the Ember folder on every drive; an older Launch Home drive still
  // has its media under `lounge/`, so fall back to it.
  const roots: string[] = [];
  for (const mount of mounts) roots.push(joinPath(mount, BRAND.usbFolder));
  for (const mount of mounts) roots.push(joinPath(mount, BRAND.legacy.usbFolder));
  return roots;
}

export function joinPath(base: string, part: string): string {
  if (!base) return part;
  if (base.endsWith('/')) return base + part;
  return base + '/' + part;
}

export async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
}

export async function fetchJson(url: string): Promise<any> {
  const text = await fetchText(url);
  return JSON.parse(text);
}

function resolveTrackUrl(trimmed: string, basePath: string): string {
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.indexOf('/') === 0) return trimmed;
  return joinPath(basePath, trimmed);
}

export function parseM3u(text: string, basePath: string): UsbTrack[] {
  const tracks: UsbTrack[] = [];
  const lines = text.split(/\r?\n/);
  let pendingMeta: {artist: string; title: string} | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.indexOf('#EXTINF:') === 0) {
      const meta = trimmed.slice('#EXTINF:'.length);
      const comma = meta.indexOf(',');
      const titlePart = comma >= 0 ? meta.slice(comma + 1).trim() : '';
      let artist = '';
      let title = titlePart;
      const dash = titlePart.indexOf(' - ');

      if (dash >= 0) {
        artist = titlePart.slice(0, dash).trim();
        title = titlePart.slice(dash + 3).trim();
      }

      pendingMeta = {artist: artist, title: title};
      continue;
    }

    if (trimmed.charAt(0) === '#') continue;

    const url = resolveTrackUrl(trimmed, basePath);
    tracks.push({
      url: url,
      title: (pendingMeta && pendingMeta.title) || '',
      artist: (pendingMeta && pendingMeta.artist) || ''
    });
    pendingMeta = null;
  }

  return tracks;
}

async function loadUsbConfigFrom(roots: string[]): Promise<{root: string; config: unknown} | null> {
  for (const root of roots) {
    try {
      const config = await fetchJson(joinPath(root, 'config.json'));
      return {root: root, config: config};
    } catch (err) {
      // Try next volume.
    }
  }

  return null;
}

export async function discoverMusicTracks(musicPath: string): Promise<UsbTrack[]> {
  if (!musicPath) return [];

  const playlistUrl = joinPath(musicPath, 'playlist.m3u');
  try {
    const text = await fetchText(playlistUrl);
    const tracks = parseM3u(text, musicPath).filter(function (track) {
      return isAudioFile(track.url);
    });
    if (tracks.length) return tracks;
  } catch (err) {
    // Fall through to manifest.
  }

  const manifestUrl = joinPath(musicPath, 'tracks.json');
  try {
    const manifest = await fetchJson(manifestUrl);
    if (Array.isArray(manifest)) {
      return manifest
        .map(function (entry: unknown) {
          return normalizeTrack(entry, musicPath);
        })
        .filter(function (track): track is UsbTrack {
          return track !== null;
        })
        .filter(function (track) {
          return isAudioFile(track.url);
        });
    }
  } catch (err) {
    // No manifest.
  }

  return [];
}

export async function discoverBackgroundImages(backgroundPath: string): Promise<string[]> {
  if (!backgroundPath) return [];

  const manifestUrl = joinPath(backgroundPath, 'images.json');
  try {
    const manifest = await fetchJson(manifestUrl);
    if (Array.isArray(manifest)) {
      return manifest
        .map(function (entry: unknown) {
          if (typeof entry === 'string') {
            return entry.indexOf('/') === 0 ? entry : joinPath(backgroundPath, entry);
          }
          return null;
        })
        .filter(function (entry): entry is string {
          return entry !== null;
        })
        .filter(isImageFile);
    }
  } catch (err) {
    // No manifest.
  }

  return [];
}

/** Whether `root` holds a USB config or any background/music media. */
async function rootHasContent(root: string): Promise<boolean> {
  const probes = [
    'config.json',
    'music/playlist.m3u',
    'music/tracks.json',
    'backgrounds/images.json'
  ];
  for (const probe of probes) {
    try {
      await fetchText(joinPath(root, probe));
      return true;
    } catch (err) {
      // Not here; try the next file.
    }
  }
  return false;
}

export async function resolveLoungePaths(config: Config): Promise<LoungePaths> {
  const roots = await findLoungeRoots();
  const usb = await loadUsbConfigFrom(roots);
  let root = usb ? usb.root : '';
  if (!root) {
    // No USB config: take the first folder (Ember, else Launch Home) with media.
    for (const candidate of roots) {
      if (await rootHasContent(candidate)) {
        root = candidate;
        break;
      }
    }
  }

  const musicPath = (config.music && config.music.path) || (root ? joinPath(root, 'music') : '');
  const backgroundPath = (config.background && config.background.path) || (root ? joinPath(root, 'backgrounds') : '');

  return {
    root: root,
    usbConfig: usb ? usb.config : null,
    musicPath: musicPath,
    backgroundPath: backgroundPath
  };
}
