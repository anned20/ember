import {saveConfig, TIMEZONE_OPTIONS} from '@config/config.js';
import {setIconSrc} from '@apps/app-catalog.js';
import {applyActiveProfile, PROFILE_OPTIONS} from '@config/profiles.js';
import {indexInRow} from '@focus/focus-row.js';
import {whoAmI} from '@luna/luna.js';
import {attachInputScrollHelpers} from './text-gate.js';
import {APP_VERSION} from '@lib/version.js';
import {createWeatherPane} from './panes/weather.js';
import {createInputsPane} from './panes/inputs.js';
import {createMusicPane} from './panes/music.js';
import {createToolsPane} from './panes/tools.js';
import {createBackgroundPane} from './panes/background.js';
import {createScreensaverPane} from './panes/screensaver.js';
import {createSystemPane} from './panes/system.js';
import {createAppsPane} from './panes/apps.js';
import {createAiPane} from './panes/ai.js';
import type {PaneHandle, SettingsContext, SettingsPanelOptions} from './pane.js';
export type {SettingsPanelOptions} from './pane.js';
import {
  labeledControl,
  createHint,
  createSection,
  createToggle,
  createOptionStepper
} from './components/index.js';
import {createBinder, stepperField} from './settings-binding.js';
import type {Config} from '@lib/types.js';

// The focus manager reads the text-field keyboard gate through the panel module.
export {isSettingsTextField, isEditingSettingsText, beginSettingsTextEdit, endSettingsTextEdit} from './text-gate.js';

// How long a pane's asynchronous fill may take before it is abandoned.
const PANE_LOAD_MS = 8000;

/** The handle createSettingsPanel returns. */
export interface SettingsPanelHandle {
  show(): void;
  hide(): void;
  isVisible(): boolean;
  handleBack(): boolean;
}

export function createSettingsPanel(
  panel: HTMLElement,
  getConfig: () => Config,
  options: SettingsPanelOptions
): SettingsPanelHandle {
  let visible = false;
  let opening = false;
  let renderGen = 0;
  // Built once: the Tools pane holds its restore report across the redraw a
  // restore triggers, which rebuilds the panel and every other pane.
  const toolsPane = createToolsPane();
  // Built once too: the Apps pane remembers whether hidden apps are shown for
  // the rest of the visit, across the redraw a restore triggers.
  const appsPane = createAppsPane();
  // After open, ignore pointer/click for a short window so the Magic Remote
  // "click" that opened Settings (gear is top-right, Close is also top-right)
  // does not immediately hit Close and dismiss the panel.
  let openGuardUntil = 0;
  let guardHandler: ((event: Event) => void) | null = null;
  // The AI Voice pane's cleanup (its SuperGrok poll and retry timers), so
  // hiding or redrawing the panel can stop them.
  let aiPaneDispose: (() => void) | null = null;

  function clearOpenGuard() {
    openGuardUntil = 0;
    if (guardHandler) {
      document.removeEventListener('click', guardHandler, true);
      document.removeEventListener('pointerup', guardHandler, true);
      document.removeEventListener('pointerdown', guardHandler, true);
      guardHandler = null;
    }
  }

  function armOpenGuard(ms?: number): void {
    clearOpenGuard();
    openGuardUntil = Date.now() + (ms || 600);
    guardHandler = function (event: Event) {
      if (Date.now() >= openGuardUntil) {
        clearOpenGuard();
        return;
      }
      // Swallow the trailing OK/click from the same press that opened us.
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
      }
    };
    document.addEventListener('click', guardHandler, true);
    document.addEventListener('pointerup', guardHandler, true);
    document.addEventListener('pointerdown', guardHandler, true);
  }

  function requestHide(): void {
    if (Date.now() < openGuardUntil) return; // ignore Close during open guard
    hide();
  }

  function hide(): void {
    visible = false;
    opening = false;
    renderGen += 1; // invalidate any in-flight render
    clearOpenGuard();
    if (aiPaneDispose) {
      aiPaneDispose();
      aiPaneDispose = null;
    }
    panel.hidden = true;
    document.body.classList.remove('settings-open');
    if (options.onClose) options.onClose();
  }

  /** Immediate shell so the panel is visible even while async lists load. */
  function paintLoadingShell(): void {
    panel.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'settings-header';

    const headerTitleWrap = document.createElement('div');
    headerTitleWrap.className = 'settings-header-title';
    const headerTitle = document.createElement('h2');
    headerTitle.textContent = 'Launch Home - "Come home to what you love"';
    headerTitleWrap.appendChild(headerTitle);

    const headerActions = document.createElement('div');
    headerActions.className = 'settings-header-actions';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'settings-close focusable';
    closeBtn.dataset.focusIndex = String(indexInRow('settings-header', 1));
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', requestHide);
    headerActions.appendChild(closeBtn);

    header.appendChild(headerTitleWrap);
    header.appendChild(headerActions);

    const body = document.createElement('div');
    body.className = 'settings-body';
    body.appendChild(createHint('Loading settings…', 'settings-loading'));

    panel.appendChild(header);
    panel.appendChild(body);
  }

  function showErrorState(message: string): void {
    // Never leave a blank black panel.
    if (!panel.querySelector('.settings-header')) {
      paintLoadingShell();
    }
    const body = panel.querySelector('.settings-body');
    if (body) {
      body.innerHTML = '';
      body.appendChild(createHint(message || 'Could not load settings. Press Close and try again.'));
    }
  }

  function show(): void {
    // Already open — just re-focus (do not rebuild).
    if (visible && !opening && panel && !panel.hidden &&
        (panel.querySelector('.settings-section') || panel.querySelector('.settings-tabs'))) {
      if (options.onRendered) options.onRendered();
      return;
    }
    // Open already in progress.
    if (opening && visible && !panel.hidden) return;

    opening = true;
    visible = true;
    const gen = (renderGen += 1);

    // Paint shell BEFORE hiding underlay so we never flash empty black.
    panel.hidden = false;
    panel.removeAttribute('hidden');
    paintLoadingShell();
    document.body.classList.add('settings-open');
    armOpenGuard(700);

    if (options.onOpen) options.onOpen();
    // Delay focus until after the opening click sequence finishes, otherwise
    // focus lands on Close under the cursor and the same OK closes us.
    setTimeout(function () {
      if (!visible || gen !== renderGen) return;
      if (options.onRendered) options.onRendered();
    }, 350);

    Promise.resolve(render(gen)).then(function () {
      if (!visible || gen !== renderGen) return;
      opening = false;
      // If render bailed early without sections, keep a usable shell.
      if (!panel.querySelector('.settings-section') && !panel.querySelector('.settings-tabs')) {
        showErrorState('Settings did not finish loading. Close and open again.');
      }
      if (options.onRendered) options.onRendered();
    }).catch(function (err) {
      console.error(err);
      if (!visible || gen !== renderGen) return;
      opening = false;
      showErrorState('Could not load settings. Close and try again.');
      if (options.onRendered) options.onRendered();
    });
  }

  function focusPhotoGallery(galleryEl: HTMLElement): void {
    if (!galleryEl || galleryEl.hidden) return;
    window.setTimeout(function () {
      try {
        galleryEl.scrollIntoView({block: 'nearest', behavior: 'smooth'});
      } catch (err) {
        try { galleryEl.scrollIntoView(true); } catch (err2) { /* ignore */ }
      }
      const firstTile = galleryEl.querySelector('.photo-picker-tile.focusable') as HTMLElement | null;
      if (firstTile && typeof firstTile.focus === 'function') {
        // preventScroll: a plain focus() would re-centre mid smooth scroll.
        try { firstTile.focus({preventScroll: true}); } catch (err3) { /* ignore */ }
        firstTile.classList.add('focused');
        const siblings = galleryEl.ownerDocument.querySelectorAll(
          '#settings-panel .focusable.focused'
        );
        for (let i = 0; i < siblings.length; i += 1) {
          if (siblings[i] !== firstTile) siblings[i].classList.remove('focused');
        }
      }
    }, 80);
  }

  /**
   * Put focus (and the row highlight) on a Settings control, e.g. back on
   * the field the user was editing. Picking used to jump to Save, so the next
   * Down restarted from the top of the panel.
   */
  function focusSettingsControl(el: Element): void {
    window.setTimeout(function () {
      focusSettingsControlNow(el);
    }, 60);
  }

  function focusSettingsControlNow(el: Element | null): boolean {
    if (!el || !panel.contains(el)) return false;
    // Same path as D-pad navigation: focus, row highlight, minimal scroll.
    if (options.focusControl) return !!options.focusControl(el);

    const target = el as HTMLElement;
    if (!target.getClientRects || !target.getClientRects().length) return false;
    try {
      target.scrollIntoView({block: 'nearest'});
    } catch (err) { /* ignore */ }
    try {
      if (typeof target.tabIndex === 'number' && target.tabIndex < 0) target.tabIndex = 0;
    } catch (err3) { /* ignore */ }
    try { target.focus({preventScroll: true}); } catch (err4) { /* ignore */ }

    const focused = panel.querySelectorAll('.focusable.focused');
    for (let i = 0; i < focused.length; i += 1) {
      if (focused[i] !== el) focused[i].classList.remove('focused');
    }
    target.classList.add('focused');

    // Match focus manager row highlight for consistency.
    const highlights = panel.querySelectorAll('.settings-row-highlight');
    for (let j = 0; j < highlights.length; j += 1) {
      highlights[j].classList.remove('settings-row-highlight');
    }
    const row = target.closest && target.closest('.settings-row');
    (row || target).classList.add('settings-row-highlight');
    return true;
  }

  /**
   * The app lists are rebuilt from scratch when they change, which destroys
   * the ↑/↓/✕/+ button that had focus. With nothing focused, the next Up
   * jumped to the bottom of Settings and Down to the top. Focus the button in
   * the same spot instead: row `rowIndex` (or the last row), trying the
   * buttons in `buttonOrder`, or the nearest control when the list is empty.
   */
  function refocusListButton(listEl: Element, rowIndex: number, buttonOrder: number[]): void {
    if (!listEl || !panel.contains(listEl)) return;
    const rows = listEl.querySelectorAll('.settings-pinned-row, .settings-app-row');
    if (rows.length) {
      const buttons = rows[Math.min(rowIndex, rows.length - 1)]
        .querySelectorAll('.settings-mini-btn');
      for (let i = 0; i < buttonOrder.length; i += 1) {
        const btn = buttons[buttonOrder[i]] as HTMLButtonElement | undefined;
        if (btn && !btn.disabled && focusSettingsControlNow(btn)) return;
      }
    }
    const all: Element[] = Array.prototype.slice.call(panel.querySelectorAll('.focusable'))
      .filter(function (el: Element) { return !listEl.contains(el); });
    const after = all.filter(function (el) {
      return listEl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING;
    });
    const before = all.filter(function (el) { return after.indexOf(el) < 0; }).reverse();
    const nearest = after.concat(before);
    for (let j = 0; j < nearest.length; j += 1) {
      if (focusSettingsControlNow(nearest[j])) return;
    }
  }

  // After a restore: draw the panel again from the restored settings and put
  // focus back on the Restore button.
  function redrawAfterRestore(): void {
    const gen = (renderGen += 1);
    Promise.resolve(render(gen)).then(function () {
      if (!visible || gen !== renderGen) return;
      const btn = panel.querySelector('[data-backup-action="restore"]');
      if (btn) focusSettingsControlNow(btn);
    }).catch(function (err) {
      console.error(err);
    });
  }

  function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T | null> {
    return new Promise<T | null>(function (resolve) {
      let done = false;
      const timer = setTimeout(function () {
        if (!done) { done = true; resolve(null); }
      }, ms);
      Promise.resolve(promise).then(function (value: T) {
        if (!done) { done = true; clearTimeout(timer); resolve(value); }
      }, function () {
        if (!done) { done = true; clearTimeout(timer); resolve(null); }
      });
    });
  }

  async function render(gen: number): Promise<void> {
    // A redraw (a restore) rebuilds the panel: stop the previous AI Voice
    // pane's timers before the new one is built.
    if (aiPaneDispose) {
      aiPaneDispose();
      aiPaneDispose = null;
    }
    const config = getConfig();
    const effective = applyActiveProfile(config);
    // Every plain control is bound to the config path it edits; Save runs
    // binder.collect(), which reads the whole field table back into `config`.
    // Derived / asynchronous fields (galleries, playlists, the USB scan, the
    // weather place, the AI keys) register hook()s instead.
    const binder = createBinder(effective);

    // Keep the loading shell until we have a header ready, then replace in one go
    // via a document fragment so the panel is never empty/black.
    const next = document.createDocumentFragment();

    const header = document.createElement('div');
    header.className = 'settings-header';

    const headerTitleWrap = document.createElement('div');
    headerTitleWrap.className = 'settings-header-title';

    const headerTitle = document.createElement('h2');
    headerTitle.textContent = 'Launch Home - "Come home to what you love"';

    const versionLabel = document.createElement('p');
    versionLabel.className = 'settings-version';
    versionLabel.textContent = 'Settings · Version ' + APP_VERSION;

    // Effective user the launcher runs privileged calls as (root when the
    // Homebrew Channel service is elevated). Tells the user whether app scanning,
    // which needs root, will work. Populated asynchronously via the Luna bus.
    const runUserLabel = document.createElement('p');
    runUserLabel.className = 'settings-run-user run-user-checking';
    runUserLabel.textContent = 'Running as: checking…';
    // Root through Homebrew Channel can stop answering: say so after a while
    // rather than "checking…" for good. A late answer still updates this.
    const runUserSlow = setTimeout(function () {
      runUserLabel.textContent = 'Running as: no answer from Homebrew Channel (root)';
      runUserLabel.className = 'settings-run-user run-user-limited';
    }, 10000);
    whoAmI().then(function (user) {
      clearTimeout(runUserSlow);
      if (!user) {
        runUserLabel.textContent = 'Running as: unknown (not rooted / no Homebrew Channel)';
        runUserLabel.className = 'settings-run-user run-user-limited';
        return;
      }
      const isRoot = user === 'root';
      runUserLabel.textContent = 'Running as: ' + user +
        (isRoot ? ' — app scanning available' : ' — not root, app scanning may be limited');
      runUserLabel.className = 'settings-run-user ' + (isRoot ? 'run-user-root' : 'run-user-limited');
    }).catch(function () {
      clearTimeout(runUserSlow);
      runUserLabel.textContent = 'Running as: unknown';
      runUserLabel.className = 'settings-run-user run-user-limited';
    });

    headerTitleWrap.appendChild(headerTitle);
    headerTitleWrap.appendChild(versionLabel);
    headerTitleWrap.appendChild(runUserLabel);

    const headerActions = document.createElement('div');
    headerActions.className = 'settings-header-actions';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'settings-close focusable';
    closeBtn.dataset.focusIndex = String(indexInRow('settings-header', 1));
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', requestHide);
    headerActions.appendChild(closeBtn);

    header.appendChild(headerTitleWrap);
    header.appendChild(headerActions);
    next.appendChild(header);

    // Category list on the left, that category's settings on the right (the
    // scrolling .settings-body). Like LG's own Settings, so the remote already
    // knows it: Up/Down picks a category, Right (or OK) enters it, Left or
    // Back comes back to the list.
    const main = document.createElement('div');
    main.className = 'settings-main';
    const nav = document.createElement('nav');
    nav.className = 'settings-nav';
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-orientation', 'vertical');
    const body = document.createElement('div');
    body.className = 'settings-body';
    main.appendChild(nav);
    main.appendChild(body);
    next.appendChild(main);

    // Settings categories, in list order. Each is a pane; sections below are
    // appended to the pane they belong to.
    const CATEGORIES = [
      {id: 'look', label: 'Look', sub: 'Profile, wallpaper, clock, icons'},
      {id: 'music', label: 'Music', sub: 'Ambient music and its volume'},
      {id: 'screensaver', label: 'Screensaver', sub: 'Launch Home and TV screensavers'},
      {id: 'apps', label: 'Apps', sub: 'Pinned apps, add or import apps'},
      {id: 'inputs', label: 'Inputs & channels', sub: 'HDMI inputs, Live TV channels'},
      {id: 'weather', label: 'Weather', sub: 'Forecast and location'},
      {id: 'system', label: 'System', sub: 'Volume levels, Home button, boot, performance'},
      {id: 'ai', label: 'AI Voice', sub: 'Voice assistant, keys, models'},
      {id: 'tools', label: 'Tools', sub: 'Backup & restore, TV check'}
    ];
    let activeSettingsTab = 'look';
    const tabButtons: Record<string, HTMLButtonElement> = {};
    const panes: Record<string, HTMLDivElement> = {};
    const panesWrap = document.createElement('div');
    panesWrap.className = 'settings-tab-panes';
    CATEGORIES.forEach(function (cat, i) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'settings-tab focusable' + (i === 0 ? ' active' : '');
      btn.dataset.focusIndex = String(indexInRow('settings-tabs', i));
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
      btn.dataset.tab = cat.id;
      const label = document.createElement('span');
      label.className = 'settings-tab-label';
      label.textContent = cat.label;
      const sub = document.createElement('span');
      sub.className = 'settings-tab-sub';
      sub.textContent = cat.sub;
      btn.appendChild(label);
      btn.appendChild(sub);
      nav.appendChild(btn);
      tabButtons[cat.id] = btn;

      const pane = document.createElement('div');
      pane.className = 'settings-tab-pane' + (i === 0 ? ' is-active' : '');
      pane.dataset.tab = cat.id;
      pane.setAttribute('role', 'tabpanel');
      pane.setAttribute('aria-hidden', i === 0 ? 'false' : 'true');
      panesWrap.appendChild(pane);
      panes[cat.id] = pane;
    });
    body.appendChild(panesWrap);
    // The one seam between this composition root and the category panes. The
    // root keeps panel state, the nav, the header and Save; a pane is built
    // with the context and gets its dependencies from that one argument.
    const context: SettingsContext = {
      config: effective,
      rawConfig: config,
      binder: binder,
      panes: panes,
      options: options,
      apps: {pinnedOrder: [], customApps: [], appsByIdMap: {}, installedCatalog: null},
      isVisible: function () { return visible; },
      focusControl: focusSettingsControl,
      focusNow: focusSettingsControlNow,
      focusInPanel: function () { return panel.contains(document.activeElement); },
      focusGallery: focusPhotoGallery,
      refocusListButton: refocusListButton,
      withDeadline: withDeadline,
      redraw: redrawAfterRestore
    };
    // Panes moved behind the seam, keyed by category id.
    const paneHandles: Record<string, PaneHandle> = {};

    // Declared before setSettingsTab so the early Home default cannot hit a TDZ.
    let saveBtn!: HTMLButtonElement;

    function setSettingsTab(tabId: string, opts?: {focusContent?: boolean; force?: boolean}): void {
      const tabOpts = opts || {};
      const next = panes[tabId] ? tabId : 'look';
      // No-op if already on this tab (avoids thrashing on repeated focus events).
      if (next === activeSettingsTab && !tabOpts.focusContent && !tabOpts.force) {
        return;
      }
      const changed = next !== activeSettingsTab;
      activeSettingsTab = next;
      // Class toggles only — CSS keeps inactive panes out of interaction
      // without a display:none reflow of the whole settings tree.
      Object.keys(panes).forEach(function (id) {
        const on = id === next;
        panes[id].classList.toggle('is-active', on);
        panes[id].setAttribute('aria-hidden', on ? 'false' : 'true');
        tabButtons[id].classList.toggle('active', on);
        tabButtons[id].setAttribute('aria-selected', on ? 'true' : 'false');
      });
      // Each category starts at its top.
      if (changed) body.scrollTop = 0;
      if (saveBtn && saveBtn.textContent !== 'Save' && saveBtn.textContent !== 'Saving…') {
        saveBtn.textContent = 'Save';
      }
      // Only dive into pane content when the user enters the category
      // (OK / Right), not when Up/Down merely highlights it.
      if (tabOpts.focusContent) {
        const first = panes[next].querySelector('.focusable') as HTMLElement | null;
        if (first && typeof first.focus === 'function') {
          try { first.focus(); } catch (err) { /* ignore */ }
          first.classList.add('focused');
        }
      }
    }
    // Pane flips on Up/Down along the list (settings-activate-tab) or a click.
    // A bare focus from the cursor or wheel must not switch category.
    Object.keys(tabButtons).forEach(function (id) {
      tabButtons[id].addEventListener('settings-activate-tab', function () {
        setSettingsTab(id);
      });
      tabButtons[id].addEventListener('click', function () {
        setSettingsTab(id, {focusContent: true, force: true});
      });
    });
    // Settings opens on Look.
    setSettingsTab('look', {force: true});

    // The AI Voice pane: the voice-service status, the provider/key/model
    // cluster and the SuperGrok sign-in flow. It is rebuilt with the panel and
    // reads its dependencies from the context; its Save override writes voice
    // settings and returns "handled" so the field table is not collected.
    const aiPaneHandle = createAiPane();
    paneHandles.ai = aiPaneHandle;
    aiPaneHandle.build(context);
    // The sign-in modal is a full-panel overlay, so it hangs off the panel
    // build stage rather than the pane box.
    if (aiPaneHandle.overlay) next.appendChild(aiPaneHandle.overlay);
    aiPaneDispose = aiPaneHandle.dispose;

    // The Background pane is built below and driven from here (the profile
    // picker) and by the Look pane; it reads its dependencies from the context.
    const backgroundPane = createBackgroundPane();

    const profileSection = createSection('Profile');

    const profileSelect = createOptionStepper({
      focusIndex: 901,
      choices: PROFILE_OPTIONS.map(function (entry) {
        return {value: entry.id, label: entry.label};
      }),
      onChange: function (value) { backgroundPane.setProfile(value); }
    });
    binder.bind(stepperField(profileSelect, 'profile'));
    profileSection.appendChild(labeledControl('Active profile', profileSelect));

    profileSection.appendChild(createHint(
      'Night lowers ambient volume and darkens the scrim. Cinema disables music and uses a dark gradient.'
    ));
    panes.look.appendChild(profileSection);

    // The Background section, behind the seam: it reads its dependencies from
    // the context, and exposes a handle the profile picker (and the Look pane)
    // drives.
    backgroundPane.build(context);

    // Swap loading shell → full chrome now (profile + background already in body).
    // Remaining sections append to the live body so the user always sees content.
    panel.innerHTML = '';
    panel.appendChild(next);

    const musicPane = createMusicPane();
    paneHandles.music = musicPane;
    musicPane.build(context);

    // The old Launcher section, now three: System, Screensaver, and Clock &
    // icons in Look. System and Screensaver are behind the seam; the Clock &
    // icons section still builds here (it belongs to the Look pane).
    const systemPane = createSystemPane();
    paneHandles.system = systemPane;
    systemPane.build(context);

    const screensaverPane = createScreensaverPane();
    paneHandles.screensaver = screensaverPane;
    screensaverPane.build(context);

    const clockSection = createSection('Clock & icons');

    const showClockField = createToggle({
      label: 'Show clock',
      focusIndex: '1000',
      path: 'launcher.showClock'
    });
    binder.bind(showClockField.field!);
    clockSection.appendChild(showClockField.row);

    const clockFormatSelect = createOptionStepper({
      focusIndex: 1090,
      choices: [
        {value: '24', label: '24-hour (18:30)'},
        {value: '12', label: '12-hour (6:30 PM)'}
      ]
    });
    binder.bind(stepperField(clockFormatSelect, 'launcher.clockFormat', {
      parse: function (raw) { return raw === '12' ? '12' : '24'; }
    }));
    clockSection.appendChild(labeledControl('Clock format', clockFormatSelect));

    const showDateField = createToggle({
      label: 'Show date',
      focusIndex: '1001',
      path: 'launcher.showDate'
    });
    binder.bind(showDateField.field!);
    clockSection.appendChild(showDateField.row);

    const clockAlignSelect = createOptionStepper({
      focusIndex: 1002,
      choices: [
        {value: 'left', label: 'Top left'},
        {value: 'center', label: 'Centre top'},
        {value: 'center-middle', label: 'Centre middle'},
        {value: 'right', label: 'Top right'}
      ]
    });
    binder.bind(stepperField(clockAlignSelect, 'launcher.clockAlign', {
      // Normalise unknown legacy values to centre top.
      parse: function (raw) {
        return ['left', 'center', 'center-middle', 'right'].indexOf(raw) < 0 ? 'center' : raw;
      }
    }));
    clockSection.appendChild(labeledControl('Clock position', clockAlignSelect));

    const clockSizeSelect = createOptionStepper({
      focusIndex: 1003,
      choices: [
        {value: 'small', label: 'Small'},
        {value: 'medium', label: 'Medium'},
        {value: 'large', label: 'Large'},
        {value: 'x-large', label: 'X-Large'},
        {value: 'xx-large', label: 'XX-Large'}
      ]
    });
    binder.bind(stepperField(clockSizeSelect, 'launcher.clockSize', {
      parse: function (raw) { return raw || 'large'; }
    }));
    clockSection.appendChild(labeledControl('Clock size', clockSizeSelect));

    const timezoneSelect = createOptionStepper({
      focusIndex: 1004,
      choices: TIMEZONE_OPTIONS.map(function (option) {
        return {value: option.value, label: option.label};
      })
    });
    binder.bind(stepperField(timezoneSelect, 'launcher.timezone'));
    clockSection.appendChild(labeledControl('Timezone', timezoneSelect));

    const iconSizeSelect = createOptionStepper({
      focusIndex: 1005,
      choices: [
        {value: 'small', label: 'Small'},
        {value: 'medium', label: 'Medium'},
        {value: 'large', label: 'Large'}
      ]
    });
    binder.bind(stepperField(iconSizeSelect, 'launcher.iconSize'));
    clockSection.appendChild(labeledControl('Icon size', iconSizeSelect));

    const iconAlignSelect = createOptionStepper({
      focusIndex: 1006,
      choices: [
        {value: 'left', label: 'Left'},
        {value: 'center', label: 'Centre'},
        {value: 'right', label: 'Right'}
      ]
    });
    binder.bind(stepperField(iconAlignSelect, 'launcher.iconAlign'));
    clockSection.appendChild(labeledControl('Icon alignment', iconAlignSelect));

    const iconLayoutSelect = createOptionStepper({
      focusIndex: 1007,
      choices: [
        {value: 'scroll', label: 'Scroll one row'},
        {value: 'wrap', label: 'Stacked rows'}
      ]
    });
    binder.bind(stepperField(iconLayoutSelect, 'launcher.iconLayout'));
    clockSection.appendChild(labeledControl('Icon layout', iconLayoutSelect));

    const iconsPerRowSelect = createOptionStepper({
      focusIndex: 1008,
      choices: [
        {value: '4', label: '4'}, {value: '5', label: '5'}, {value: '6', label: '6'},
        {value: '7', label: '7'}, {value: '8', label: '8'}, {value: '9', label: '9'},
        {value: '10', label: '10'}, {value: '11', label: '11'}, {value: '12', label: '12'}
      ]
    });
    binder.bind(stepperField(iconsPerRowSelect, 'launcher.iconsPerRow', {
      parse: function (raw) { return parseInt(raw, 10) || 7; }
    }));
    clockSection.appendChild(labeledControl('Icons per row (scroll mode)', iconsPerRowSelect));

    const bundledIconsField = createToggle({
      label: 'Use Launch Home app icons',
      focusIndex: '1008',
      path: 'launcher.bundledIcons'
    });
    binder.bind(bundledIconsField.field!);
    clockSection.appendChild(bundledIconsField.row);

    clockSection.appendChild(createHint(
      'Off = each app’s own icon from the TV (Netflix, YouTube, TV Settings, …). Reading the TV’s icons needs root; apps without one keep the Launch Home icon.'
    ));

    // ── Glass: the see-through tiles and buttons on the home screen ──────
    const glassSection = createSection('Glass');
    glassSection.appendChild(createHint('How the see-through app tiles, input buttons and Settings button ' +
      'look over your wallpaper. The preview shows your choices; press Save to keep them.'));

    // A sample over the current wallpaper: a tile, the tile the remote is on,
    // the current input and another input, in the choices below (before Save).
    const glassPreview = document.createElement('div');
    glassPreview.className = 'glass-preview';
    const wallpaperLayer = document.getElementById('background-layer');
    const wallpaperImage = wallpaperLayer ? getComputedStyle(wallpaperLayer).backgroundImage : '';
    if (wallpaperImage && wallpaperImage !== 'none') glassPreview.style.backgroundImage = wallpaperImage;
    function previewTile(title: string, icon: string, selected: boolean): HTMLDivElement {
      const tile = document.createElement('div');
      // Not .focused: the focus manager clears that class from everything.
      tile.className = 'app-tile' + (selected ? ' is-preview-focus' : '');
      const img = document.createElement('img');
      img.className = 'app-icon';
      img.alt = '';
      setIconSrc(img, icon, undefined);
      const label = document.createElement('span');
      label.className = 'app-label';
      label.textContent = title;
      tile.appendChild(img);
      tile.appendChild(label);
      return tile;
    }
    function previewChip(text: string, current: boolean): HTMLDivElement {
      const chip = document.createElement('div');
      chip.className = 'input-chip' + (current ? ' active' : '');
      chip.textContent = text;
      return chip;
    }
    const previewInputs = document.createElement('div');
    previewInputs.className = 'glass-preview-inputs';
    previewInputs.appendChild(previewChip('Current input', true));
    previewInputs.appendChild(previewChip('Other input', false));
    glassPreview.appendChild(previewTile('A tile', 'assets/app-icons/netflix.png', false));
    glassPreview.appendChild(previewTile('Selected', 'assets/app-icons/youtube.png', true));
    glassPreview.appendChild(previewInputs);
    glassSection.appendChild(glassPreview);

    function paintGlassPreview(): void {
      const tint = glassSelect.value;
      const border = glassBorderSelect.value;
      const highlight = focusColourSelect.value;
      glassPreview.className = 'glass-preview' +
        (tint && tint !== 'light' ? ' glass-' + tint : '') +
        (border && border !== 'white' ? ' glass-border-' + border : '') +
        (highlight && highlight !== 'warm' ? ' focus-' + highlight : '');
    }

    const glassSelect = createOptionStepper({
      focusIndex: 1091,
      choices: [
        {value: 'light', label: 'Light (original)'},
        {value: 'dark', label: 'Dark'},
        {value: 'black', label: 'Black'},
        {value: 'blue', label: 'Blue'},
        {value: 'purple', label: 'Purple'},
        {value: 'green', label: 'Green'},
        {value: 'warm', label: 'Warm'}
      ],
      onChange: paintGlassPreview
    });
    binder.bind(stepperField(glassSelect, 'launcher.glassTint', {
      parse: function (raw) { return raw || 'light'; }
    }));
    glassSection.appendChild(labeledControl('Tile colour', glassSelect));
    glassSection.appendChild(createHint('Inside the app tiles, input buttons and Settings button. ' +
      'Dark or Black suit dark wallpapers.'));

    const glassBorderSelect = createOptionStepper({
      focusIndex: 1092,
      choices: [
        {value: 'white', label: 'White (original)'},
        {value: 'glass', label: 'Same as tile colour'},
        {value: 'none', label: 'None'},
        {value: 'black', label: 'Black'},
        {value: 'blue', label: 'Blue'},
        {value: 'purple', label: 'Purple'},
        {value: 'green', label: 'Green'},
        {value: 'warm', label: 'Warm'},
        {value: 'gold', label: 'Gold'}
      ],
      onChange: paintGlassPreview
    });
    binder.bind(stepperField(glassBorderSelect, 'launcher.glassBorder', {
      parse: function (raw) { return raw || 'white'; }
    }));
    glassSection.appendChild(labeledControl('Tile outline', glassBorderSelect));
    glassSection.appendChild(createHint('The thin line around each tile and button.'));

    const focusColourSelect = createOptionStepper({
      focusIndex: 1093,
      choices: [
        {value: 'warm', label: 'Warm (original)'},
        {value: 'white', label: 'White'},
        {value: 'border', label: 'Same as tile outline'},
        {value: 'blue', label: 'Blue'},
        {value: 'purple', label: 'Purple'},
        {value: 'green', label: 'Green'},
        {value: 'gold', label: 'Gold'}
      ],
      onChange: paintGlassPreview
    });
    binder.bind(stepperField(focusColourSelect, 'launcher.focusColour', {
      parse: function (raw) { return raw || 'warm'; }
    }));
    glassSection.appendChild(labeledControl('Selection highlight', focusColourSelect));
    glassSection.appendChild(createHint('The glow around the tile or button the remote is on, ' +
      'and the colour of the current input.'));
    paintGlassPreview();
    panes.look.appendChild(glassSection);

    panes.look.appendChild(clockSection);

    // ── Weather (today + 4 days on the home screen) ─────────────────────
    const weatherPane = createWeatherPane();
    paneHandles.weather = weatherPane;
    weatherPane.build(context);

    // ── Inputs & channels ───────────────────────────────────────────────
    const inputsPane = createInputsPane();
    paneHandles.inputs = inputsPane;
    inputsPane.build(context);

    // ── Apps (pinned apps, custom app, Discover) ────────────────────────
    paneHandles.apps = appsPane;
    appsPane.build(context);

    paneHandles.tools = toolsPane;
    toolsPane.build(context);

    saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'settings-save focusable';
    saveBtn.dataset.focusIndex = String(indexInRow('settings-header', 0));
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', function () {
      // A pane with its own write path (the AI Voice pane) handles Save first
      // and says whether it did; the rest collect the plain field table.
      const activePane = paneHandles[activeSettingsTab];
      if (activePane && activePane.onSave && activePane.onSave(context, config, saveBtn)) {
        return;
      }

      // One pass over the field table, then the derived-field hooks.
      binder.collect(config);

      saveConfig(config);
      if (options.onSave) options.onSave(config);
      if (config.launcher.launchOnHome && options.onToast) {
        options.onToast('Enabling Home → Launch Home watcher…');
      } else if (config.launcher.bootOnStart && options.onToast) {
        options.onToast('Enabling boot on TV start…');
      }
      hide();
    });
    headerActions.insertBefore(saveBtn, closeBtn);

    // Drive the panes moved behind the seam, in the category order the nav
    // declares. Each pane's asynchronous fill runs under a deadline so a slow
    // TV cannot leave the panel half-built.
    for (let i = 0; i < CATEGORIES.length; i += 1) {
      const pane = paneHandles[CATEGORIES[i].id];
      if (!pane || !pane.load) continue;
      await withDeadline(pane.load(context), PANE_LOAD_MS);
      if (gen !== renderGen || !visible) return;
    }
    // The Background pane builds inside the Look category, so its fill is not
    // in the category loop above.
    if (backgroundPane.load) {
      await withDeadline(backgroundPane.load(context), PANE_LOAD_MS);
      if (gen !== renderGen || !visible) return;
    }

    attachInputScrollHelpers(body);
  }

  return {
    show: show,
    hide: hide,
    isVisible: function () { return visible; },
    handleBack: function () {
      const modal = panel && panel.querySelector('.ai-oauth-modal:not([hidden])') as HTMLElement | null;
      if (modal) {
        const cancelBtn = modal.querySelector('.ai-oauth-modal-cancel') as HTMLElement | null;
        if (cancelBtn) cancelBtn.click();
        else modal.hidden = true;
        return true;
      }
      // Back from inside a category goes to the category list; Back on the
      // list (or the header) closes Settings.
      const active = document.activeElement;
      if (active && active.closest && active.closest('.settings-tab-pane')) {
        const tab = panel.querySelector('.settings-tab.active');
        if (tab) {
          focusSettingsControlNow(tab);
          return true;
        }
      }
      return false;
    }
  };
}