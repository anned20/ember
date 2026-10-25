import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createHomePaint} from '@home/paint.js';
import type {PaintElements} from '@home/paint.js';
import {setLanguage, t} from '@lib/i18n.js';
import type {Config, LauncherConfig} from '@lib/types.js';

function launcher(overrides: Partial<LauncherConfig> = {}): LauncherConfig {
  return Object.assign({
    showClock: true,
    showDate: true,
    clockFormat: '24',
    clockAlign: 'center',
    clockSize: 'large',
    clockShadow: 'strong',
    timezone: '',
    glassTint: 'light',
    glassBorder: 'white',
    focusColour: 'warm',
    tileStyle: 'glass',
    iconSize: 'medium',
    iconAlign: 'center',
    iconLayout: 'scroll',
    iconsPerRow: 7,
    perfMode: false
  }, overrides) as LauncherConfig;
}

function mount(): PaintElements {
  document.body.innerHTML = `
    <div class="launcher"></div>
    <div id="app-grid-shell"><div id="app-grid"></div></div>
    <div id="clock"></div>
    <div id="clock-date"></div>
    <footer id="music-bar"></footer>`;
  return {
    clock: document.getElementById('clock'),
    clockDate: document.getElementById('clock-date'),
    launcher: document.querySelector('.launcher'),
    appGrid: document.getElementById('app-grid'),
    appGridShell: document.getElementById('app-grid-shell'),
    musicBar: document.getElementById('music-bar')
  };
}

const paints: Array<ReturnType<typeof createHomePaint>> = [];

function setup(overrides: Partial<LauncherConfig> = {}) {
  const config = {launcher: launcher(overrides)} as unknown as Config;
  const elements = mount();
  const onPerfMode = vi.fn();
  const paint = createHomePaint(elements, () => config, {onPerfMode});
  paints.push(paint);
  return {config, elements, onPerfMode, paint};
}

/** Give the app grid the box metrics jsdom does not lay out. */
function stubGrid(grid: HTMLElement, scrollWidth: number, clientWidth: number): void {
  Object.defineProperty(grid, 'scrollWidth', {configurable: true, value: scrollWidth});
  Object.defineProperty(grid, 'clientWidth', {configurable: true, value: clientWidth});
}

beforeEach(() => {
  setLanguage('en');
});

afterEach(() => {
  paints.forEach(function (paint) { paint.stop(); });
  paints.length = 0;
  vi.useRealTimers();
  document.body.className = '';
  document.body.innerHTML = '';
});

describe('the home paint', () => {
  it('paints the Tile style from the config', () => {
    const {config, paint} = setup({tileStyle: 'plain'});

    paint.apply();
    expect(document.body.classList.contains('tiles-plain')).toBe(true);

    config.launcher.tileStyle = 'glass';
    paint.apply();
    expect(document.body.classList.contains('tiles-plain')).toBe(false);
  });

  it('falls back to the default clock for an unknown value', () => {
    const {paint} = setup({clockAlign: 'sideways', clockSize: 'huge', clockShadow: 'glow'});

    paint.apply();

    expect(document.body.classList.contains('clock-center')).toBe(true);
    expect(document.body.classList.contains('clock-size-large')).toBe(true);
    expect(document.body.classList.contains('clock-shadow-strong')).toBe(true);
  });

  it('paints the clock, its marker and the date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 18, 30));
    const {elements, paint} = setup({
      clockFormat: '12',
      clockAlign: 'center-middle',
      clockSize: 'x-large'
    });

    paint.apply();

    expect(elements.clock!.textContent).toBe('6:30' + t('clock.pm'));
    expect(elements.clock!.querySelector('.clock-ampm')!.textContent).toBe(t('clock.pm'));
    expect(elements.clockDate!.textContent).toContain('January');
    expect(document.body.classList.contains('clock-center-middle')).toBe(true);
    expect(document.body.classList.contains('clock-size-x-large')).toBe(true);
  });

  it('hides the clock and the date when switched off', () => {
    const {elements, paint} = setup({showClock: false, showDate: false});

    paint.apply();

    expect(elements.clock!.textContent).toBe('');
    expect(elements.clockDate!.textContent).toBe('');
  });

  it('paints the Glass colour, border and focus colour', () => {
    const {config, paint} = setup({
      glassTint: 'dark',
      glassBorder: 'gold',
      focusColour: 'blue'
    });

    paint.apply();
    expect(document.body.classList.contains('glass-dark')).toBe(true);
    expect(document.body.classList.contains('glass-border-gold')).toBe(true);
    expect(document.body.classList.contains('focus-blue')).toBe(true);

    config.launcher.glassTint = 'light';
    config.launcher.glassBorder = 'white';
    paint.apply();
    expect(document.body.classList.contains('glass-dark')).toBe(false);
    expect(document.body.classList.contains('glass-border-gold')).toBe(false);
  });

  it('aligns the icons', () => {
    const {elements, config, paint} = setup({iconAlign: 'left'});

    paint.apply();
    expect(elements.launcher!.classList.contains('icons-left')).toBe(true);
    expect(elements.launcher!.classList.contains('icons-center')).toBe(false);

    config.launcher.iconAlign = 'right';
    paint.apply();
    expect(elements.launcher!.classList.contains('icons-right')).toBe(true);
  });

  it('caps the scroll row and clamps the per-row count', () => {
    const {config, elements, paint} = setup({iconsPerRow: 7});

    paint.layoutChanged();
    expect(elements.launcher!.classList.contains('layout-scroll')).toBe(true);
    // 7 tiles of 152px plus 14px margins each, plus the grid's 16px padding.
    expect((elements.appGridShell as HTMLElement).style.maxWidth).toBe('1276px');
    expect((elements.appGridShell as HTMLElement).style.getPropertyValue('--tile-scale')).toBe('1');

    config.launcher.iconsPerRow = 1;
    paint.layoutChanged();
    expect((elements.appGridShell as HTMLElement).style.maxWidth).toBe('556px');

    config.launcher.iconsPerRow = 99;
    paint.layoutChanged();
    expect((elements.appGridShell as HTMLElement).style.maxWidth).toBe('2176px');

    config.launcher.iconSize = 'large';
    paint.layoutChanged();
    expect((elements.appGridShell as HTMLElement).style.maxWidth).toBe('2687px');
    expect((elements.appGridShell as HTMLElement).style.getPropertyValue('--tile-scale')).toBe('1.28');
  });

  it('stacks the icons in the wrap layout', () => {
    const {elements, paint} = setup({iconLayout: 'wrap'});

    paint.layoutChanged();

    expect(elements.launcher!.classList.contains('layout-wrap')).toBe(true);
    expect(elements.launcher!.classList.contains('layout-scroll')).toBe(false);
    expect((elements.appGridShell as HTMLElement).style.maxWidth).toBe('');
    expect((elements.appGridShell as HTMLElement).style.getPropertyValue('--tile-scale')).toBe('1');
  });

  it('shows scroll arrows only past a third of a tile', () => {
    const {elements, paint} = setup();
    const grid = elements.appGrid!;
    const shell = elements.appGridShell!;
    const tile = document.createElement('div');
    tile.className = 'app-tile';
    Object.defineProperty(tile, 'offsetWidth', {configurable: true, value: 60});
    grid.appendChild(tile);

    stubGrid(grid, 500, 100);
    grid.scrollLeft = 0;
    paint.layoutChanged();
    expect(shell.classList.contains('can-scroll-right')).toBe(true);
    expect(shell.classList.contains('can-scroll-left')).toBe(false);

    grid.scrollLeft = 200;
    paint.layoutChanged();
    expect(shell.classList.contains('can-scroll-left')).toBe(true);
    expect(shell.classList.contains('can-scroll-right')).toBe(true);

    // Ten pixels of overflow is under a third of a tile: no arrows for it.
    stubGrid(grid, 110, 100);
    paint.layoutChanged();
    expect(shell.classList.contains('can-scroll-left')).toBe(false);
    expect(shell.classList.contains('can-scroll-right')).toBe(false);
  });

  it('switches Performance mode and its wallpaper', () => {
    const {config, onPerfMode, paint} = setup({perfMode: true});

    paint.apply();
    expect(document.body.classList.contains('perf-mode')).toBe(true);
    expect(onPerfMode).toHaveBeenCalledWith(true);

    config.launcher.perfMode = false;
    paint.apply();
    expect(document.body.classList.contains('perf-mode')).toBe(false);
    expect(onPerfMode).toHaveBeenLastCalledWith(false);
  });

  it('keeps time while running and stops cleanly', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 18, 30));
    const {elements, paint} = setup();

    paint.start();
    expect(elements.clock!.textContent).toBe('18:30');

    vi.setSystemTime(new Date(2026, 0, 1, 18, 31));
    vi.advanceTimersByTime(30000);
    expect(elements.clock!.textContent).toBe('18:31');

    paint.stop();
    expect(vi.getTimerCount()).toBe(0);
    vi.setSystemTime(new Date(2026, 0, 1, 18, 33));
    vi.advanceTimersByTime(60000);
    expect(elements.clock!.textContent).toBe('18:31');
  });
});
