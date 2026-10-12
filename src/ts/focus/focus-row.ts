/**
 * A navigable row: the one place that knows a row's index scheme, how to tell
 * which row an element belongs to, and which row a directional move hands off
 * to. The home dock (apps / inputs / channels), the all-apps overlay and the
 * settings lists are all adapters over this module; the focus manager routes
 * keys to a row instead of naming each one.
 */

export type Direction = 'up' | 'down' | 'left' | 'right';

export type RowId =
  | 'channels'
  | 'inputs'
  | 'apps'
  | 'music'
  | 'all-apps'
  | 'settings'
  | 'settings-tabs'
  | 'settings-header'
  | 'settings-photo'
  | 'other';

export interface RowDef {
  id: RowId;
  /**
   * Any element inside this container belongs to the row. Empty for the
   * settings lists: they are navigated by class, not by a single container.
   */
  containerSelector: string;
  /** First focusIndex the row hands out; unset for classification-only rows. */
  indexBase?: number;
  /** Rows a directional move leaves this row for, nearest first. */
  neighbours?: Partial<Record<Direction, RowId[]>>;
  /** How a neighbour row lands on arrival: same column, or its top wrapped row. */
  entry?: 'column' | 'top-row';
  /** false keeps the row out of `rowOf` (used for the settings sub-lists). */
  classify?: boolean;
}

// The home dock and overlays, in the order `rowOf` tests them. Settings is
// tested before all-apps because the panel overlays the rest of the screen.
const ROW_DEFS: RowDef[] = [
  {
    id: 'inputs',
    containerSelector: '#input-row',
    indexBase: 100,
    neighbours: {up: ['channels'], down: ['apps']},
    entry: 'column'
  },
  {
    id: 'channels',
    containerSelector: '#channel-strip',
    indexBase: 150,
    neighbours: {down: ['inputs', 'apps']},
    entry: 'column'
  },
  {
    id: 'apps',
    containerSelector: '#app-grid',
    indexBase: 0,
    neighbours: {up: ['inputs', 'channels']},
    entry: 'top-row'
  },
  {
    id: 'music',
    containerSelector: '#music-bar',
    indexBase: 800
  },
  {
    id: 'settings',
    containerSelector: '#settings-panel'
  },
  {
    id: 'all-apps',
    containerSelector: '.all-apps',
    indexBase: 5000
  },
  // Settings' own lists. Not part of `rowOf`: the focus manager gates the whole
  // panel on the coarse 'settings' row above.
  {
    id: 'settings-tabs',
    containerSelector: '',
    indexBase: 890,
    classify: false
  },
  {
    id: 'settings-header',
    containerSelector: '',
    indexBase: 899,
    classify: false
  },
  {
    id: 'settings-photo',
    containerSelector: '',
    indexBase: 905,
    classify: false
  }
];

const DEFS_BY_ID: Record<string, RowDef> = {};
ROW_DEFS.forEach(function (def) {
  DEFS_BY_ID[def.id] = def;
});

/** The row definition with this id, or undefined for 'other'. */
export function rowById(id: RowId | string): RowDef | undefined {
  return DEFS_BY_ID[id];
}

/** The focusIndex a row hands a tile at `offset` in the row. */
export function indexInRow(id: RowId | string, offset: number): number {
  const def = rowById(id);
  return (def && def.indexBase !== undefined ? def.indexBase : 0) + offset;
}

/** The rows a move in `dir` leaves `id` for, nearest first. */
export function neighbourRows(id: RowId | string, dir: Direction): RowId[] {
  const def = rowById(id);
  return (def && def.neighbours && def.neighbours[dir]) || [];
}

/** Which row `el` sits in, by its nearest matching container. */
export function rowOf(el: Element | null): RowId {
  if (!el) return 'other';
  for (let i = 0; i < ROW_DEFS.length; i += 1) {
    const def = ROW_DEFS[i];
    if (def.classify === false || !def.containerSelector) continue;
    if (el.closest(def.containerSelector)) return def.id;
  }
  return 'other';
}

/**
 * A handle over a row's live tiles: just what callers use. The index base and
 * neighbour edges are free functions (`indexInRow`, `neighbourRows`) because no
 * production code queries them through the handle.
 */
export interface RowHandle<T extends HTMLElement = HTMLElement> {
  tiles(): T[];
  /**
   * The next tile `delta` away in DOM order, skipping any tile `canFocus`
   * rejects, or null at the row edge. No layout geometry is involved.
   */
  moveWithin(from: T, delta: number, canFocus: (el: T) => boolean): T | null;
}

/**
 * Build a navigable-row handle over a live tile list. `tiles` is read on each
 * call so a row that redraws keeps working.
 */
export function createRow<T extends HTMLElement>(
  tiles: () => T[]
): RowHandle<T> {
  return {
    tiles: tiles,
    moveWithin: function (from: T, delta: number, canFocus: (el: T) => boolean) {
      const list = tiles();
      const idx = list.indexOf(from);
      if (idx < 0) return null;
      for (let i = idx + delta; i >= 0 && i < list.length; i += delta) {
        if (canFocus(list[i])) return list[i];
      }
      return null;
    }
  };
}
