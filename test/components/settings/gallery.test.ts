import {describe, expect, it, vi} from 'vitest';
import {createGallery} from '../../../src/ts/components/settings/gallery.js';

describe('createGallery', () => {
  it('builds tiles, selects one and re-paints selection', () => {
    const onSelect = vi.fn();
    const gallery = createGallery({
      heading: 'Choose an online photo',
      focusIndex: 905,
      selectedId: 'a',
      entries: [
        {id: 'a', title: 'Alpha', sources: ['a.jpg', 'a2.jpg']},
        {id: 'b', title: 'Beta', sources: ['b.jpg']},
        {id: 'text', title: 'Text only', text: true}
      ],
      onSelect
    });

    const tiles = gallery.grid.querySelectorAll('.photo-picker-tile');
    expect(tiles.length).toBe(3);
    expect((tiles[0] as HTMLElement).dataset.galleryId).toBe('a');
    expect((tiles[0] as HTMLElement).classList.contains('is-selected')).toBe(true);
    expect((tiles[0] as HTMLElement).dataset.focusIndex).toBe('905');
    expect((tiles[2] as HTMLElement).classList.contains('photo-picker-tile-text')).toBe(true);

    (tiles[1] as HTMLElement).click();
    expect(onSelect).toHaveBeenCalledWith('b');

    gallery.markSelection('b');
    expect((tiles[1] as HTMLElement).classList.contains('is-selected')).toBe(true);
    expect((tiles[0] as HTMLElement).classList.contains('is-selected')).toBe(false);
  });

  it('falls back through image sources before failing', () => {
    const gallery = createGallery({
      heading: 'Photos',
      focusIndex: 905,
      entries: [{id: 'a', title: 'A', sources: ['first.jpg', 'second.jpg']}],
      onSelect: () => {}
    });
    const img = gallery.grid.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('first.jpg');
    img.dispatchEvent(new Event('error'));
    expect(img.getAttribute('src')).toBe('second.jpg');
    img.dispatchEvent(new Event('error'));
    expect(img.closest('.photo-picker-tile')!.classList.contains('photo-picker-thumb-failed')).toBe(true);
  });
});
