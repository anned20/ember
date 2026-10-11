export interface GalleryEntry {
  id: string;
  title?: string;
  /** Image source candidates, tried in order on error. Omit for a text-only tile. */
  sources?: string[];
  /** Give the tile the text-only style (aerial clips have no thumbnails). */
  text?: boolean;
  /** Extra class on the tile, e.g. `photo-picker-custom`. */
  className?: string;
  ariaLabel?: string;
  /** Extra element appended inside the tile, e.g. the custom-URL hint. */
  extra?: HTMLElement;
  /** Overrides the gallery's onSelect for this tile. */
  onSelect?: (id: string) => void;
}

export interface GalleryOptions {
  heading: string;
  focusIndex: number;
  entries: GalleryEntry[];
  selectedId?: string;
  gridClassName?: string;
  className?: string;
  onSelect: (id: string) => void;
}

export interface Gallery {
  row: HTMLDivElement;
  grid: HTMLDivElement;
  markSelection(selectedId: string): void;
}

/**
 * A D-pad pickable photo gallery of `.photo-picker-tile`s. Arrows browse and
 * Select/click chooses, so the gold `is-selected` state survives focus moving
 * away. One gallery, used for aerials, built-in and online photos.
 */
export function createGallery(options: GalleryOptions): Gallery {
  const row = document.createElement('div');
  row.className = 'settings-block photo-picker-block' +
    (options.className ? ' ' + options.className : '');
  const heading = document.createElement('span');
  heading.className = 'settings-block-label';
  heading.textContent = options.heading;
  row.appendChild(heading);

  const grid = document.createElement('div');
  grid.className = 'photo-picker-grid' + (options.gridClassName ? ' ' + options.gridClassName : '');
  row.appendChild(grid);

  (options.entries || []).forEach(function (entry, index) {
    // div+role=button: a native <button> on webOS often eats Select/OK and
    // leaves focus stuck so you cannot scroll to the next settings rows.
    const tile = document.createElement('div');
    tile.className = [
      'photo-picker-tile',
      entry.text ? 'photo-picker-tile-text' : '',
      'focusable',
      entry.className || ''
    ].filter(Boolean).join(' ');
    tile.setAttribute('role', 'button');
    tile.dataset.focusIndex = String(options.focusIndex + index);
    tile.dataset.galleryId = entry.id;
    tile.setAttribute('aria-label', entry.ariaLabel || entry.title || entry.id);
    tile.tabIndex = 0;

    if (entry.sources && entry.sources.length) {
      const img = document.createElement('img');
      img.className = 'photo-picker-thumb';
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.draggable = false;
      img.style.pointerEvents = 'none';
      const sources = entry.sources;
      let sourceIndex = 0;
      img.src = sources[0];
      img.addEventListener('error', function () {
        sourceIndex += 1;
        if (sourceIndex >= sources.length) {
          tile.classList.add('photo-picker-thumb-failed');
          return;
        }
        img.src = sources[sourceIndex];
      });
      tile.appendChild(img);
    }

    const caption = document.createElement('span');
    caption.className = 'photo-picker-caption';
    caption.textContent = entry.title || entry.id;
    caption.style.pointerEvents = 'none';
    tile.appendChild(caption);

    if (entry.extra) tile.appendChild(entry.extra);

    tile.addEventListener('click', function (event) {
      if (event && event.preventDefault) event.preventDefault();
      if (entry.onSelect) entry.onSelect(entry.id);
      else options.onSelect(entry.id);
    });

    grid.appendChild(tile);
  });

  function markSelection(selectedId: string): void {
    const tiles = grid.querySelectorAll('.photo-picker-tile');
    for (let i = 0; i < tiles.length; i += 1) {
      const tile = tiles[i] as HTMLElement;
      const isSelected = (tile.dataset.galleryId || '') === (selectedId || '');
      tile.classList.toggle('is-selected', isSelected);
      tile.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    }
  }

  if (options.selectedId !== undefined) markSelection(options.selectedId);
  return {row: row, grid: grid, markSelection: markSelection};
}
