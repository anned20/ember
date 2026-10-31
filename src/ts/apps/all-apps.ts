/**
 * All apps: every app on the TV in one grid, opened from the All apps tile on
 * the home row. OK opens an app, Back closes. Holding OK (see focus.ts) opens
 * that app's context menu: pin/unpin, restart and delete.
 */

import {listInstalledApps} from './apps.js';
import {indexInRow} from '@focus/focus-row.js';
import {lazyLoadIcon} from './app-catalog.js';
import {BRAND} from '@lib/brand.js';
import {t} from '@lib/i18n.js';
import type {AppRecord} from '@lib/types.js';

const EMBER_ID = BRAND.appId;
// Apps are rarely installed while Ember runs: list them again after this.
const LIST_MAX_AGE_MS = 10 * 60 * 1000;
// The menu's focus indices sit above the grid's (indexBase 5000 + tile count).
const MENU_INDEX_OFFSET = 900;

/** The error a failed remove rejects with. */
type ErrorLike = {message?: unknown} | null | undefined;

/** One app as listInstalledApps reports it (with its hidden / removable flags). */
type ListedApp = Awaited<ReturnType<typeof listInstalledApps>>[number];

/** The focus manager calls the All apps overlay makes. */
interface AllAppsFocus {
  focusWithin(selector: string): void;
  focusElement?(el: Element | null): boolean;
  focusHomeDock?(): void;
}

/** Callbacks and mounts createAllApps needs from the app shell. */
export interface AllAppsOptions {
  mount: HTMLElement;
  focus: AllAppsFocus;
  launch(app: AppRecord): void;
  /** Whether the app is on the home row (pinned, or a custom tile for it). */
  isPinned?(app: ListedApp): boolean;
  pin?(app: ListedApp): void;
  unpin?(app: ListedApp): void;
  /** Close the app if it is running, then open it again. */
  restart?(app: ListedApp): void;
  /** Uninstall the app; rejects with the TV's reason. */
  remove?(app: ListedApp): Promise<void> | void;
  onToast?(message: string): void;
}

/** The handle returned by createAllApps. */
export interface AllApps {
  show(): Promise<void>;
  hide(): void;
  isOpen(): boolean;
  refocus(): void;
  /** A held Select on a tile: open that app's context menu. */
  openMenu(tile: Element): void;
  /** Close the menu or its confirm; false when neither is open. */
  handleBack(): boolean;
}

/**
 * @param {{mount: Element, focus: object, launch: function(object)}} options
 *   mount: inside the focus manager's root; launch(app): open an app record.
 */
export function createAllApps(options: AllAppsOptions): AllApps {
  let panel: HTMLElement | null = null;
  let grid: HTMLElement | null = null;
  let open = false;
  let listed: ListedApp[] | null = null;
  let listedAt = 0;
  let loadGen = 0;

  // Each tile's app, for the long-press menu (the tile only carries its title).
  const tileApps = new WeakMap<HTMLElement, ListedApp>();
  let menu: HTMLElement | null = null;
  let menuApp: ListedApp | null = null;
  let menuOrigin: HTMLElement | null = null;
  let confirming = false;

  function build() {
    panel = document.createElement('div');
    panel.className = 'all-apps';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', t('apps.allApps'));

    const head = document.createElement('div');
    head.className = 'all-apps-head';
    const title = document.createElement('h2');
    title.textContent = t('apps.allApps');
    const hint = document.createElement('span');
    hint.className = 'all-apps-hint';
    hint.textContent = t('apps.hint');
    head.appendChild(title);
    head.appendChild(hint);

    grid = document.createElement('div');
    grid.className = 'all-apps-grid';

    panel.appendChild(head);
    panel.appendChild(grid);
    options.mount.appendChild(panel);
  }

  function badge(title: string): HTMLElement {
    const fallback = document.createElement('span');
    fallback.className = 'app-fallback';
    fallback.textContent = String(title || '').slice(0, 2).toUpperCase();
    return fallback;
  }

  function tile(app: ListedApp, index: number): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'app-tile all-apps-tile focusable';
    button.dataset.focusIndex = String(indexInRow('all-apps', index));
    button.dataset.longPress = '';
    button.setAttribute('aria-label', app.title);

    const label = document.createElement('span');
    label.className = 'app-label';
    label.textContent = app.title;

    if (app.icon) {
      const img = document.createElement('img');
      img.className = 'app-icon';
      img.alt = '';
      img.addEventListener('error', function () {
        if (img.parentNode) img.parentNode.replaceChild(badge(app.title), img);
      });
      // Read as root only when it scrolls into view: a TV can have dozens.
      lazyLoadIcon(img, app.icon, grid);
      button.appendChild(img);
    } else {
      button.appendChild(badge(app.title));
    }
    button.appendChild(label);

    tileApps.set(button, app);
    button.addEventListener('click', function () {
      options.launch(app);
    });
    return button;
  }

  function render(apps: ListedApp[]) {
    grid!.innerHTML = '';
    if (!apps.length) {
      const empty = document.createElement('p');
      empty.className = 'all-apps-note';
      empty.textContent = t('apps.readFailed');
      grid!.appendChild(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    apps.forEach(function (app, i) {
      fragment.appendChild(tile(app, i));
    });
    grid!.appendChild(fragment);
  }

  async function load(): Promise<ListedApp[]> {
    const apps = (await listInstalledApps()).filter(function (app) {
      return app && app.id && !app.hidden && app.id !== EMBER_ID;
    });
    apps.sort(function (a, b) {
      return (a.title || a.id).localeCompare(b.title || b.id);
    });
    return apps;
  }

  // While the menu is open only its items are focusable, so Up/Down cannot
  // wander back into the grid (see collect() in focus.ts).
  function setTilesEnabled(enabled: boolean) {
    if (!grid) return;
    grid.querySelectorAll<HTMLButtonElement>('.all-apps-tile').forEach(function (tileEl) {
      tileEl.disabled = !enabled;
    });
  }

  function menuButton(label: string, action: string, index: number): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'all-apps-menu-item focusable';
    button.dataset.action = action;
    button.dataset.focusIndex = String(indexInRow('all-apps', MENU_INDEX_OFFSET + index));
    button.textContent = label;
    return button;
  }

  function closeMenu() {
    if (!menu) return;
    menu.remove();
    menu = null;
    menuApp = null;
    confirming = false;
    setTilesEnabled(true);
  }

  // Back on the tile the menu was opened from, or the first tile after it went.
  function focusOrigin() {
    const origin = menuOrigin;
    if (origin && options.focus.focusElement && options.focus.focusElement(origin)) return;
    options.focus.focusWithin('.all-apps');
  }

  function renderMenu() {
    const app = menuApp;
    if (!app || !menu) return;
    confirming = false;
    menu.innerHTML = '';
    menu.appendChild(menuCard(app));
  }

  function menuCard(app: ListedApp): HTMLElement {
    const card = document.createElement('div');
    card.className = 'all-apps-menu-card';

    const head = document.createElement('div');
    head.className = 'all-apps-menu-head';
    const title = document.createElement('h3');
    title.textContent = app.title;
    const id = document.createElement('span');
    id.className = 'all-apps-menu-id';
    id.textContent = app.id;
    const pinned = !!(options.isPinned && options.isPinned(app));
    const state = document.createElement('span');
    state.className = 'all-apps-menu-state';
    state.textContent = pinned ? t('apps.menu.onHome') : t('apps.menu.offHome');
    head.appendChild(title);
    head.appendChild(id);
    head.appendChild(state);
    card.appendChild(head);

    const pin = menuButton(pinned ? t('apps.menu.unpin') : t('apps.menu.pin'), pinned ? 'unpin' : 'pin', 0);
    pin.addEventListener('click', function () {
      const toggle = pinned ? options.unpin : options.pin;
      if (toggle) toggle(app);
      closeMenu();
      focusOrigin();
    });
    card.appendChild(pin);

    const restart = menuButton(t('apps.menu.restart'), 'restart', 1);
    restart.addEventListener('click', function () {
      // The host hides the overlay; if it doesn't, close the menu here.
      if (options.restart) options.restart(app);
      else closeMenu();
    });
    card.appendChild(restart);

    if (app.removable !== false) {
      const remove = menuButton(t('apps.menu.delete'), 'delete', 2);
      remove.addEventListener('click', function () {
        renderConfirm(app);
      });
      card.appendChild(remove);
    }
    return card;
  }

  function renderConfirm(app: ListedApp) {
    if (!menu) return;
    confirming = true;
    menu.innerHTML = '';

    const card = document.createElement('div');
    card.className = 'all-apps-menu-card';
    const question = document.createElement('p');
    question.className = 'all-apps-menu-question';
    question.textContent = t('apps.menu.deleteConfirm', {title: app.title});
    card.appendChild(question);

    const confirm = menuButton(t('apps.menu.delete'), 'delete-confirm', 0);
    confirm.addEventListener('click', function () {
      if (!options.remove) return;
      Promise.resolve(options.remove(app)).then(function () {
        if (listed) {
          listed = listed.filter(function (entry) { return entry.id !== app.id; });
        }
        closeMenu();
        render(listed || []);
        focusOrigin();
      }, function (err: ErrorLike) {
        if (options.onToast) {
          const reason = err && err.message ? String(err.message) : '';
          options.onToast(reason || t('apps.deleteFailed', {app: app.title}));
        }
      });
    });
    card.appendChild(confirm);

    const cancel = menuButton(t('apps.menu.cancel'), 'cancel', 1);
    cancel.addEventListener('click', function () {
      renderMenu();
      options.focus.focusWithin('.all-apps-menu');
    });
    card.appendChild(cancel);

    menu.appendChild(card);
    options.focus.focusWithin('.all-apps-menu');
  }

  function openMenu(tileEl: Element) {
    const app = tileEl instanceof HTMLElement ? tileApps.get(tileEl) : undefined;
    if (!open || !app || !panel) return;
    closeMenu();
    menuApp = app;
    menuOrigin = tileEl as HTMLElement;
    menu = document.createElement('div');
    menu.className = 'all-apps-menu';
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', t('apps.menu.label', {title: app.title}));
    panel.appendChild(menu);
    setTilesEnabled(false);
    renderMenu();
    options.focus.focusWithin('.all-apps-menu');
  }

  function handleBack(): boolean {
    if (!menu) return false;
    if (confirming) {
      // In the confirm: Back steps back to the menu, not out of All apps.
      renderMenu();
      options.focus.focusWithin('.all-apps-menu');
      return true;
    }
    closeMenu();
    focusOrigin();
    return true;
  }

  async function show(): Promise<void> {
    if (!panel) build();
    open = true;
    panel!.hidden = false;
    document.body.classList.add('all-apps-open');
    grid!.scrollTop = 0;

    const fresh = !!(listed && Date.now() - listedAt < LIST_MAX_AGE_MS);
    if (fresh && listed) {
      render(listed);
    } else {
      grid!.innerHTML = '';
      const loading = document.createElement('p');
      loading.className = 'all-apps-note';
      loading.textContent = t('apps.reading');
      grid!.appendChild(loading);
      const gen = ++loadGen;
      const apps = await load();
      if (gen !== loadGen || !open) return;
      listed = apps;
      listedAt = Date.now();
      render(apps);
    }
    options.focus.focusWithin('.all-apps');
  }

  function hide() {
    if (!panel || !open) return;
    closeMenu();
    open = false;
    loadGen += 1;
    panel.hidden = true;
    document.body.classList.remove('all-apps-open');
    // Back on the All apps tile, however it was opened (OK, or a pointer click).
    const launcher = document.querySelector('#app-grid [data-action="all-apps"]');
    if (!(launcher && options.focus.focusElement && options.focus.focusElement(launcher))) {
      if (options.focus.focusHomeDock) options.focus.focusHomeDock();
    }
  }

  return {
    show: show,
    hide: hide,
    isOpen: function () { return open; },
    openMenu: openMenu,
    handleBack: handleBack,
    /** After Ember regains input: stay on the app the remote was on. */
    refocus: function () {
      const active = document.activeElement;
      if (panel && active && panel.contains(active) &&
          options.focus.focusElement && options.focus.focusElement(active)) {
        return;
      }
      options.focus.focusWithin('.all-apps');
    }
  };
}
