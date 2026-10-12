import {describe, expect, it} from 'vitest';
import {
  createRow,
  indexInRow,
  neighbourRows,
  rowById,
  rowOf
} from '@focus/focus-row.js';
import type {RowId} from '@focus/focus-row.js';

function button(): HTMLButtonElement {
  const el = document.createElement('button');
  el.className = 'focusable';
  return el;
}

// Every row definition, keyed by id. Locking each row's base, neighbours,
// entry and classify flag is what stops a refactor drifting the model.
const EXPECTED_MODEL = [
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
  {id: 'music', containerSelector: '#music-bar', indexBase: 800},
  {id: 'settings', containerSelector: '#settings-panel'},
  {id: 'all-apps', containerSelector: '.all-apps', indexBase: 5000},
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

describe('focus row model', () => {
  it('locks every row definition', () => {
    const ids: RowId[] = [
      'inputs',
      'channels',
      'apps',
      'music',
      'settings',
      'all-apps',
      'settings-tabs',
      'settings-header',
      'settings-photo'
    ];
    expect(ids.map((id) => rowById(id))).toEqual(EXPECTED_MODEL);
  });

  it('falls back for unknown rows and missing neighbours', () => {
    expect(rowById('nope')).toBeUndefined();
    expect(rowById('other')).toBeUndefined();
    expect(indexInRow('nope', 5)).toBe(5);
    expect(indexInRow('settings', 2)).toBe(2);
    expect(neighbourRows('nope', 'up')).toEqual([]);
    expect(neighbourRows('music', 'left')).toEqual([]);
    expect(neighbourRows('apps', 'down')).toEqual([]);
  });
});

describe('index allocation', () => {
  it('declares each row index base once', () => {
    expect(indexInRow('apps', 0)).toBe(0);
    expect(indexInRow('apps', 4)).toBe(4);
    expect(indexInRow('inputs', 0)).toBe(100);
    expect(indexInRow('inputs', 2)).toBe(102);
    expect(indexInRow('channels', 0)).toBe(150);
    expect(indexInRow('music', 0)).toBe(800);
    expect(indexInRow('all-apps', 0)).toBe(5000);
    expect(indexInRow('settings-tabs', 0)).toBe(890);
    expect(indexInRow('settings-header', 0)).toBe(899);
    expect(indexInRow('settings-header', 1)).toBe(900);
    expect(indexInRow('settings-photo', 0)).toBe(905);
  });
});

describe('row classification', () => {
  it('reports the row an element sits in', () => {
    const grid = document.createElement('div');
    grid.id = 'app-grid';
    const tile = document.createElement('button');
    grid.appendChild(tile);
    const strip = document.createElement('div');
    strip.id = 'channel-strip';
    const chip = document.createElement('button');
    strip.appendChild(chip);
    document.body.appendChild(grid);
    document.body.appendChild(strip);

    expect(rowOf(tile)).toBe('apps');
    expect(rowOf(chip)).toBe('channels');
    expect(rowOf(document.body)).toBe('other');
    expect(rowOf(null)).toBe('other');
  });

  it('keeps the settings sub-lists out of classification', () => {
    const panel = document.createElement('div');
    panel.id = 'settings-panel';
    const tab = document.createElement('button');
    tab.className = 'settings-tab';
    panel.appendChild(tab);
    document.body.appendChild(panel);

    expect(rowOf(tab)).toBe('settings');
  });

  it('prefers the settings panel over the all-apps overlay', () => {
    const panel = document.createElement('div');
    panel.id = 'settings-panel';
    const overlay = document.createElement('div');
    overlay.className = 'all-apps';
    const tile = document.createElement('button');
    overlay.appendChild(tile);
    panel.appendChild(overlay);
    document.body.appendChild(panel);

    expect(rowOf(tile)).toBe('settings');
  });

  it('classifies in the declared row order', () => {
    const order: Array<[RowId, string]> = [
      ['inputs', '#input-row'],
      ['channels', '#channel-strip'],
      ['apps', '#app-grid'],
      ['music', '#music-bar'],
      ['settings', '#settings-panel'],
      ['all-apps', '.all-apps']
    ];
    // Nest every container so the leaf matches them all; `rowOf` returns the
    // first match in declaration order, then the next as each is unhooked.
    const wrappers = order.map(([, selector]) => {
      const el = document.createElement('div');
      if (selector.charAt(0) === '#') el.id = selector.slice(1);
      else el.className = selector.slice(1);
      return el;
    });
    wrappers.forEach((el, i) => {
      (i === 0 ? document.body : wrappers[i - 1]).appendChild(el);
    });
    const leaf = document.createElement('button');
    wrappers[wrappers.length - 1].appendChild(leaf);

    order.forEach(([row], i) => {
      expect(rowOf(leaf)).toBe(row);
      if (i + 1 < order.length) document.body.appendChild(wrappers[i + 1]);
    });
  });

  it('treats a detached element as other', () => {
    expect(rowOf(document.createElement('button'))).toBe('other');
  });
});

describe('neighbour edges', () => {
  it('declares the home dock hand-off, nearest first', () => {
    expect(neighbourRows('channels', 'down')).toEqual(['inputs', 'apps']);
    expect(neighbourRows('inputs', 'down')).toEqual(['apps']);
    expect(neighbourRows('inputs', 'up')).toEqual(['channels']);
    expect(neighbourRows('apps', 'up')).toEqual(['inputs', 'channels']);
    expect(neighbourRows('apps', 'down')).toEqual([]);
    expect(neighbourRows('music', 'up')).toEqual([]);
  });

  it('uses top-row landing for the wrapped app grid', () => {
    expect(rowById('apps')!.entry).toBe('top-row');
    expect(rowById('inputs')!.entry).toBe('column');
  });
});

describe('createRow', () => {
  it('moves within the row in DOM order', () => {
    const tiles = [button(), button(), button()];
    const row = createRow(() => tiles);

    expect(row.moveWithin(tiles[1], 1, () => true)).toBe(tiles[2]);
    expect(row.moveWithin(tiles[1], -1, () => true)).toBe(tiles[0]);
  });

  it('skips tiles that refuse focus and stops at the row edge', () => {
    const tiles = [button(), button(), button()];
    const row = createRow(() => tiles);
    const canFocus = (el: HTMLButtonElement) => el !== tiles[1];

    expect(row.moveWithin(tiles[0], 1, canFocus)).toBe(tiles[2]);
    expect(row.moveWithin(tiles[0], -1, canFocus)).toBeNull();
    expect(row.moveWithin(tiles[2], 1, canFocus)).toBeNull();
  });

  it('reads its live tiles on each call', () => {
    let tiles = [button(), button()];
    const row = createRow(() => tiles);
    expect(row.tiles()).toBe(tiles);
    tiles = [button()];
    expect(row.tiles()).toBe(tiles);
  });

  it('reports null edges for an empty row', () => {
    const row = createRow<HTMLButtonElement>(() => []);
    expect(row.tiles()).toEqual([]);
    expect(row.moveWithin(button(), 1, () => true)).toBeNull();
  });

  it('returns null when moving from an element outside the row', () => {
    const tiles = [button(), button()];
    const row = createRow(() => tiles);
    expect(row.moveWithin(button(), 1, () => true)).toBeNull();
  });
});
