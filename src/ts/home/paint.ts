/**
 * The home paint pass: config in, DOM out. It owns the home screen's Look — the
 * clock, Glass, Tile style, icon layout and Performance mode — and the tick and
 * listeners that keep them fresh. `main.ts` calls it from `refreshAll`; it does
 * not orchestrate other modules.
 */

import {setClockTime} from '@lib/clock-format.js';
import {activeLocale} from '@lib/i18n.js';
import type {Config, LauncherConfig} from '@lib/types.js';

// Settings -> Look -> Glass colour and Glass border: body.glass-<tint> and
// body.glass-border-<colour> recolour the glass (main.css). Light glass with
// a white border is the original look and needs no class.
const GLASS_TINTS = ['dark', 'black', 'blue', 'purple', 'green', 'warm'];
const GLASS_BORDERS = ['glass', 'none', 'black', 'blue', 'purple', 'green', 'warm', 'gold'];
// Settings -> Look -> Focus colour: body.focus-<colour>; warm needs no class.
const FOCUS_COLOURS = ['white', 'border', 'blue', 'purple', 'green', 'gold'];

function formatClockDate(date: Date, timezone: string) {
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  };
  if (timezone) {
    options.timeZone = timezone;
  }
  try {
    return new Intl.DateTimeFormat(activeLocale(), options).format(date);
  } catch (err) {
    // Invalid timezone — fall back to local date.
    delete options.timeZone;
    return new Intl.DateTimeFormat(activeLocale(), options).format(date);
  }
}

/** The six home elements the paint pass writes to. */
export interface PaintElements {
  clock: HTMLElement | null;
  clockDate: HTMLElement | null;
  launcher: Element | null;
  appGrid: HTMLElement | null;
  appGridShell: HTMLElement | null;
  musicBar: HTMLElement | null;
}

export interface HomePaint {
  /** Paint the clock, start the 30 s tick and bind the layout listeners. */
  start(): void;
  /** Clear the tick, the deferred measurements and the listeners. */
  stop(): void;
  /** Re-apply the Look from config (clock, Glass, Tile style, Performance mode). */
  apply(): void;
  /** Re-measure the icon layout, the scroll hints and the music-bar clearance. */
  layoutChanged(): void;
}

export function createHomePaint(
  elements: PaintElements,
  getConfig: () => Config,
  options: {onPerfMode: (on: boolean) => void}
): HomePaint {
  let clockTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let bound = false;
  let hintFrame: number | null = null;
  const hintTimers = new Set<ReturnType<typeof setTimeout>>();
  const removers: Array<() => void> = [];

  function applyClockStyle() {
    const launcher = (getConfig().launcher) || ({} as LauncherConfig);
    const rawAlign = launcher.clockAlign || 'center';
    // left | center (centre top) | center-middle | right
    const align =
      rawAlign === 'left' ||
      rawAlign === 'right' ||
      rawAlign === 'center-middle'
        ? rawAlign
        : 'center';
    const sizeAllowed: Record<string, number> = {
      small: 1,
      medium: 1,
      large: 1,
      'x-large': 1,
      'xx-large': 1
    };
    const size = sizeAllowed[launcher.clockSize] ? launcher.clockSize : 'large';

    document.body.classList.remove(
      'clock-left',
      'clock-center',
      'clock-center-middle',
      'clock-right'
    );
    // CSS class: center-middle → clock-center-middle; others → clock-{align}
    document.body.classList.add('clock-' + align);

    document.body.classList.remove(
      'clock-size-small',
      'clock-size-medium',
      'clock-size-large',
      'clock-size-x-large',
      'clock-size-xx-large'
    );
    document.body.classList.add('clock-size-' + size);

    const shadowAllowed: Record<string, number> = {off: 1, soft: 1, strong: 1};
    const shadow = shadowAllowed[launcher.clockShadow] ? launcher.clockShadow : 'strong';

    document.body.classList.remove(
      'clock-shadow-off',
      'clock-shadow-soft',
      'clock-shadow-strong'
    );
    document.body.classList.add('clock-shadow-' + shadow);
  }

  function updateClock() {
    const config = getConfig();
    const launcher = config.launcher || ({} as LauncherConfig);
    const now = new Date();

    applyClockStyle();

    if (launcher.showClock && elements.clock) {
      setClockTime(elements.clock, now, launcher.timezone || '', launcher.clockFormat === '12');
    } else if (elements.clock) {
      elements.clock.textContent = '';
    }

    if (elements.clockDate) {
      if (launcher.showDate) {
        elements.clockDate.textContent = formatClockDate(now, launcher.timezone || '');
      } else {
        elements.clockDate.textContent = '';
      }
    }
  }

  function updateMusicBarClearance() {
    const bar = elements.musicBar;
    const grid = elements.appGrid;
    if (!bar || !grid) return;
    const b = bar.getBoundingClientRect();
    // The row's visible area: in the one-row layout, tiles scrolled out of view
    // still have positions. Counting them lifted the row at one end of the
    // scroll and dropped it at the other.
    const g = grid.getBoundingClientRect();
    let overlaps = false;
    if (b.width > 0 && b.height > 0) {
      const tiles = grid.querySelectorAll('.app-tile');
      let lowest = -Infinity;
      for (let i = 0; i < tiles.length; i += 1) {
        lowest = Math.max(lowest, tiles[i].getBoundingClientRect().top);
      }
      for (let i = 0; i < tiles.length && !overlaps; i += 1) {
        const r = tiles[i].getBoundingClientRect();
        if (lowest - r.top > 24 || r.width === 0) continue;
        const left = Math.max(r.left, g.left);
        const right = Math.min(r.right, g.right);
        if (right <= left) continue;
        overlaps = left < b.right && right > b.left;
      }
    }
    document.body.classList.toggle('music-bar-clear', overlaps);
  }

  function updateAppScrollHints() {
    updateMusicBarClearance();
    const grid = elements.appGrid;
    const shell = elements.appGridShell;
    const launcher = elements.launcher;
    if (!grid || !shell) return;

    const scrollMode = launcher && launcher.classList.contains('layout-scroll');
    if (!scrollMode) {
      shell.classList.remove('can-scroll-left', 'can-scroll-right');
      return;
    }

    // scrollWidth can lag a frame after tile rebuild; remeasure if needed.
    // Arrows only when at least a third of a tile is out of view: a few
    // pixels of overflow (rounding, borders) is nothing worth scrolling to.
    const tile = grid.querySelector('.app-tile') as HTMLElement | null;
    const minWorth = Math.max(8, tile ? tile.offsetWidth / 3 : 48);
    const maxScroll = grid.scrollWidth - grid.clientWidth;
    const hasOverflow = maxScroll > minWorth;
    const atLeft = grid.scrollLeft <= 6;
    const atRight = grid.scrollLeft >= maxScroll - 6;

    shell.classList.toggle('can-scroll-left', hasOverflow && !atLeft);
    shell.classList.toggle('can-scroll-right', hasOverflow && !atRight);
  }

  /** Remeasure after layout/images settle (scrollWidth can lag one frame). */
  function scheduleAppScrollHints() {
    updateAppScrollHints();
    function later() {
      const timer = setTimeout(function () {
        hintTimers.delete(timer);
        if (!stopped) updateAppScrollHints();
      }, 80);
      hintTimers.add(timer);
    }
    if (typeof requestAnimationFrame === 'function') {
      hintFrame = requestAnimationFrame(function () {
        hintFrame = null;
        if (stopped) return;
        updateAppScrollHints();
        later();
      });
    } else {
      later();
    }
  }

  // Icon row layout: 'scroll' keeps a single horizontal row capped to N icons
  // (the rest reachable by scrolling left/right), 'wrap' lets icons stack onto
  // multiple rows. Scroll is the default.
  function layoutChanged() {
    const grid = elements.appGrid;
    const shell = elements.appGridShell;
    const launcher = elements.launcher;
    if (!grid || !launcher) return;
    const config = getConfig();
    const layout = (config.launcher && config.launcher.iconLayout) || 'scroll';
    launcher.classList.toggle('layout-scroll', layout === 'scroll');
    launcher.classList.toggle('layout-wrap', layout !== 'scroll');
    if (layout === 'scroll') {
      const scaleBySize: Record<string, number> = {small: 0.78, medium: 1, large: 1.28};
      const iconSize = (config.launcher && config.launcher.iconSize) || 'medium';
      const scale = scaleBySize[iconSize] || 1;
      let perRow = parseInt(String(config.launcher && config.launcher.iconsPerRow), 10) || 7;
      perRow = Math.min(Math.max(perRow, 3), 12);
      const tileFootprint = (152 * scale) + 28; // tile width + 14px*2 margins
      // Plus the grid's own side padding (8px each side in scroll layout).
      // Without it, exactly perRow tiles overflowed by 16px: the arrows showed
      // and the row scrolled a few pixels for nothing.
      const gridSidePadding = 16;
      const maxW = Math.round(perRow * tileFootprint + gridSidePadding) + 'px';
      // Cap the shell (edges sit on the shell); grid fills the shell width.
      if (shell) {
        shell.style.maxWidth = maxW;
        shell.style.setProperty('--tile-scale', String(scale));
      }
      grid.style.maxWidth = '';
    } else {
      if (shell) {
        shell.style.maxWidth = '';
        shell.style.setProperty('--tile-scale', '1');
      }
      grid.style.maxWidth = '';
    }
    scheduleAppScrollHints();
  }

  function applyIconAlign() {
    if (!elements.launcher) return;
    const config = getConfig();
    const align = (config.launcher && config.launcher.iconAlign) || 'center';
    elements.launcher.classList.remove('icons-left', 'icons-center', 'icons-right');
    const cls = align === 'left' ? 'icons-left' : align === 'right' ? 'icons-right' : 'icons-center';
    elements.launcher.classList.add(cls);
  }

  function applyGlassTint() {
    const launcher = getConfig().launcher || ({} as LauncherConfig);
    GLASS_TINTS.forEach(function (name) {
      document.body.classList.toggle('glass-' + name, name === launcher.glassTint);
    });
    GLASS_BORDERS.forEach(function (name) {
      document.body.classList.toggle('glass-border-' + name, name === launcher.glassBorder);
    });
    FOCUS_COLOURS.forEach(function (name) {
      document.body.classList.toggle('focus-' + name, name === launcher.focusColour);
    });
  }

  function applyTileStyle() {
    const launcher = getConfig().launcher || ({} as LauncherConfig);
    document.body.classList.toggle('tiles-plain', launcher.tileStyle === 'plain');
  }

  // Weaker TVs drop the glassmorphic blur and animated background; the layout
  // stays intact (see the `.perf-mode` rules in styles/main.css).
  function applyPerfMode() {
    const config = getConfig();
    const on = !!(config.launcher && config.launcher.perfMode);
    document.body.classList.toggle('perf-mode', on);
    options.onPerfMode(on);
  }

  function start() {
    stopped = false;
    updateClock();
    if (clockTimer === null) {
      clockTimer = setInterval(updateClock, 30000);
    }
    if (bound) return;
    bound = true;

    const grid = elements.appGrid;
    if (grid) {
      const onScroll = function () { updateAppScrollHints(); };
      grid.addEventListener('scroll', onScroll, {passive: true});
      removers.push(function () {
        grid.removeEventListener('scroll', onScroll);
      });
    }
    const onResize = function () { scheduleAppScrollHints(); };
    window.addEventListener('resize', onResize);
    removers.push(function () { window.removeEventListener('resize', onResize); });
  }

  function stop() {
    stopped = true;
    if (clockTimer !== null) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
    if (hintFrame !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(hintFrame);
    }
    hintFrame = null;
    hintTimers.forEach(function (timer) { clearTimeout(timer); });
    hintTimers.clear();
    removers.forEach(function (remove) { remove(); });
    removers.length = 0;
    bound = false;
  }

  function apply() {
    updateClock();
    applyIconAlign();
    applyPerfMode();
    applyGlassTint();
    applyTileStyle();
  }

  return {
    start: start,
    stop: stop,
    apply: apply,
    layoutChanged: layoutChanged
  };
}
