/**
 * The Settings control kit.
 *
 * Each factory returns one wired, focusable control: a toggle, a text field, a
 * hint, a section, a mini button, an app row, or a photo gallery. Panes compose
 * them; a control's shape (DOM, classes, focus index, events) lives here once
 * instead of being hand-built at every call site.
 */

/** A label plus a control, laid out as a Settings row. */
export function labeledControl(label: string, control: Element): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'settings-row';
  const span = document.createElement('span');
  span.textContent = label;
  wrap.appendChild(span);
  wrap.appendChild(control);
  return wrap;
}

/** A heading plus a control, laid out as a Settings block. */
export function labeledBlock(label: string, control: Element): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'settings-block';
  const heading = document.createElement('span');
  heading.className = 'settings-block-label';
  heading.textContent = label;
  wrap.appendChild(heading);
  wrap.appendChild(control);
  return wrap;
}

/** A `settings-hint` paragraph. `extraClass` carries the one-off modifiers. */
export function createHint(text: string, extraClass?: string): HTMLParagraphElement {
  const hint = document.createElement('p');
  hint.className = 'settings-hint' + (extraClass ? ' ' + extraClass : '');
  hint.textContent = text;
  return hint;
}

/** A `settings-section` with an `<h3>` heading. */
export function createSection(title: string, extraClass?: string): HTMLElement {
  const section = document.createElement('section');
  section.className = 'settings-section' + (extraClass ? ' ' + extraClass : '');
  const heading = document.createElement('h3');
  heading.textContent = title;
  section.appendChild(heading);
  return section;
}

export interface ToggleOptions {
  label: string;
  focusIndex: number | string;
  checked?: boolean;
  /** Extra class on the checkbox, after the default `focusable`. */
  className?: string;
  onChange?: (checked: boolean) => void;
}

export interface Toggle {
  row: HTMLDivElement;
  input: HTMLInputElement;
}

/** A labelled checkbox, wired for D-pad focus and change events. */
export function createToggle(options: ToggleOptions): Toggle {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'focusable' + (options.className ? ' ' + options.className : '');
  input.dataset.focusIndex = String(options.focusIndex);
  input.checked = !!options.checked;
  if (options.onChange) {
    input.addEventListener('change', function () { options.onChange!(input.checked); });
  }
  return {row: labeledControl(options.label, input), input: input};
}

export interface TextFieldOptions {
  label: string;
  focusIndex: number | string;
  type?: 'text' | 'number' | 'password' | 'search' | 'url' | 'range';
  value?: string;
  placeholder?: string;
  /** Render a `<textarea>` instead of an `<input>`. */
  textarea?: boolean;
  rows?: number;
  min?: string;
  max?: string;
  step?: string;
  spellcheck?: boolean;
  autocomplete?: string;
  /** Overrides the default `settings-text focusable` / textarea class. */
  className?: string;
  /** Lay the label out as a `settings-block` heading instead of a row. */
  block?: boolean;
  onInput?: (value: string) => void;
  onChange?: (value: string) => void;
}

export interface TextField {
  row: HTMLDivElement;
  input: HTMLInputElement & HTMLTextAreaElement;
}

/** A labelled text field (or textarea), gated for the TV keyboard elsewhere. */
export function createTextField(options: TextFieldOptions): TextField {
  const isTextarea = !!options.textarea;
  const input = document.createElement(isTextarea ? 'textarea' : 'input') as
    HTMLInputElement & HTMLTextAreaElement;
  const defaultClass = isTextarea ? 'settings-textarea focusable' : 'settings-text focusable';
  input.className = options.className || defaultClass;
  input.dataset.focusIndex = String(options.focusIndex);
  if (isTextarea) {
    input.rows = options.rows || 4;
  } else {
    input.type = options.type || 'text';
    if (options.min !== undefined) input.min = options.min;
    if (options.max !== undefined) input.max = options.max;
    if (options.step !== undefined) input.step = options.step;
    if (options.spellcheck === false) input.spellcheck = false;
    if (options.autocomplete) input.setAttribute('autocomplete', options.autocomplete);
  }
  if (options.placeholder !== undefined) input.placeholder = options.placeholder;
  if (options.value !== undefined) input.value = options.value;
  if (options.onInput) {
    input.addEventListener('input', function () { options.onInput!(input.value); });
  }
  if (options.onChange) {
    input.addEventListener('change', function () { options.onChange!(input.value); });
  }
  const row = options.block ? labeledBlock(options.label, input) : labeledControl(options.label, input);
  return {row: row, input: input};
}

export interface MiniButtonOptions {
  label: string;
  focusIndex: number | string;
  /** Extra classes, after the default `settings-mini-btn focusable`. */
  className?: string;
  onClick?: (event: MouseEvent) => void;
  dataset?: Record<string, string>;
  ariaLabel?: string;
}

/** A `settings-mini-btn` button wired for focus and click. */
export function createMiniButton(options: MiniButtonOptions): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'settings-mini-btn focusable' +
    (options.className ? ' ' + options.className : '');
  btn.dataset.focusIndex = String(options.focusIndex);
  if (options.ariaLabel) btn.setAttribute('aria-label', options.ariaLabel);
  if (options.dataset) {
    Object.keys(options.dataset).forEach(function (key) {
      btn.dataset[key] = options.dataset![key];
    });
  }
  btn.textContent = options.label;
  if (options.onClick) btn.addEventListener('click', options.onClick);
  return btn;
}

export interface AppRowOptions {
  title: string;
  icon?: string;
  /** The pinned list styles its rows and titles differently. */
  variant?: 'app' | 'pinned';
  missing?: boolean;
  /** Appended to the title, e.g. " — not installed on this TV". */
  titleSuffix?: string;
  /** Wire the icon `<img>` (src, error handling, lazy loading). */
  mountIcon?: (img: HTMLImageElement) => void;
}

export interface AppRow {
  row: HTMLDivElement;
  title: HTMLSpanElement;
}

/** An app row: optional icon, title, and whatever buttons the caller adds. */
export function createAppRow(options: AppRowOptions): AppRow {
  const pinned = options.variant === 'pinned';
  const row = document.createElement('div');
  row.className = pinned ? 'settings-pinned-row' : 'settings-app-row';
  if (options.missing) row.classList.add('is-missing');

  if (options.icon) {
    const img = document.createElement('img');
    img.className = 'settings-app-icon';
    img.alt = '';
    if (options.mountIcon) options.mountIcon(img);
    row.appendChild(img);
  }

  const title = document.createElement('span');
  if (pinned) title.className = 'settings-pinned-title';
  title.textContent = options.title + (options.titleSuffix || '');
  row.appendChild(title);

  return {row: row, title: title};
}

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
