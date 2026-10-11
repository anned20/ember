/**
 * All apps: every app on the TV in one grid, opened from the All apps tile on
 * the home row. OK opens an app, Back closes. Opening an app that isn't on
 * the home row used to mean pinning it in Settings, opening it, and removing
 * it again.
 */

import {listInstalledApps} from './apps.js';
import {indexInRow} from './focus-row.js';
import {lazyLoadIcon} from './app-catalog.js';
import type {AppRecord} from './types.js';

const LAUNCH_HOME_ID = 'org.webosbrew.lounge.launcher';
// Apps are rarely installed while Launch Home runs: list them again after this.
const LIST_MAX_AGE_MS = 10 * 60 * 1000;

/** One app as listInstalledApps reports it (with its hidden flag). */
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
}

/** The handle returned by createAllApps. */
export interface AllApps {
  show(): Promise<void>;
  hide(): void;
  isOpen(): boolean;
  refocus(): void;
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

  function build() {
    panel = document.createElement('div');
    panel.className = 'all-apps';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'All apps');

    const head = document.createElement('div');
    head.className = 'all-apps-head';
    const title = document.createElement('h2');
    title.textContent = 'All apps';
    const hint = document.createElement('span');
    hint.className = 'all-apps-hint';
    hint.textContent = 'OK opens an app · Back closes';
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
      empty.textContent = 'Couldn’t read the TV’s apps. This needs root (Homebrew Channel).';
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
      return app && app.id && !app.hidden && app.id !== LAUNCH_HOME_ID;
    });
    apps.sort(function (a, b) {
      return (a.title || a.id).localeCompare(b.title || b.id);
    });
    return apps;
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
      loading.textContent = 'Reading the TV’s apps…';
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
    /** After Launch Home regains input: stay on the app the remote was on. */
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
