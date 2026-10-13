import type {RemoteKey} from '@lib/remote.js';
import {REMOTE_KEY, digitFromKey} from '@lib/remote.js';
import {
  createRow,
  neighbourRows,
  rowById,
  rowOf
} from './focus-row.js';
import type {Direction, RowId} from './focus-row.js';
import {
  isSettingsTextField,
  isEditingSettingsText,
  beginSettingsTextEdit,
  endSettingsTextEdit
} from '@settings/text-gate.js';
import {createSettingsNavigation} from '@settings/navigation.js';
import type {SettingsNavigation} from '@settings/navigation.js';

const ROW_TOLERANCE = 72;
const COL_TOLERANCE = 88;
const MIN_PRIMARY_DELTA = 18;
const POINTER_AXIS_THRESHOLD = 28;
const POINTER_AXIS_RATIO = 1.6;

/** Callbacks the host wires up to remote keys. All are optional. */
export interface FocusManagerHandlers {
  onNumber?: (digit: number) => void;
  onBack?: () => void;
  onRed?: () => void;
  onGreen?: () => void;
  onBlue?: () => void;
  onVolumeUp?: () => void;
  onVolumeDown?: () => void;
  onVolumeMute?: () => void;
  onChannelUp?: () => void;
  onChannelDown?: () => void;
  /** A held Select on a [data-long-press] tile: open its context menu. */
  onLongPress?: (el: Element) => void;
}

/** Handle returned by createFocusManager. */
export interface FocusManager {
  refresh(): void;
  focusHomeDock(): boolean;
  focusWithin(selector: string): void;
  focusElement(el: Element | null): boolean;
  destroy(): void;
}

/**
 * createFocusManager options. The Settings navigation is built by default from
 * this module's own painting primitives; tests inject a spy so delegation can be
 * asserted without a panel.
 */
export interface FocusManagerOptions {
  settingsNavigation?: SettingsNavigation;
}

// An element the focus manager manipulates. DOM nodes carry a few optional
// form-control properties; absent ones read as undefined, as before.
interface FocusEl extends HTMLElement {
  disabled: boolean;
  readOnly: boolean;
  type: string;
  value: string;
  step: string;
  min: string;
  max: string;
  options: HTMLOptionsCollection;
  selectedIndex: number;
  __step?: (dir: number) => void;
}

export function createFocusManager(
  root: HTMLElement,
  handlers: FocusManagerHandlers,
  options?: FocusManagerOptions
): FocusManager {
  let items: FocusEl[] = [];
  // The home screen control the remote was last on, and a selector to find
  // it again after its row is redrawn (see focusHomeDock).
  let homeFocus: {el: FocusEl; key: string} | null = null;
  // The last move on the home screen; the opposite key goes straight back
  // (see moveDirection).
  let lastMove: {from: FocusEl | null; to: FocusEl | null; key: number} | null = null;
  let pointerAxis: 'horizontal' | 'vertical' | null = null;
  let pointerAccumDx = 0;
  let pointerAccumDy = 0;
  let lastPointerX: number | null = null;
  let lastPointerY: number | null = null;
  // Last *physical* cursor position, never cleared by key navigation.
  let lastRealPointerX: number | null = null;
  let lastRealPointerY: number | null = null;
  // Where the cursor was when the remote last moved focus (key or wheel).
  // Until the cursor travels POINTER_REENGAGE_PX from there, it does not take
  // focus back. webOS fires pointermove when content scrolls under a still
  // cursor, and a hand-held Magic Remote is never perfectly still: a 1px
  // tremor used to snap focus to whatever row sat under the cursor
  // ("Settings randomly skips").
  let navAnchorX: number | null = null;
  let navAnchorY: number | null = null;
  const POINTER_REENGAGE_PX = 40;
  // Centres closer than this count as the same visual row (Left/Right).
  const SAME_ROW_PX = 24;
  // Long press on a marked tile ([data-long-press]): hold Select this long to
  // raise onLongPress; a tap still clicks. The router owns the gesture so no
  // module needs its own key listener (docs/agents/architecture.md).
  const LONG_PRESS_MS = 1500;
  let longPressEl: FocusEl | null = null;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  // Set when a hold fired: the Select release and its key repeats are then
  // swallowed, so opening the menu is not also a Select on its first item.
  let longPressFired = false;

  function cancelLongPress(): void {
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = null;
    longPressEl = null;
  }

  function startLongPress(el: FocusEl): void {
    cancelLongPress();
    longPressFired = false;
    longPressEl = el;
    longPressTimer = setTimeout(function () {
      longPressTimer = null;
      longPressEl = null;
      // Focus moved away (pointer, blur): the hold was abandoned.
      if (document.activeElement !== el) return;
      longPressFired = true;
      if (handlers && handlers.onLongPress) handlers.onLongPress(el);
    }, LONG_PRESS_MS);
  }

  // A tap clicks the tile (launch); a hold already raised the menu, so its
  // release does nothing.
  function onKeyUp(event: KeyboardEvent): void {
    if (!(event.key === 'Enter' || event.keyCode === REMOTE_KEY.ENTER)) return;
    if (longPressFired) {
      longPressFired = false;
      return;
    }
    const target = longPressEl;
    if (!target) return;
    cancelLongPress();
    if (document.activeElement === target) target.click();
  }

  // Settings navigation: the panel owns its tab bar, header actions, sequential
  // moves, photo picker and wheel. The router delegates to it while the panel is
  // the active surface, lending it focusItem/isFocusable/noteRemoteNav so focus
  // painting keeps one owner. Injected in tests to assert delegation.
  const settingsNav: SettingsNavigation = (options && options.settingsNavigation) ||
    createSettingsNavigation(root, {
      focusItem: focusItem,
      isFocusable: isFocusable,
      noteRemoteNav: noteRemoteNav
    });

  function noteRemoteNav() {
    navAnchorX = lastRealPointerX;
    navAnchorY = lastRealPointerY;
  }

  function collect(): void {
    // All apps covers the home screen: only its tiles are reachable.
    const overlay = root.querySelector<FocusEl>('.all-apps:not([hidden])');
    items = Array.from((overlay || root).querySelectorAll<FocusEl>('.focusable:not([disabled])'));
    items.sort(function (a, b) {
      return Number(a.dataset.focusIndex || 0) - Number(b.dataset.focusIndex || 0);
    });
  }

  function scrollableAncestor(el: HTMLElement, axis: 'x' | 'y'): HTMLElement | null {
    let node = el.parentElement;
    while (node && node !== document.body) {
      const style = window.getComputedStyle(node);
      if (axis === 'y') {
        const overflowY = style.overflowY;
        if ((overflowY === 'auto' || overflowY === 'scroll') &&
            node.scrollHeight > node.clientHeight + 1) {
          return node;
        }
      } else {
        const overflowX = style.overflowX;
        if ((overflowX === 'auto' || overflowX === 'scroll') &&
            node.scrollWidth > node.clientWidth + 1) {
          return node;
        }
      }
      node = node.parentElement;
    }
    return null;
  }

  // Older webOS Chromium builds ignore scrollIntoView({inline}), so the app
  // row never scrolls horizontally. Manually keep the focused tile inside the
  // scroll container's viewport by adjusting scrollLeft.
  function ensureHorizontallyVisible(el: FocusEl): void {
    const container = scrollableAncestor(el, 'x');
    if (!container) return;
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    const margin = 24;
    if (eRect.left < cRect.left + margin) {
      container.scrollLeft -= (cRect.left + margin) - eRect.left;
    } else if (eRect.right > cRect.right - margin) {
      container.scrollLeft += eRect.right - (cRect.right - margin);
    }
  }

  // Instant vertical keep-in-view (no smooth scroll). scrollIntoView on webOS
  // can lag a frame or two while the compositor repaints a large settings
  // panel; direct scrollTop writes redraw immediately. Walks every nested
  // overflow container (e.g. settings-apps inside settings-body).
  function ensureVerticallyVisible(el: FocusEl): void {
    let node: HTMLElement | null = el;
    // Settings keeps about a row of look-ahead, so the next row is already on
    // screen before Down reaches it and the list moves one row per press.
    const margin = rowOf(el) === 'settings' ? 72 : 28;
    while (node && node !== document.body) {
      const container = scrollableAncestor(node, 'y');
      if (!container) break;
      const cRect = container.getBoundingClientRect();
      const eRect = el.getBoundingClientRect();
      if (eRect.top < cRect.top + margin) {
        container.scrollTop -= (cRect.top + margin) - eRect.top;
      } else if (eRect.bottom > cRect.bottom - margin) {
        container.scrollTop += eRect.bottom - (cRect.bottom - margin);
      }
      node = container;
    }
  }

  function clearFocusChrome(except: FocusEl | null): void {
    root.querySelectorAll<FocusEl>('.focused').forEach(function (item) {
      if (item !== except) item.classList.remove('focused');
    });
    // Full settings rows (label + control) get a highlight while scrolling.
    // Never strip photo-picker is-selected — that marks the chosen wallpaper.
    root.querySelectorAll<FocusEl>('.settings-row-highlight').forEach(function (item) {
      if (item !== except && !(except && item.contains && item.contains(except))) {
        item.classList.remove('settings-row-highlight');
      }
    });
  }

  function highlightSettingsContext(el: FocusEl | null): void {
    root.querySelectorAll<FocusEl>('.settings-row-highlight').forEach(function (item) {
      item.classList.remove('settings-row-highlight');
    });
    if (!el || rowOf(el) !== 'settings') return;
    // Prefer the whole labeled row / track row so the eye tracks while scrolling.
    // Photo tiles: only the focused tile gets row-highlight; is-selected stays
    // on the chosen wallpaper separately.
    const row = el.closest && el.closest(
      '.settings-row, .settings-track-row, .settings-app-row, ' +
      '.settings-pinned-row, .settings-input-row, .photo-picker-tile'
    );
    if (row) row.classList.add('settings-row-highlight');
  }

  function focusItem(el: FocusEl | null): boolean {
    if (!el) return false;
    // webOS/Chromium silently ignores .focus() on elements that are not
    // actually focusable at that moment (visibility:hidden, detached, an
    // ancestor with visibility:hidden, tabindex removed, etc). When that
    // happens document.activeElement does NOT change, so spatial nav keeps
    // re-selecting the same unfocusable neighbour and left/right freezes.
    try {
      if (typeof el.tabIndex === 'number' && el.tabIndex < 0) el.tabIndex = 0;
    } catch (err) { /* ignore */ }
    const inSettings = rowOf(el) === 'settings';
    // Settings: a plain focus() makes Chromium scroll an off-screen row to the
    // middle of the panel, so one Down press jumped the list 7-8 rows.
    // ensureVerticallyVisible below scrolls just far enough instead.
    try {
      if (inSettings) el.focus({preventScroll: true});
      else el.focus();
    } catch (err2) { /* ignore */ }

    const landed = document.activeElement === el ||
      (el.contains && el.contains(document.activeElement));

    // Outside settings: require real focus. Inside settings: still paint the
    // highlight so wheel/D-pad scrolling always shows which row is active
    // (checkboxes/ranges sometimes refuse activeElement on webOS).
    if (!landed && !inSettings) return false;

    clearFocusChrome(el);
    el.classList.add('focused');
    if (!inSettings) rememberHomeFocus(el);
    highlightSettingsContext(el);
    ensureHorizontallyVisible(el);
    ensureVerticallyVisible(el);
    return true;
  }

  // A selector that finds `el` again after its row is redrawn.
  function homeKey(el: FocusEl): string {
    if (el.id) return '#' + el.id;
    const attrs = ['data-app-id', 'data-input-id', 'data-action', 'data-channel'];
    for (let i = 0; i < attrs.length; i += 1) {
      const value = el.getAttribute(attrs[i]);
      if (value) return '[' + attrs[i] + '="' + value.replace(/["\\]/g, '\\$&') + '"]';
    }
    return '';
  }

  function rememberHomeFocus(el: FocusEl): void {
    if (el.closest && el.closest('.ai-oauth-modal, .all-apps')) return;
    homeFocus = {el: el, key: homeKey(el)};
  }

  // The remembered home control, if it is still (or again) on screen.
  function rememberedHomeControl(): FocusEl | null {
    if (!homeFocus) return null;
    let el: FocusEl | null = homeFocus.el;
    if (!el || !document.contains(el)) {
      el = null;
      if (homeFocus.key) {
        try { el = root.querySelector<FocusEl>(homeFocus.key); } catch (err) { el = null; }
      }
    }
    return el && isFocusable(el) ? el : null;
  }

  // True when an element can actually take keyboard focus right now. Filters
  // out zero-size / hidden tiles that still report a layout rect (which fools
  // spatial navigation into repeatedly targeting them).
  function isFocusable(el: FocusEl | null): boolean {
    if (!el) return false;
    if (el.disabled) return false;
    if (el.tabIndex < 0) return false;
    if (typeof el.offsetParent !== 'undefined' && el.offsetParent === null) {
      // display:none (offsetParent null) — but position:fixed also reports
      // null, so double-check via getClientRects for those.
      if (!el.getClientRects || el.getClientRects().length === 0) return false;
    }
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    return true;
  }

  function resetPointerAxis() {
    pointerAxis = null;
    pointerAccumDx = 0;
    pointerAccumDy = 0;
    lastPointerX = null;
    lastPointerY = null;
  }

  function updatePointerAxis(dx: number, dy: number): void {
    pointerAccumDx += dx;
    pointerAccumDy += dy;

    const total = Math.abs(pointerAccumDx) + Math.abs(pointerAccumDy);
    if (total < POINTER_AXIS_THRESHOLD) return;

    if (Math.abs(pointerAccumDx) > Math.abs(pointerAccumDy) * POINTER_AXIS_RATIO) {
      pointerAxis = 'horizontal';
    } else if (Math.abs(pointerAccumDy) > Math.abs(pointerAccumDx) * POINTER_AXIS_RATIO) {
      pointerAxis = 'vertical';
    } else {
      pointerAxis = null;
    }

    pointerAccumDx = 0;
    pointerAccumDy = 0;
  }

  function shouldIgnorePointerTarget(target: FocusEl | null): boolean {
    const active = document.activeElement as FocusEl | null;
    if (!active || !target || active === target) return false;
    if (!active.classList.contains('focusable')) return false;
    if (pointerAxis !== 'horizontal') return false;
    return rowOf(active) !== rowOf(target);
  }

  function onPointerMove(event: MouseEvent): void {
    if (event.clientX == null || event.clientY == null) return;

    // After the remote moved focus, ignore phantom (content scrolled under a
    // still cursor) and tremor pointermoves; a deliberate cursor move hands
    // focus back to the pointer. See noteRemoteNav().
    if (navAnchorX != null &&
        Math.abs(event.clientX - navAnchorX) + Math.abs(event.clientY - navAnchorY!) <
          POINTER_REENGAGE_PX) {
      return;
    }
    navAnchorX = null;
    navAnchorY = null;
    lastRealPointerX = event.clientX;
    lastRealPointerY = event.clientY;

    if (lastPointerX != null) {
      updatePointerAxis(event.clientX - lastPointerX, event.clientY - lastPointerY!);
    }
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;

    const target = event.target instanceof Element
      ? event.target.closest('.focusable:not([disabled])') as FocusEl | null
      : null;
    if (!target) return;
    if (target.dataset && target.dataset.pointerFocus === 'off') return;
    const oauthModal = document.querySelector('.ai-oauth-modal:not([hidden])');
    if (oauthModal && !(oauthModal.contains && oauthModal.contains(target))) return;
    if (shouldIgnorePointerTarget(target)) return;
    // Settings: don't let the cursor steal focus onto the other tab (Home)
    // while the user is in AI Voice content — that flipped the pane back.
    if (document.body.classList.contains('settings-open') &&
        target.classList && target.classList.contains('settings-tab') &&
        !target.classList.contains('active')) {
      const active = document.activeElement as FocusEl | null;
      const onTabBar = !!(active && active.classList &&
        active.classList.contains('settings-tab'));
      if (!onTabBar) return;
    }
    const inactivePane = target.closest && target.closest('.settings-tab-pane:not(.is-active)');
    if (inactivePane) return;
    focusItem(target);
  }

  // Move to the previous/next focusable in the same row by index order.
  // Spatial navigation fails when tiles overlap or share an x-position (e.g. a
  // wrapped/stacked dock), so horizontal dock movement falls back to this.
  // Returns false when there is no same-row neighbour (row edge) so the caller
  // can continue across rows via moveByGlobalIndex.
  function moveByIndexInRow(active: FocusEl, delta: number): boolean {
    const def = rowById(rowOf(active));
    if (!def) return false;
    const scoped = items.filter(function (item: FocusEl) {
      return rowOf(item) === def.id;
    });
    // Walk outward skipping any neighbour that refuses focus, so a single
    // hidden/unfocusable tile can't wedge left/right navigation. False at the
    // row edge (or no focusable neighbour) so the caller crosses rows.
    const row = createRow(function () { return scoped; });
    const next = row.moveWithin(active, delta, isFocusable);
    return !!(next && focusItem(next));
  }

  // Final horizontal fallback: walk every focusable (except the settings
  // overlay) in focus-index order. This guarantees left/right always advances
  // through the launcher -- app grid, inputs, top-bar and music controls -- so
  // focus can never dead-end at a row boundary (the "can't scroll after
  // launching an app" freeze).
  function moveByGlobalIndex(active: FocusEl, delta: number): boolean {
    const scoped = items.filter(function (item: FocusEl) {
      return rowOf(item) !== 'settings';
    });
    const idx = scoped.indexOf(active);
    if (idx < 0) return false;
    for (let i = idx + delta; i >= 0 && i < scoped.length; i += delta) {
      const next = scoped[i];
      if (!isFocusable(next)) continue;
      if (focusItem(next)) return true;
    }
    return false; // true first/last focusable item
  }

  function isTopChrome(el: FocusEl | null): boolean {
    return !!(el && el.closest && el.closest('.top-bar'));
  }

  // Nearest focusable control in `container` to horizontal centre `cx`.
  // With `topRowOnly`, only the container's top row counts (the app grid
  // can wrap onto several rows).
  function focusNearestIn(container: FocusEl | null, cx: number, topRowOnly = false): boolean {
    if (!container || container.hidden) return false;
    let items: FocusEl[] = Array.prototype.filter.call(
      container.querySelectorAll<FocusEl>('.focusable'),
      isFocusable
    );
    if (topRowOnly && items.length) {
      const top = Math.min.apply(null, items.map(function (el) {
        return el.getBoundingClientRect().top;
      }));
      items = items.filter(function (el) {
        return el.getBoundingClientRect().top - top <= SAME_ROW_PX;
      });
    }
    let best = null;
    let bestDx = Infinity;
    items.forEach(function (el) {
      const r = el.getBoundingClientRect();
      const dx = Math.abs(r.left + r.width / 2 - cx);
      if (dx < bestDx) {
        bestDx = dx;
        best = el;
      }
    });
    return !!(best && focusItem(best));
  }

  // Wrapped app rows: focus the tile nearest `cx` in the row next to
  // `el`'s (dir 1 below, -1 above). False when there is no such row.
  function focusAdjacentTileRow(el: FocusEl, dir: number, cx: number): boolean {
    const grid = root.querySelector<FocusEl>('#app-grid');
    if (!grid || !el || !grid.contains(el)) return false;
    const top = el.getBoundingClientRect().top;
    const tiles: FocusEl[] = Array.prototype.filter.call(
      grid.querySelectorAll<FocusEl>('.focusable'),
      isFocusable
    );
    let rowTop: number | null = null;
    tiles.forEach(function (t) {
      const tTop = t.getBoundingClientRect().top;
      if ((tTop - top) * dir <= SAME_ROW_PX) return; // same row, or the wrong way
      if (rowTop === null || (tTop - rowTop) * dir < 0) rowTop = tTop;
    });
    if (rowTop === null) return false;
    let best = null;
    let bestDx = Infinity;
    tiles.forEach(function (t) {
      const r = t.getBoundingClientRect();
      if (Math.abs(r.top - rowTop!) > SAME_ROW_PX) return;
      const dx = Math.abs(r.left + r.width / 2 - cx);
      if (dx < bestDx) {
        bestDx = dx;
        best = t;
      }
    });
    return !!(best && focusItem(best));
  }

  // Land on the nearest control of a named neighbour row (focus-row.ts).
  function focusRowNeighbour(id: RowId, cx: number): boolean {
    const def = rowById(id);
    if (!def || !def.containerSelector) return false;
    const container = root.querySelector<FocusEl>(def.containerSelector);
    return focusNearestIn(container, cx, def.entry === 'top-row');
  }

  function focusSettingsButton(): boolean {
    const gear = root.querySelector<FocusEl>('#app-settings-btn');
    if (!gear || !isFocusable(gear)) return false;
    return focusItem(gear);
  }

  // First focusable in the main dock (inputs → apps → music).
  function focusMainDockFirst(): boolean {
    const selectors = [
      '#input-row .focusable',
      '#app-grid .focusable',
      '#music-bar .focusable'
    ];
    for (let s = 0; s < selectors.length; s += 1) {
      const list = root.querySelectorAll<FocusEl>(selectors[s]);
      for (let i = 0; i < list.length; i += 1) {
        if (isFocusable(list[i]) && focusItem(list[i])) return true;
      }
    }
    return false;
  }

  function moveDirection(keyCode: number): void {
    collect();
    if (!items.length) return;

    resetPointerAxis();

    const active = document.activeElement as FocusEl | null;
    const fromIdx = active ? items.indexOf(active) : -1;
    const settingsOpen = document.body.classList.contains('settings-open');
    const isHorizontal = keyCode === REMOTE_KEY.LEFT || keyCode === REMOTE_KEY.RIGHT;
    const isVertical = keyCode === REMOTE_KEY.UP || keyCode === REMOTE_KEY.DOWN;

    // Focus lost / not on a known tile: stay inside Settings when the panel is open.
    if (!active || fromIdx < 0) {
      const up = isVertical && keyCode === REMOTE_KEY.UP;
      if (settingsOpen && settingsNav.recover(up)) return;
      focusItem(items[0]);
      return;
    }

    // Settings owns its own navigation: the module consumes every direction key
    // while one of its controls has focus (tab bar, header, panes, photo picker).
    if (rowOf(active) === 'settings') {
      settingsNav.move(keyCode);
      return;
    }

    // The opposite of the last move goes back where it came from: Up from
    // HDMI 1 reaches the Settings gear, and Down returns to HDMI 1 rather
    // than to the input nearest the gear (always the last one).
    const OPPOSITE: Record<number, RemoteKey> = {};
    OPPOSITE[REMOTE_KEY.UP] = REMOTE_KEY.DOWN;
    OPPOSITE[REMOTE_KEY.DOWN] = REMOTE_KEY.UP;
    OPPOSITE[REMOTE_KEY.LEFT] = REMOTE_KEY.RIGHT;
    OPPOSITE[REMOTE_KEY.RIGHT] = REMOTE_KEY.LEFT;
    if (lastMove && lastMove.to === active && lastMove.key === OPPOSITE[keyCode] &&
        lastMove.from !== active && document.contains(lastMove.from) &&
        isFocusable(lastMove.from) && focusItem(lastMove.from)) {
      lastMove = {from: active, to: lastMove.from, key: keyCode};
      return;
    }

    const rect = active.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // Between the home rows (channel strip when open, inputs, app tiles):
    // Up/Down hand off to the neighbour row nearest this column. The rows'
    // items rarely line up (chip and tile widths differ, names vary), so the
    // column-limited search below often found nothing: Down from HDMI 1 did
    // nothing on a TV with wider tile spacing, and Up would rather reach the
    // Settings gear than the strip. The row-to-row edges live in focus-row.ts.
    if (isVertical) {
      const row = rowOf(active);
      const dir: Direction = keyCode === REMOTE_KEY.DOWN ? 'down' : 'up';
      // Wrapped app rows: a shorter row is centred under the one above, so
      // its tiles sit half a tile to the side, outside the column search.
      // Move within the grid first; only a grid edge hands off to a row.
      if (row === 'apps' &&
          focusAdjacentTileRow(active, dir === 'down' ? 1 : -1, cx)) {
        return;
      }
      const neighbours = neighbourRows(row, dir);
      for (let n = 0; n < neighbours.length; n += 1) {
        if (focusRowNeighbour(neighbours[n], cx)) return;
      }
    }

    let best = null;
    let bestScore = Infinity;

    items.forEach(function (item) {
      if (item === active) return;
      if (!isFocusable(item)) return; // skip hidden/zero-size tiles that still report a rect
      // Don't spatial-nav into the settings overlay panel from the home dock.
      if (rowOf(item) === 'settings') return;

      const r = item.getBoundingClientRect();
      const ix = r.left + r.width / 2;
      const iy = r.top + r.height / 2;
      const dx = ix - cx;
      const dy = iy - cy;

      if (keyCode === REMOTE_KEY.LEFT && dx >= -10) return;
      if (keyCode === REMOTE_KEY.RIGHT && dx <= 10) return;
      if (keyCode === REMOTE_KEY.UP && dy >= -10) return;
      if (keyCode === REMOTE_KEY.DOWN && dy <= 10) return;

      if (isHorizontal) {
        if (Math.abs(dy) > ROW_TOLERANCE) return;
        if (Math.abs(dx) < MIN_PRIMARY_DELTA) return;
      }

      if (isVertical) {
        // Gear sits top-right; allow a much wider column when aiming at top chrome
        // so UP from any dock tile can still see the settings button.
        const colLimit = isTopChrome(item) || isTopChrome(active)
          ? Math.max(COL_TOLERANCE, 900)
          : COL_TOLERANCE;
        if (Math.abs(dx) > colLimit) return;
        if (Math.abs(dy) < MIN_PRIMARY_DELTA) return;
      }

      const primary = isHorizontal ? Math.abs(dx) : Math.abs(dy);
      const secondary = isHorizontal ? Math.abs(dy) : Math.abs(dx);
      // Prefer top-chrome when moving up so we hit Settings over a distant input.
      const chromeBias = (keyCode === REMOTE_KEY.UP && isTopChrome(item)) ? -5000 : 0;
      const score = primary * 100 + secondary + chromeBias;

      if (score < bestScore) {
        bestScore = score;
        best = item;
      }
    });

    if (best && focusItem(best)) return;

    // Spatial search found nothing. Horizontal: index-order through the dock.
    if (isHorizontal) {
      const row = rowOf(active);
      if (row !== 'settings') {
        const delta = keyCode === REMOTE_KEY.RIGHT ? 1 : -1;
        if (moveByIndexInRow(active, delta)) return;
        moveByGlobalIndex(active, delta);
      }
      return;
    }

    // Vertical edges: UP always reaches Settings; DOWN from Settings returns
    // to the dock (inputs / apps). This is the main 10-foot path to the gear.
    if (keyCode === REMOTE_KEY.UP) {
      if (rowOf(active) !== 'settings' && !isTopChrome(active)) {
        if (focusSettingsButton()) return;
      }
    }
    if (keyCode === REMOTE_KEY.DOWN) {
      if (isTopChrome(active)) {
        if (focusMainDockFirst()) return;
      }
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    let code = event.keyCode;
    resetPointerAxis();
    // Any remote key can move/scroll focus: pin the pointer guard to where the
    // cursor is now so scroll-induced or tremor pointermoves can't snap focus
    // back (see onPointerMove).
    noteRemoteNav();

    // Physical USB/Bluetooth keyboards can report different keyCodes than the
    // TV remote; normalize via event.key so keyboard navigation works too.
    if (event.key) {
      const active = document.activeElement;
      // Only treat as "typing" when a settings text field is unlocked for edit
      // (Select pressed). Readonly text fields still use D-pad for navigation.
      const typing = isEditingSettingsText(active);
      const keyMap: Record<string, RemoteKey> = {
        ArrowLeft: REMOTE_KEY.LEFT,
        ArrowUp: REMOTE_KEY.UP,
        ArrowRight: REMOTE_KEY.RIGHT,
        ArrowDown: REMOTE_KEY.DOWN,
        Enter: REMOTE_KEY.ENTER,
        Escape: REMOTE_KEY.BACK,
        GoBack: REMOTE_KEY.BACK,
        ChannelUp: REMOTE_KEY.CHANNEL_UP,
        ChannelDown: REMOTE_KEY.CHANNEL_DOWN
      };
      if (!typing) {
        keyMap.Backspace = REMOTE_KEY.BACK;
      }
      if (keyMap[event.key] !== undefined) {
        code = keyMap[event.key];
      }
    }

    // Any other key ends a pending hold; the Select that started it must not
    // cancel itself, since a held key can repeat keydown.
    if (code !== REMOTE_KEY.ENTER) {
      cancelLongPress();
      longPressFired = false;
    }

    // Number keys launch the home row tile at that position (1 = first).
    // While the virtual keyboard is up, or Settings / All apps is open, the
    // numbers belong to what is on screen, not the home row.
    const digit = digitFromKey(code, event.key);
    if (digit >= 0) {
      const active = document.activeElement;
      if (isEditingSettingsText(active)) return;
      if (document.body.classList.contains('settings-open')) return;
      if (root.querySelector('.all-apps:not([hidden])')) return;
      if (digit > 0 && handlers && handlers.onNumber) {
        event.preventDefault();
        handlers.onNumber(digit);
      }
      return;
    }

    if (code === REMOTE_KEY.BACK) {
      const active = document.activeElement as FocusEl | null;
      // Exit text edit (close virtual keyboard) before leaving settings.
      if (active && isEditingSettingsText(active)) {
        event.preventDefault();
        endSettingsTextEdit(active);
        try { active.blur(); } catch (err) { /* ignore */ }
        // Re-focus readonly so D-pad continues from this field.
        try {
          active.readOnly = true;
          active.focus({preventScroll: true});
        } catch (err) { /* ignore */ }
        return;
      }
      if (handlers && handlers.onBack) {
        event.preventDefault();
        handlers.onBack();
      }
      return;
    }

    if (code === REMOTE_KEY.RED) {
      if (handlers && handlers.onRed) {
        event.preventDefault();
        handlers.onRed();
      }
      return;
    }

    if (code === REMOTE_KEY.GREEN) {
      if (handlers && handlers.onGreen) {
        event.preventDefault();
        handlers.onGreen();
      }
      return;
    }

    if (code === REMOTE_KEY.BLUE) {
      if (handlers && handlers.onBlue) {
        event.preventDefault();
        handlers.onBlue();
      }
      return;
    }

    if (code === REMOTE_KEY.VOLUME_UP) {
      if (handlers && handlers.onVolumeUp) {
        event.preventDefault();
        handlers.onVolumeUp();
      }
      return;
    }

    if (code === REMOTE_KEY.VOLUME_DOWN) {
      if (handlers && handlers.onVolumeDown) {
        event.preventDefault();
        handlers.onVolumeDown();
      }
      return;
    }

    if (code === REMOTE_KEY.VOLUME_MUTE) {
      if (handlers && handlers.onVolumeMute) {
        event.preventDefault();
        handlers.onVolumeMute();
      }
      return;
    }

    if (code === REMOTE_KEY.CHANNEL_UP) {
      if (handlers && handlers.onChannelUp) {
        event.preventDefault();
        handlers.onChannelUp();
      }
      return;
    }

    if (code === REMOTE_KEY.CHANNEL_DOWN) {
      if (handlers && handlers.onChannelDown) {
        event.preventDefault();
        handlers.onChannelDown();
      }
      return;
    }

    if (code === REMOTE_KEY.LEFT || code === REMOTE_KEY.RIGHT
      || code === REMOTE_KEY.UP || code === REMOTE_KEY.DOWN) {
      // While the virtual keyboard is up, don't steal arrow keys for spatial nav.
      if (isEditingSettingsText(document.activeElement)) {
        return;
      }
      event.preventDefault();
      const from = document.activeElement as FocusEl | null;
      moveDirection(code);
      // Remember home screen moves, so the opposite key can go straight back.
      const to = document.activeElement as FocusEl | null;
      lastMove = to !== from && rowOf(to) !== 'settings' ? {from: from, to: to, key: code} : null;
      return;
    }
    if (code === REMOTE_KEY.ENTER) {
      const active = document.activeElement as FocusEl | null;
      // The release that ended a hold is not a Select; neither are the key's
      // own repeats while it is still down.
      if (longPressFired) {
        event.preventDefault();
        return;
      }
      // Text fields: Select unlocks edit mode and opens the virtual keyboard.
      // Merely focusing via D-pad keeps them readonly so the keyboard stays down.
      if (active && isSettingsTextField(active) && active.readOnly) {
        event.preventDefault();
        beginSettingsTextEdit(active);
        return;
      }
      if (active && isEditingSettingsText(active)) {
        // Second Select finishes editing (dismiss keyboard / lock field).
        event.preventDefault();
        endSettingsTextEdit(active);
        try { active.blur(); } catch (err) { /* ignore */ }
        try {
          active.readOnly = true;
          active.focus({preventScroll: true});
        } catch (err) { /* ignore */ }
        return;
      }
      // Photo gallery: Select chooses the photo and moves on so you can keep
      // scrolling Settings (instead of trapping focus in the thumbnail grid).
      if (active && active.classList && active.classList.contains('photo-picker-tile')) {
        event.preventDefault();
        if (typeof event.stopPropagation === 'function') event.stopPropagation();
        settingsNav.activate(active);
        return;
      }
      // A marked tile: hold Select for its context menu, tap to open it.
      if (active && active.dataset && active.dataset.longPress !== undefined &&
          handlers && handlers.onLongPress) {
        event.preventDefault();
        if (longPressEl !== active) startLongPress(active);
        return;
      }
      if (active && active.classList.contains('focusable')) {
        event.preventDefault();
        active.click();
      }
    }
  }

  // The wheel only does something inside Settings; the panel's navigation
  // module owns the accumulation, the rate-limit and the value stepping.
  function onWheel(event: WheelEvent): void {
    if (!document.body.classList.contains('settings-open')) return;
    settingsNav.wheel(event);
  }

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  // Capture phase so we see the wheel even if a child stops bubbling.
  document.addEventListener('wheel', onWheel, {passive: false, capture: true});
  root.addEventListener('mousemove', onPointerMove);

  return {
    refresh: function () {
      collect();
      // Prefer a live, on-screen focusable. Focusing a hidden settings control
      // (still .focusable in the DOM) fails silently and leaves the dock dead.
      for (let i = 0; i < items.length; i += 1) {
        if (!isFocusable(items[i])) continue;
        // Prefer app tiles / inputs over top-bar chrome when reclaiming.
        if (focusItem(items[i])) return;
      }
    },
    /**
     * After a return to Ember: back on the control the remote was on
     * (the tile an app was opened from, or wherever the user has moved
     * since), else the first app tile. A return calls this several times over
     * 1.6 s; always taking the first tile pulled focus out from under the
     * user and scrolled the row back to its start.
     */
    focusHomeDock: function () {
      collect();
      const remembered = rememberedHomeControl();
      if (remembered && focusItem(remembered)) return true;
      const tiles = items.filter(function (item) {
        return isFocusable(item) && item.classList && item.classList.contains('app-tile');
      });
      if (tiles.length && focusItem(tiles[0])) return true;
      for (let i = 0; i < items.length; i += 1) {
        if (isFocusable(items[i]) && focusItem(items[i])) return true;
      }
      return false;
    },
    focusWithin: function (selector: string): void {
      collect();
      const scoped = items.filter(function (item: FocusEl) {
        return item.closest && item.closest(selector) && isFocusable(item);
      });
      // Settings: always land on the active category first (not Save).
      if (selector === '#settings-panel' || (selector && String(selector).indexOf('settings') >= 0)) {
        const homeTab = scoped.filter(function (item) {
          return item.classList && item.classList.contains('settings-tab') &&
            (item.classList.contains('active') ||
              (item.textContent || '').trim().toLowerCase() === 'home');
        })[0] || scoped.filter(function (item) {
          return item.classList && item.classList.contains('settings-tab');
        })[0];
        if (homeTab && focusItem(homeTab)) return;
      }
      if (scoped.length) focusItem(scoped[0]);
    },
    /** Re-focus a specific control (e.g. the Settings row the user was on). */
    focusElement: function (el: Element | null): boolean {
      collect();
      const target = el as FocusEl | null;
      return isFocusable(target) && focusItem(target);
    },
    destroy: function () {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('wheel', onWheel, {capture: true});
      root.removeEventListener('mousemove', onPointerMove);
    }
  };
}