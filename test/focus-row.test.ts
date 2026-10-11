import {describe, expect, it} from 'vitest';
import {
  createRow,
  indexInRow,
  neighbourRows,
  rowById,
  rowOf
} from '@focus/focus-row.js';

function button(): HTMLButtonElement {
  const el = document.createElement('button');
  el.className = 'focusable';
  return el;
}

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
    const row = createRow(rowById('apps')!, () => tiles);

    expect(row.moveWithin(tiles[1], 1, () => true)).toBe(tiles[2]);
    expect(row.moveWithin(tiles[1], -1, () => true)).toBe(tiles[0]);
  });

  it('skips tiles that refuse focus and stops at the row edge', () => {
    const tiles = [button(), button(), button()];
    const row = createRow(rowById('apps')!, () => tiles);
    const canFocus = (el: HTMLButtonElement) => el !== tiles[1];

    expect(row.moveWithin(tiles[0], 1, canFocus)).toBe(tiles[2]);
    expect(row.moveWithin(tiles[0], -1, canFocus)).toBeNull();
    expect(row.moveWithin(tiles[2], 1, canFocus)).toBeNull();
  });

  it('reports first, last and the current tile', () => {
    const tiles = [button(), button()];
    document.body.appendChild(tiles[0]);
    document.body.appendChild(tiles[1]);
    const row = createRow(rowById('inputs')!, () => tiles);

    expect(row.first()).toBe(tiles[0]);
    expect(row.last()).toBe(tiles[1]);
    expect(row.current()).toBeNull();
    tiles[1].focus();
    expect(row.current()).toBe(tiles[1]);
  });

  it('hands off to a named neighbour row', () => {
    const row = createRow(rowById('inputs')!, () => []);
    expect(row.handoff('up')).toEqual(['channels']);
    expect(row.handoff('down')).toEqual(['apps']);
  });

  it('allocates focusIndex from the declared base', () => {
    const row = createRow(rowById('channels')!, () => []);
    expect(row.indexFor(0)).toBe(150);
    expect(row.indexFor(3)).toBe(153);
  });
});
