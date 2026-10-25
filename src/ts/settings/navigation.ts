/**
 * Settings navigation.
 *
 * The focus router (`focus/focus.ts`) is a generic row/key router and focus
 * painter for the home surface. When the Settings panel is the active surface,
 * the router delegates direction keys, the wheel and photo-tile Select here, so
 * panel behaviour is owned by the panel and adding a Settings control does not
 * add a branch to the router.
 *
 * The module reads the panel out of `root` (the app mount) and paints focus
 * through the small host the router lends it: `focusItem`, `isFocusable` and
 * `noteRemoteNav`. It never imports the Settings composition root, so importing
 * the router no longer pulls in the panel and its ten panes.
 *
 * Navigation keys off DOM order, not `data-focus-index`: those numbers collide
 * and drift across panes (the 1300+n "Add an app" rows run into the 1400 Custom
 * app fields), so this module walks controls in the order they are drawn.
 */

import {REMOTE_KEY} from '@lib/remote.js';
import {createRow} from '@focus/focus-row.js';
import {isEditingSettingsText} from './text-gate.js';

// Centres closer than this count as the same visual row (Left/Right).
const SAME_ROW_PX = 24;

// How long after the last wheel notch the pane counts as settled, before focus
// is moved back to a visible row. Chromium animates wheel scrolling, so this is
// slightly longer than one animation frame's worth of travel.
const WHEEL_SETTLE_MS = 150;

// The keep-in-view margin focusItem uses for Settings rows. A re-anchor target
// inside it will not make the router scroll the pane again.
const KEEP_IN_VIEW_PX = 72;

// An element the navigation manipulates. DOM nodes carry a few optional
// form-control properties; absent ones read as undefined.
interface NavEl extends HTMLElement {
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

/**
 * The painting primitives the router lends the Settings navigation. Keeping
 * focus painting in the router means the panel highlight, the row highlight and
 * the keep-in-view scrolling have a single owner.
 */
export interface SettingsNavigationHost {
  /** Focus an element with the router's chrome, highlight and scrolling. */
  focusItem(el: HTMLElement | null): boolean;
  /** Whether an element can actually take focus right now. */
  isFocusable(el: HTMLElement | null): boolean;
  /** Pin the pointer/tremor guard after a programmatic move. */
  noteRemoteNav(): void;
}

/** The handle the router calls when Settings is the active surface. */
export interface SettingsNavigation {
  /** Focus the nearest on-screen control when focus was lost in the panel. */
  recover(up: boolean): boolean;
  /** Handle a direction key while a panel control has focus. */
  move(keyCode: number): boolean;
  /** Handle the wheel inside Settings: scroll the pane, keep focus visible. */
  wheel(event: WheelEvent): void;
  /** Handle Select on the focused control (the photo picker). */
  activate(active: HTMLElement | null): boolean;
}

export function createSettingsNavigation(
  root: HTMLElement,
  host: SettingsNavigationHost
): SettingsNavigation {
  function panelEl(): HTMLElement | null {
    return root.querySelector<HTMLElement>('#settings-panel');
  }

  function isFocusable(el: NavEl | null): boolean {
    return host.isFocusable(el);
  }

  function focusItem(el: NavEl | null): boolean {
    return host.focusItem(el);
  }

  /**
   * Settings controls in on-screen (DOM) order, before the visibility check.
   * Settings never sorts by focusIndex: those numbers collide and drift, which
   * made Up/Down skip rows and come back to them later.
   */
  function settingsCandidates(): NavEl[] {
    const panel = panelEl();
    if (!panel) return [];
    const list = panel.querySelectorAll<NavEl>('.focusable:not([disabled])');
    return Array.prototype.filter.call(list, function (item: NavEl) {
      // Never step into controls inside an inactive tab pane.
      const pane = item.closest && item.closest('.settings-tab-pane');
      if (pane && !pane.classList.contains('is-active')) return false;
      // Wheel / up-down must not land on the other tab (that used to flip the
      // visible category back to Home). Left/Right on the tab bar uses
      // settingsTabButtons.
      if (item.classList && item.classList.contains('settings-tab') &&
          !item.classList.contains('active')) {
        return false;
      }
      return true;
    });
  }

  function settingsFocusables(): NavEl[] {
    return settingsCandidates().filter(isFocusable);
  }

  /** Focus the first live control walking from index `from` by `delta`. */
  function focusFirstLive(list: NavEl[], from: number, delta: number): boolean {
    for (let i = from; i >= 0 && i < list.length; i += delta) {
      if (isFocusable(list[i]) && focusItem(list[i])) return true;
    }
    return false;
  }

  function settingsTabButtons(): NavEl[] {
    const panel = panelEl();
    if (!panel) return [];
    const list = panel.querySelectorAll<NavEl>('.settings-tab.focusable:not([disabled])');
    return Array.prototype.filter.call(list, isFocusable);
  }

  /** The tab the panel is on (its `active` class), else the first tab. */
  function activeTabButton(): NavEl | null {
    const tabs = settingsTabButtons();
    return tabs.filter(function (t) {
      return t.classList.contains('active');
    })[0] || tabs[0] || null;
  }

  function activeSettingsPane(): NavEl | null {
    const panel = panelEl();
    if (!panel) return null;
    return panel.querySelector<NavEl>('.settings-tab-pane.is-active') ||
      panel.querySelector<NavEl>('.settings-tab-pane');
  }

  /**
   * First control inside the visible tab body (Profile, Source, API key, …),
   * not the tab bar / Save / Close. It used to prefer the wallpaper gallery,
   * which skipped Profile / Source / Display on the way down.
   */
  function firstPaneLandTarget(pane: NavEl | null): NavEl | null {
    if (!pane) return null;
    const list = pane.querySelectorAll<NavEl>('.focusable');
    for (let j = 0; j < list.length; j += 1) {
      if (isFocusable(list[j])) return list[j];
    }
    return null;
  }

  function activateSettingsTabButton(tabBtn: NavEl | null): boolean {
    if (!tabBtn) return false;
    // Tell Settings to flip the pane. Do not rely on focus() — Magic Remote
    // pointer / wheel used to focus Home and yank the pane back.
    try {
      tabBtn.dispatchEvent(new CustomEvent('settings-activate-tab', {bubbles: true}));
    } catch (err) { /* ignore */ }
    return focusItem(tabBtn);
  }

  function settingsHeaderActions(): NavEl[] {
    // Save + Close live in the header; prefer left-to-right order.
    const panel = panelEl();
    if (!panel) return [];
    const list: NavEl[] = [];
    const save = panel.querySelector<NavEl>('.settings-save.focusable');
    const close = panel.querySelector<NavEl>('.settings-close.focusable');
    if (save && isFocusable(save)) list.push(save);
    if (close && isFocusable(close)) list.push(close);
    return list;
  }

  function isSettingsHeaderAction(el: NavEl | null): boolean {
    if (!el || !el.classList) return false;
    return el.classList.contains('settings-save') || el.classList.contains('settings-close');
  }

  /**
   * Category list (left column) navigation:
   *  Up/Down move along the list and show that category's settings,
   *  Right (or OK) enters the settings, Up past the top reaches Save/Close,
   *  Left and Down past the end do nothing.
   */
  function moveSettingsTab(active: NavEl, keyCode: number): boolean {
    if (!active || !active.classList || !active.classList.contains('settings-tab')) {
      return false;
    }
    const row = createRow(settingsTabButtons);
    if (!row.tiles().length) return false;

    if (keyCode === REMOTE_KEY.DOWN) {
      const next = row.moveWithin(active, 1, isFocusable);
      if (next) return activateSettingsTabButton(next);
      return true; // swallow at edge
    }
    if (keyCode === REMOTE_KEY.UP) {
      const prev = row.moveWithin(active, -1, isFocusable);
      if (prev) return activateSettingsTabButton(prev);
      // Past the top of the list: Save, then Close, in the header.
      const actions = settingsHeaderActions();
      if (actions.length && focusItem(actions[0])) return true;
      return true;
    }
    if (keyCode === REMOTE_KEY.RIGHT) {
      // Ensure the focused category's pane is the active one, then land in it.
      activateSettingsTabButton(active);
      const pane = activeSettingsPane();
      const land = firstPaneLandTarget(pane);
      if (land) return focusItem(land);
      return true;
    }
    if (keyCode === REMOTE_KEY.LEFT) {
      return true; // nothing to the left of the list
    }
    return false;
  }

  /**
   * Save / Close header buttons:
   *  Left/Right between them, Down back to the active tab (Home preferred).
   */
  function moveSettingsHeaderAction(active: NavEl, keyCode: number): boolean {
    if (!isSettingsHeaderAction(active)) return false;
    const row = createRow(settingsHeaderActions);
    if (!row.tiles().length) return false;

    if (keyCode === REMOTE_KEY.RIGHT) {
      const next = row.moveWithin(active, 1, isFocusable);
      if (next) return focusItem(next);
      return true;
    }
    if (keyCode === REMOTE_KEY.LEFT) {
      const prev = row.moveWithin(active, -1, isFocusable);
      if (prev) return focusItem(prev);
      return true;
    }
    if (keyCode === REMOTE_KEY.DOWN) {
      const activeTab = activeTabButton();
      if (activeTab) return activateSettingsTabButton(activeTab);
      return true;
    }
    if (keyCode === REMOTE_KEY.UP) {
      return true; // top of panel
    }
    return false;
  }

  function moveSequential(active: NavEl | null, delta: number): boolean {
    // Unfiltered list; visibility is checked only on the rows we step over,
    // not on every control in the panel (hundreds with a rooted app list).
    const scoped = settingsCandidates();
    const idx = active ? scoped.indexOf(active) : -1;
    if (idx < 0 || !active) {
      // Focus is outside the panel — enter the visible pane, not the Home tab.
      if (delta > 0) {
        const land = firstPaneLandTarget(activeSettingsPane());
        if (land && focusItem(land)) return true;
        return focusFirstLive(scoped, 0, 1);
      }
      return focusFirstLive(scoped, scoped.length - 1, -1);
    }

    // Up/Down go row by row. Other controls on the active one's visual row
    // (pinned ↑ ↓ ✕, input tick + label) are Left/Right stops; stepping
    // through them took three presses per pinned app and looked stuck. A
    // stepper or slider keeps Left/Right for its value, so from one of those
    // its row mates stay on the Up/Down path.
    const skipRowMates = !isValueControl(active);
    const a = active.getBoundingClientRect();
    const activeY = a.top + a.height / 2;
    const activeX = a.left + a.width / 2;
    function onActiveRow(el: NavEl): boolean {
      if (!skipRowMates) return false;
      const r = el.getBoundingClientRect();
      return Math.abs(r.top + r.height / 2 - activeY) <= SAME_ROW_PX;
    }

    // From the first content control of a pane, UP returns to the active tab.
    if (delta < 0) {
      const pane = active.closest && active.closest('.settings-tab-pane');
      if (pane && pane.classList.contains('is-active')) {
        // If we're at the top of the pane (no earlier control still in pane),
        // UP returns to the active tab — not Save/Close.
        let hasEarlierInPane = false;
        for (let p = idx - 1; p >= 0; p -= 1) {
          if (!pane.contains(scoped[p])) break; // DOM order: left the pane
          if (scoped[p].classList && scoped[p].classList.contains('settings-tab')) continue;
          if (isFocusable(scoped[p]) && !onActiveRow(scoped[p])) {
            hasEarlierInPane = true;
            break;
          }
        }
        if (!hasEarlierInPane) {
          const activeTab = activeTabButton();
          if (activeTab) return activateSettingsTabButton(activeTab);
        }
      }
    }

    // Skip tiles that refuse focus (webOS sometimes ignores .focus() on a node).
    for (let i = idx + delta; i >= 0 && i < scoped.length; i += delta) {
      // When moving down from a tab, don't land on the other tab — use moveSettingsTab.
      if (active.classList && active.classList.contains('settings-tab') &&
          scoped[i].classList && scoped[i].classList.contains('settings-tab')) {
        continue;
      }
      if (!isFocusable(scoped[i]) || onActiveRow(scoped[i])) continue;
      // Land in the same column on the new row (↑ stays on ↑ down the list).
      const target = skipRowMates ? nearestOnRow(scoped, i, delta, activeX) : scoped[i];
      if (focusItem(target) || (target !== scoped[i] && focusItem(scoped[i]))) return true;
    }
    return true; // at edge; swallow so spatial nav doesn't escape
  }

  // Steppers, selects and sliders use Left/Right to change their value.
  function isValueControl(el: NavEl | null): boolean {
    if (!el) return false;
    if (el.classList && el.classList.contains('option-stepper')) return true;
    return el.tagName === 'SELECT' || (el.tagName === 'INPUT' && el.type === 'range');
  }

  /** The control on list[start]'s visual row closest to x (same column). */
  function nearestOnRow(list: NavEl[], start: number, delta: number, x: number): NavEl {
    const first = list[start].getBoundingClientRect();
    const rowY = first.top + first.height / 2;
    let best = list[start];
    let bestDx = Math.abs(first.left + first.width / 2 - x);
    for (let j = start + delta; j >= 0 && j < list.length; j += delta) {
      if (!isFocusable(list[j])) continue;
      const r = list[j].getBoundingClientRect();
      if (Math.abs(r.top + r.height / 2 - rowY) > SAME_ROW_PX) break;
      const dx = Math.abs(r.left + r.width / 2 - x);
      if (dx < bestDx) {
        best = list[j];
        bestDx = dx;
      }
    }
    return best;
  }

  /** First (or last) Settings control inside the panel's scrolled viewport. */
  function settingsControlOnScreen(list: NavEl[], fromBottom: boolean): NavEl | null {
    const body = root.querySelector<NavEl>('#settings-panel .settings-body');
    if (!body) return null;
    const view = body.getBoundingClientRect();
    for (let n = 0; n < list.length; n += 1) {
      const el = list[fromBottom ? list.length - 1 - n : n];
      const r = el.getBoundingClientRect();
      if (r.top >= view.top && r.bottom <= view.bottom) return el;
    }
    return null;
  }

  /** Left/Right to the neighbouring control on the same visual row, if any. */
  function moveWithinRow(active: NavEl, delta: number): boolean {
    const list = settingsCandidates();
    const idx = list.indexOf(active);
    if (idx < 0) return false;
    const a = active.getBoundingClientRect();
    const ay = a.top + a.height / 2;
    const ax = a.left + a.width / 2;
    for (let i = idx + delta; i >= 0 && i < list.length; i += delta) {
      const item = list[i];
      if (!isFocusable(item)) continue;
      const r = item.getBoundingClientRect();
      if (Math.abs(r.top + r.height / 2 - ay) > SAME_ROW_PX) return false;
      const dx = r.left + r.width / 2 - ax;
      return (delta > 0 ? dx > 0 : dx < 0) && focusItem(item);
    }
    return false;
  }

  function photoGridTiles(tile: NavEl | null): NavEl[] {
    if (!tile || !tile.closest) return [];
    const grid = tile.closest('.photo-picker-grid');
    if (!grid) return [];
    return Array.prototype.filter.call(
      grid.querySelectorAll<NavEl>('.photo-picker-tile.focusable'),
      isFocusable
    );
  }

  /** First settings control after the photo gallery (Ken Burns, Music, …). */
  function focusAfterPhotoGrid(tile: NavEl | null): boolean {
    const grid = tile && tile.closest ? tile.closest('.photo-picker-grid') : null;
    if (!grid) return false;
    const scoped = settingsCandidates();
    let lastInGrid = -1;
    for (let i = 0; i < scoped.length; i += 1) {
      if (grid.contains(scoped[i])) lastInGrid = i;
    }
    return focusFirstLive(scoped, lastInGrid + 1, 1);
  }

  function focusBeforePhotoGrid(tile: NavEl | null): boolean {
    const grid = tile && tile.closest ? tile.closest('.photo-picker-grid') : null;
    if (!grid) return false;
    const scoped = settingsCandidates();
    let firstInGrid = -1;
    for (let i = 0; i < scoped.length; i += 1) {
      if (grid.contains(scoped[i])) {
        firstInGrid = i;
        break;
      }
    }
    return focusFirstLive(scoped, firstInGrid - 1, -1);
  }

  /**
   * Navigate the settings photo-picker grid by layout + index.
   * Spatial-only nav was unreliable on TV; index order matches reading order.
   */
  function movePhotoPicker(active: NavEl, keyCode: number): boolean {
    if (!active || !active.classList || !active.classList.contains('photo-picker-tile')) {
      return false;
    }
    const tiles = photoGridTiles(active);
    if (!tiles.length) return false;

    const idx = tiles.indexOf(active);
    if (idx < 0) return false;

    const isHorizontal = keyCode === REMOTE_KEY.LEFT || keyCode === REMOTE_KEY.RIGHT;
    const isVertical = keyCode === REMOTE_KEY.UP || keyCode === REMOTE_KEY.DOWN;
    if (!isHorizontal && !isVertical) return false;

    // How many tiles share the first visual row → column count for up/down.
    const firstTop = tiles[0].getBoundingClientRect().top;
    let cols = 0;
    for (let i = 0; i < tiles.length; i += 1) {
      if (Math.abs(tiles[i].getBoundingClientRect().top - firstTop) < 28) {
        cols += 1;
      } else {
        break;
      }
    }
    if (cols < 1) cols = 1;

    let nextIdx = -1;
    if (keyCode === REMOTE_KEY.RIGHT) nextIdx = idx + 1;
    else if (keyCode === REMOTE_KEY.LEFT) nextIdx = idx - 1;
    else if (keyCode === REMOTE_KEY.DOWN) nextIdx = idx + cols;
    else if (keyCode === REMOTE_KEY.UP) nextIdx = idx - cols;

    if (nextIdx >= 0 && nextIdx < tiles.length) {
      if (focusItem(tiles[nextIdx])) return true;
    }

    // Past the last / before the first tile → leave the gallery.
    if (isVertical) {
      if (keyCode === REMOTE_KEY.DOWN) {
        if (focusAfterPhotoGrid(active)) return true;
      } else if (focusBeforePhotoGrid(active)) {
        return true;
      }
      return moveSequential(active, keyCode === REMOTE_KEY.DOWN ? 1 : -1);
    }

    // Horizontal wrap within the grid only (stay put at ends).
    const step = keyCode === REMOTE_KEY.RIGHT ? 1 : -1;
    const fallback = idx + step;
    if (fallback >= 0 && fallback < tiles.length && focusItem(tiles[fallback])) {
      return true;
    }
    return true;
  }

  /**
   * Select/OK on a photo tile: choose it, then leave the gallery so the user
   * can keep scrolling Settings (Ken Burns, Music, Save, …).
   */
  function activatePhotoPickerTile(tile: NavEl | null): boolean {
    if (!tile || !tile.classList.contains('photo-picker-tile')) return false;
    try {
      // Prefer explicit handler if present (div tiles); also works for <button>.
      if (typeof tile.click === 'function') tile.click();
    } catch (err) { /* ignore */ }
    // Advance focus out of the grid so "Select then continue" works on TV.
    if (!focusAfterPhotoGrid(tile)) {
      try { tile.focus({preventScroll: true}); } catch (err2) { /* ignore */ }
      focusItem(tile);
    }
    return true;
  }

  // Magic Remote scroll wheel → native pane scrolling.
  let wheelSettle: ReturnType<typeof setTimeout> | null = null;

  /**
   * After the wheel scrolled the pane, the focused control can be off-screen.
   * Leave focus alone while it is still visible; otherwise move it to the
   * nearest visible control (same column preferred) without scrolling again, so
   * the next D-pad press continues from what is on screen. Focus in the tab bar
   * or header never scrolls away and stays put.
   */
  function anchorFocusInView(body: NavEl): void {
    const active = document.activeElement as NavEl | null;
    if (!active || !body.contains(active)) return;
    const view = body.getBoundingClientRect();
    const current = active.getBoundingClientRect();
    if (current.top >= view.top && current.bottom <= view.bottom) return;

    const cx = current.left + current.width / 2;
    const cy = current.top + current.height / 2;
    const scoped = settingsFocusables();
    let best: NavEl | null = null;
    let bestScore = Infinity;
    for (let i = 0; i < scoped.length; i += 1) {
      const el = scoped[i];
      if (el === active || !body.contains(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.top < view.top || r.bottom > view.bottom) continue;
      const dx = Math.abs(r.left + r.width / 2 - cx);
      const dy = Math.abs(r.top + r.height / 2 - cy);
      // Prefer a row the router will leave in place, then the nearest row and
      // column: the highlight does not hop sideways between rows.
      const inside = r.top >= view.top + KEEP_IN_VIEW_PX &&
        r.bottom <= view.bottom - KEEP_IN_VIEW_PX;
      const score = (inside ? 0 : 1e9) + dy * 1000 + dx;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (!best) return;
    host.noteRemoteNav();
    focusItem(best);
  }

  function wheel(event: WheelEvent): void {
    // Don't steal the wheel while the virtual keyboard is open for editing.
    if (isEditingSettingsText(document.activeElement)) {
      event.preventDefault();
      return;
    }

    const body = root.querySelector<NavEl>('#settings-panel .settings-body');
    if (!body) return;

    // The Magic Remote scrolls whatever is under its cursor. Settings is the
    // only thing that scrolls here, so drive the pane ourselves when the cursor
    // is elsewhere (left category list, header, clock); over the pane the
    // browser's native scroll is the nicer feel.
    if (!body.contains(event.target as Node | null)) {
      event.preventDefault();
      // deltaMode: 0=pixel, 1=line, 2=page. Magic Remote is usually pixels;
      // normalize line/page into a comparable scale.
      const scale = event.deltaMode === 1 ? 24 : event.deltaMode === 2 ? 240 : 1;
      body.scrollTop += (event.deltaY || 0) * scale;
    }

    // A wheel turn is remote navigation: keep scroll-induced pointermove from
    // snapping focus to whatever row lands under a still cursor.
    host.noteRemoteNav();

    if (wheelSettle) clearTimeout(wheelSettle);
    wheelSettle = setTimeout(function () {
      wheelSettle = null;
      anchorFocusInView(body);
    }, WHEEL_SETTLE_MS);
  }

  function adjustValueControl(el: NavEl | null, dir: number): boolean {
    if (!el) return false;
    const tag = el.tagName;

    if (el.classList && el.classList.contains('option-stepper') && typeof el.__step === 'function') {
      el.__step(dir);
      return true;
    }

    if (tag === 'SELECT') {
      const count = el.options.length;
      if (!count) return false;
      let next = el.selectedIndex + dir;
      if (next < 0) next = 0;
      if (next > count - 1) next = count - 1;
      if (next !== el.selectedIndex) {
        el.selectedIndex = next;
        el.dispatchEvent(new Event('change', {bubbles: true}));
      }
      return true;
    }

    if (tag === 'INPUT' && el.type === 'range') {
      const step = Number(el.step) || 1;
      const min = el.min !== '' ? Number(el.min) : 0;
      const max = el.max !== '' ? Number(el.max) : 100;
      let next = Number(el.value) + dir * step;
      if (next < min) next = min;
      if (next > max) next = max;
      if (next !== Number(el.value)) {
        el.value = String(next);
        el.dispatchEvent(new Event('input', {bubbles: true}));
        el.dispatchEvent(new Event('change', {bubbles: true}));
      }
      return true;
    }

    return false;
  }

  return {
    recover: function (up: boolean): boolean {
      const scoped = settingsFocusables();
      if (!scoped.length) return false;
      // Pick up on screen (e.g. after a list redrew under the focus) rather
      // than jumping to the very top or bottom of Settings. Claim the key even
      // if the focus call refuses, so the router never falls through to a home
      // tile while the panel is open.
      focusItem(settingsControlOnScreen(scoped, up) ||
        (up ? scoped[scoped.length - 1] : scoped[0]));
      return true;
    },
    move: function (keyCode: number): boolean {
      const active = document.activeElement as NavEl | null;
      if (!active || !active.classList) return false;

      // Save / Close header, then the category list.
      if (moveSettingsHeaderAction(active, keyCode)) return true;
      if (moveSettingsTab(active, keyCode)) return true;

      if (movePhotoPicker(active, keyCode)) return true;

      const isHorizontal = keyCode === REMOTE_KEY.LEFT || keyCode === REMOTE_KEY.RIGHT;
      const isVertical = keyCode === REMOTE_KEY.UP || keyCode === REMOTE_KEY.DOWN;

      if (isHorizontal && adjustValueControl(active, keyCode === REMOTE_KEY.RIGHT ? 1 : -1)) {
        return true;
      }

      // Left/Right only moves between controls on the same visual row
      // (pinned ↑ ↓ ✕, input tick + label, key field + Show). On a lone tick
      // box it does nothing; it used to act like Down/Up, which read as a skip.
      if (isHorizontal) {
        if (moveWithinRow(active, keyCode === REMOTE_KEY.RIGHT ? 1 : -1)) return true;
        // Nothing further left on this row: back to the category list.
        if (keyCode === REMOTE_KEY.LEFT && !active.classList.contains('settings-tab')) {
          const activeTab = activeTabButton();
          if (activeTab) focusItem(activeTab);
        }
        return true;
      }
      if (isVertical) {
        moveSequential(active, keyCode === REMOTE_KEY.DOWN ? 1 : -1);
        return true;
      }
      return false;
    },
    wheel: wheel,
    activate: activatePhotoPickerTile
  };
}
