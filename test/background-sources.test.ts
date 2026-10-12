import {describe, expect, it} from 'vitest';
import {
  resolveBackgroundCatalog,
  resolveBackgroundMedia,
  sourceFor
} from '@background/background-sources.js';
import {AERIAL_BACKGROUNDS} from '@background/aerials.js';
import {REMOTE_BACKGROUNDS} from '@background/backgrounds.js';
import {MEDIA_GRADIENT, MEDIA_IMAGE, MEDIA_VIDEO, PRESETS} from '@background/media.js';
import type {Config} from '@lib/types.js';

function config(background: Record<string, unknown>): Config {
  return {profile: 'default', launcher: {}, background: background} as unknown as Config;
}

describe('background sources: the adapter registry', () => {
  it('resolves a gradient source to its preset descriptor', async () => {
    const media = await resolveBackgroundMedia(
      config({source: 'preset', mode: 'static', preset: 'cool-gradient'}), '');
    expect(media).toEqual([{kind: MEDIA_GRADIENT, url: PRESETS['cool-gradient']}]);
  });

  it('resolves an animated gradient the same way', async () => {
    const media = await resolveBackgroundMedia(
      config({source: 'animated-gradient', preset: 'ember'}), '');
    expect(media[0].url).toBe(PRESETS.ember);
  });

  it('carries the aerial clip id and title so a host need not look it up', async () => {
    const clip = AERIAL_BACKGROUNDS[2];
    const media = await resolveBackgroundMedia(
      config({source: 'aerial', mode: 'static', aerial: clip.id}), '');
    expect(media).toEqual([{kind: MEDIA_VIDEO, url: clip.url, id: clip.id, title: clip.title}]);
  });

  it('resolves the whole aerial catalog for Slideshow, each with its metadata', async () => {
    const media = await resolveBackgroundMedia(
      config({source: 'aerial', mode: 'slideshow', shuffle: false}), '');
    expect(media.length).toBe(AERIAL_BACKGROUNDS.length);
    expect(media.every(function (item) { return item.kind === MEDIA_VIDEO && !!item.id; })).toBe(true);
    expect(media[0].id).toBe(AERIAL_BACKGROUNDS[0].id);
  });

  it('offers the whole aerial catalog through catalog() regardless of mode', async () => {
    const media = await resolveBackgroundCatalog(
      config({source: 'aerial', mode: 'static', aerial: AERIAL_BACKGROUNDS[0].id}), '');
    expect(media.length).toBe(AERIAL_BACKGROUNDS.length);
  });

  it('resolves built-in photos to image descriptors', async () => {
    const media = await resolveBackgroundMedia(
      config({source: 'builtin', mode: 'static', builtin: 'azure-cove'}), '');
    expect(media.length).toBeGreaterThan(0);
    expect(media.every(function (item) { return item.kind === MEDIA_IMAGE; })).toBe(true);
  });

  it('resolves a custom online URL as-is (TV-safe form)', async () => {
    const media = await resolveBackgroundMedia(
      config({source: 'url', mode: 'static', url: 'https://example.com/a.jpg'}), '');
    expect(media).toEqual([{kind: MEDIA_IMAGE, url: 'https://example.com/a.jpg'}]);
  });

  it('resolves a curated remote pick by id', async () => {
    const entry = REMOTE_BACKGROUNDS[0];
    const media = await resolveBackgroundMedia(
      config({source: 'url', mode: 'static', remote: entry.id}), '');
    expect(media.length).toBe(1);
    expect(media[0].kind).toBe(MEDIA_IMAGE);
    expect(media[0].url).toContain('images.unsplash.com');
  });

  it('resolves the curated online catalog for a URL slideshow', async () => {
    const media = await resolveBackgroundCatalog(
      config({source: 'url', mode: 'static', urls: []}), '');
    expect(media.length).toBe(REMOTE_BACKGROUNDS.length);
    expect(media.every(function (item) { return item.kind === MEDIA_IMAGE; })).toBe(true);
  });

  it('joins a USB filename onto its folder', async () => {
    const media = await resolveBackgroundMedia(
      config({source: 'usb', mode: 'static', file: 'pic.jpg', path: '/media/usb'}), '');
    expect(media).toEqual([{kind: MEDIA_IMAGE, url: '/media/usb/pic.jpg'}]);
  });

  it('resolves nothing for an unknown source (the host then falls back)', async () => {
    expect(await sourceFor('nonsense').resolve({} as never, '')).toEqual([]);
    expect(await resolveBackgroundMedia(config({source: 'nonsense'}), '')).toEqual([]);
  });
});
