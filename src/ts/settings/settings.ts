import {configFromBackup, loadConfig, saveConfig, TIMEZONE_OPTIONS, coerceScreensaverMinutes} from '@config/config.js';
import {listInstalledApps} from '@apps/apps.js';
import {lgHomeAppsToAdd} from '@apps/lg-home.js';
import {isAppInstalled, loadAppCatalog, rememberApps, resolvePinnedApp, setIconSrc, lazyLoadIcon} from '@apps/app-catalog.js';
import {KNOWN_BUILTIN_APPS, getBuiltinAppIcon, getBuiltinAppTitle, BUILTIN_ICON_CHOICES} from '@apps/app-icons.js';
import {
  loadBuiltinManifest,
  normalizeBackgroundConfig,
  parseUrlList,
  REMOTE_BACKGROUNDS,
  findRemoteBackgroundById,
  findRemoteBackgroundByUrl,
  remoteThumbUrl,
  builtinImageUrl,
  jpegForTv
} from '@background/backgrounds.js';
import {AERIAL_BACKGROUNDS} from '@background/aerials.js';
import {loadBuiltinMusicManifest, normalizeMusicConfig} from '@music/builtin-music.js';
import {applyActiveProfile, getProfileOverrides, PROFILE_OPTIONS} from '@config/profiles.js';
import {indexInRow} from '@focus/focus-row.js';
import {findLoungeRoots, joinPath, discoverMusicTracks} from '@lib/usb.js';
import {
  disableVoice, enableVoice, execRoot, isVoiceRunning, listLaunchPoints, readSettingsBackups,
  runTvCheck, whoAmI, writeAutoBackup, writeSettingsBackup
} from '@luna/luna.js';
import {
  LAST_BACKUP_KEY, backupLabel, backupWhen, compatibilityNote, lastBackupNote, listBackups,
  restoreReport, settingsBackupText
} from './settings-backup.js';
import {attachInputScrollHelpers, beginSettingsTextEdit} from './text-gate.js';
import {startLauncherProbe, tvCheckHead, tvCheckSummary} from './tv-check.js';
import {APP_VERSION} from '@lib/version.js';
import {
  getVoiceConfig,
  getVoiceStatus,
  setVoiceConfig,
  startSuperGrokLogin,
  cancelSuperGrokLogin,
  signOutSuperGrok,
  importSuperGrokAuth
} from '@voice/voice-config.js';
import {qrSvgMarkup} from '@lib/qr-svg.js';
import {createWeatherPane} from './panes/weather.js';
import {createInputsPane} from './panes/inputs.js';
import type {PaneHandle, SettingsContext, SettingsPanelOptions} from './pane.js';
export type {SettingsPanelOptions} from './pane.js';
import {
  labeledControl,
  labeledBlock,
  createHint,
  createSection,
  createToggle,
  createTextField,
  createMiniButton,
  createAppRow,
  createGallery,
  createOptionStepper,
  createProviderPicker
} from './components/index.js';
import type {GalleryEntry, OptionStepperElement, ProviderPickerElement, StepperOption} from './components/index.js';
import {createBinder, stepperField, textField, toggleField} from './settings-binding.js';
import type {
  Config,
  CustomApp,
  AppCatalog,
  AppRecord,
  BuiltinBackground,
  BuiltinMusicEntry,
  AerialBackground,
  RemoteBackground,
  UsbTrack
} from '@lib/types.js';

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

/** The background controls syncBackgroundFields toggles, keyed by name. */
interface BackgroundRefs {
  displayRow: HTMLElement;
  bgShuffleRow: HTMLElement;
  aerialRow: HTMLElement;
  builtinRow: HTMLElement;
  usbHint: HTMLElement;
  usbFileRow: HTMLElement;
  remoteRow: HTMLElement;
  urlHint: HTMLElement;
  urlRow: HTMLElement;
  urlsRow: HTMLElement;
  intervalRow: HTMLElement;
  kenBurnsRow: HTMLElement;
  kenBurnsHint: HTMLElement;
  displaySelect: OptionStepperElement;
}

interface SyncFieldsOptions {
  revealGallery?: boolean;
}

/** The row/input/show-button bundle makeKeyRow returns. */
interface KeyRow {
  row: HTMLDivElement;
  input: HTMLInputElement;
  showBtn: HTMLButtonElement;
}

/** A Launch Home backup file as parsed by settings-backup.js. */
interface BackupRecord {
  data: {config: any; savedAt?: string; updatedTo?: string};
  where: string;
  time: number;
  format: number;
  schema: number;
  appVersion: string;
  reason: string;
  readable: boolean;
}

/** A parsed voice-service config / status payload (untyped JSON). */
type VoicePayload = Record<string, any>;

export function createSettingsPanel(
  panel: HTMLElement,
  getConfig: () => Config,
  options: SettingsPanelOptions
): SettingsPanelHandle {
  let visible = false;
  let opening = false;
  let renderGen = 0;
  // Backup & restore result to show again after a restore redraws the panel.
  let backupNote = '';
  let builtinManifest: BuiltinBackground[] = [];
  let pinnedOrder: string[] = [];
  let pinnedContainer: HTMLElement | null = null;
  let appsByIdMap: AppCatalog = {};
  // The installed-apps catalog behind the lists (see isAppInstalled).
  let installedCatalog: AppCatalog | null = null;
  // Settings -> Apps -> Show hidden and system apps (for this visit only).
  let showHiddenApps = false;
  let customApps: CustomApp[] = [];
  // After open, ignore pointer/click for a short window so the Magic Remote
  // "click" that opened Settings (gear is top-right, Close is also top-right)
  // does not immediately hit Close and dismiss the panel.
  let openGuardUntil = 0;
  let guardHandler: ((event: Event) => void) | null = null;
  let aiOauthPollTimer: ReturnType<typeof setInterval> | null = null;
  // Updates the "Show installed apps (N)" button after the list re-renders.
  let syncAddAppsToggle: (() => void) | null = null;

  function findCustomApp(id: string): CustomApp | null {
    for (let i = 0; i < customApps.length; i += 1) {
      if (customApps[i].id === id) return customApps[i];
    }
    return null;
  }

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
    if (aiOauthPollTimer) {
      clearInterval(aiOauthPollTimer);
      aiOauthPollTimer = null;
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

  function syncBackgroundFields(source: string, refs: BackgroundRefs, opts?: SyncFieldsOptions): void {
    const isImage = source !== 'preset' && source !== 'animated-gradient';
    const showBuiltin = source === 'builtin';
    const showUsb = source === 'usb';
    const showUrl = source === 'url';
    const showAerial = source === 'aerial';
    const isSlideshow = refs.displaySelect.value === 'slideshow';
    const revealGallery = !!(opts && opts.revealGallery);

    refs.displayRow.hidden = !isImage;
    // Aerial Slideshow cycles the whole catalog, so the single-clip picker is
    // hidden there (as the built-in gallery is for its own slideshow).
    refs.aerialRow.hidden = !showAerial || isSlideshow;
    refs.bgShuffleRow.hidden = !(showAerial && isSlideshow);
    // Built-in / online / aerial galleries are mutually exclusive by source.
    refs.builtinRow.hidden = !showBuiltin || isSlideshow;
    refs.usbHint.hidden = !showUsb;
    refs.usbFileRow.hidden = !showUsb || isSlideshow;
    refs.remoteRow.hidden = !showUrl || isSlideshow;
    refs.urlHint.hidden = !showUrl;
    refs.urlRow.hidden = !showUrl || isSlideshow;
    refs.urlsRow.hidden = !showUrl || !isSlideshow;
    // Neither applies to aerials: clips advance on the clip's own end, and a
    // Ken Burns pan on top of a moving video is meaningless.
    refs.intervalRow.hidden = !isImage || !isSlideshow || showAerial;
    refs.kenBurnsRow.hidden = !isImage || showAerial;
    refs.kenBurnsHint.hidden = !isImage || showAerial;

    // When the user switches Source to a photo catalog, scroll that gallery into view.
    if (revealGallery && !isSlideshow) {
      if (showAerial && refs.aerialRow && !refs.aerialRow.hidden) {
        focusPhotoGallery(refs.aerialRow);
      } else if (showBuiltin && refs.builtinRow && !refs.builtinRow.hidden) {
        focusPhotoGallery(refs.builtinRow);
      } else if (showUrl && refs.remoteRow && !refs.remoteRow.hidden) {
        focusPhotoGallery(refs.remoteRow);
      }
    }
  }

  function movePinned(index: number, delta: number): void {
    const next = index + delta;
    if (next < 0 || next >= pinnedOrder.length) return;
    const tmp = pinnedOrder[index];
    pinnedOrder[index] = pinnedOrder[next];
    pinnedOrder[next] = tmp;
    if (!pinnedContainer) return;
    const keepFocus = pinnedContainer.contains(document.activeElement);
    renderPinnedList(pinnedContainer);
    // Stay on the moved app's arrow so repeated presses keep moving it.
    if (keepFocus) refocusListButton(pinnedContainer, next, delta < 0 ? [0] : [1]);
  }

  function renderPinnedList(container: HTMLElement): void {
    container.innerHTML = '';

    pinnedOrder.forEach(function (appId, index) {
      const app: AppRecord = appsByIdMap[appId] ||
        {id: appId, launchId: undefined, title: appId, icon: ''};
      // Not shown on the home row (see apps.js): say why, so it can go.
      const isCustom = customApps.some(function (entry) { return entry && entry.id === appId; });
      const missing = !isCustom && !isAppInstalled(installedCatalog, appId);
      const row = createAppRow({
        title: app.title || app.id,
        icon: app.icon,
        variant: 'pinned',
        missing: missing,
        titleSuffix: missing ? ' \u2014 not installed on this TV' : '',
        mountIcon: function (icon) {
          // TV-native icons are file:// paths WAM won't load directly.
          icon.addEventListener('error', function () {
            const bundled = getBuiltinAppIcon(app.launchId || app.id);
            if (bundled && icon.dataset.fallbackTried !== '1') {
              icon.dataset.fallbackTried = '1';
              icon.src = bundled;
              return;
            }
            icon.remove();
          });
          setIconSrc(icon, app.icon, undefined);
        }
      }).row;

      const upBtn = createMiniButton({
        label: '↑',
        focusIndex: 1200 + index * 3,
        onClick: function () { movePinned(index, -1); }
      });
      // At the ends the arrow stays focusable but does nothing (dimmed): when
      // it was disabled, focus fell to the other arrow and the next OK moved
      // the app straight back.
      if (index === 0) upBtn.setAttribute('aria-disabled', 'true');

      const downBtn = createMiniButton({
        label: '↓',
        focusIndex: 1201 + index * 3,
        onClick: function () { movePinned(index, 1); }
      });
      if (index === pinnedOrder.length - 1) downBtn.setAttribute('aria-disabled', 'true');

      const removeBtn = createMiniButton({
        label: '✕',
        focusIndex: 1202 + index * 3,
        onClick: function () {
          const keepFocus = container.contains(document.activeElement);
          const removedId = pinnedOrder[index];
          pinnedOrder.splice(index, 1);
          for (let i = customApps.length - 1; i >= 0; i -= 1) {
            if (customApps[i].id === removedId) customApps.splice(i, 1);
          }
          renderPinnedList(container);
          // The next app slides into this row; land on its ✕.
          if (keepFocus) refocusListButton(container, index, [2]);
        }
      });

      row.appendChild(upBtn);
      row.appendChild(downBtn);
      row.appendChild(removeBtn);
      container.appendChild(row);
    });
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
    const config = getConfig();
    const effective = applyActiveProfile(config);
    const bg = normalizeBackgroundConfig(effective.background);
    // Every plain control is bound to the config path it edits; Save runs
    // binder.collect(), which reads the whole field table back into `config`.
    // Derived / asynchronous fields (galleries, playlists, the USB scan, the
    // weather place, the AI keys) register hook()s instead.
    const binder = createBinder(effective);
    // Cap waits so the panel never sits empty after we clear the loading shell.
    const loaded = await withDeadline(loadBuiltinManifest(), 4000);
    if (gen !== renderGen || !visible) return;
    builtinManifest = loaded || builtinManifest || [];

    pinnedOrder = (config.launcher.pinnedApps || []).slice();
    customApps = (config.launcher.customApps || []).map(function (entry) {
      return Object.assign({}, entry);
    });

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
    // Sections built below go to these (the AI Voice ones keep aiPane).
    const aiPane = panes.ai;

    // The one seam between this composition root and the category panes. The
    // root keeps panel state, the nav, the header and Save; a pane is built
    // with the context and gets its dependencies from that one argument.
    const context: SettingsContext = {
      config: effective,
      rawConfig: config,
      binder: binder,
      panes: panes,
      options: options,
      focusControl: focusSettingsControl,
      focusNow: focusSettingsControlNow,
      focusGallery: focusPhotoGallery,
      refocusListButton: refocusListButton,
      withDeadline: withDeadline,
      redraw: redrawAfterRestore
    };
    // Panes moved behind the seam, keyed by category id.
    const paneHandles: Record<string, PaneHandle> = {};

    // Declared before setSettingsTab so the early Home default cannot hit a TDZ.
    let saveBtn!: HTMLButtonElement;
    let aiStatusLabel!: HTMLParagraphElement;
    let aiApiKeyInput!: HTMLInputElement;
    let aiApiKeyHint!: HTMLParagraphElement;
    let aiApiKeyShowBtn!: HTMLButtonElement;
    let aiGeminiKeyInput!: HTMLInputElement;
    let aiGeminiKeyHint!: HTMLParagraphElement;
    let aiGeminiKeyShowBtn!: HTMLButtonElement;
    let aiOpenRouterKeyInput!: HTMLInputElement;
    let aiOpenRouterKeyHint!: HTMLParagraphElement;
    let aiOpenRouterKeyShowBtn!: HTMLButtonElement;
    let aiSttSelect!: OptionStepperElement;
    let aiChatSelect!: OptionStepperElement;
    let aiVoiceModelSelect!: OptionStepperElement;
    let aiGeminiModelSelect!: OptionStepperElement;
    let aiGeminiSttSelect!: OptionStepperElement;
    let aiOpenRouterModelSelect!: OptionStepperElement;
    let aiOpenRouterSttSelect!: OptionStepperElement;
    let aiDismissSelect!: OptionStepperElement;
    let aiProviderSelect!: ProviderPickerElement;
    let aiAuthModeSelect!: OptionStepperElement;
    let aiCreditBanner!: HTMLParagraphElement;
    let aiOauthStatus!: HTMLParagraphElement;
    let aiOauthCode!: HTMLParagraphElement;
    let aiOauthHint!: HTMLParagraphElement;
    let aiOauthQrWrap!: HTMLDivElement;
    let aiOauthModal!: HTMLDivElement;
    let aiOauthModalCancel!: HTMLButtonElement;
    let aiOauthSignInBtn!: HTMLButtonElement;
    let aiOauthImportBtn!: HTMLButtonElement;
    let aiOauthSignOutBtn!: HTMLButtonElement;
    let aiLoadedConfig!: VoicePayload;
    let lastAiStatus: VoicePayload | null = null;
    // Voice assistant on (launcher.voiceEnabled), an on/off in progress, and
    // retries while the daemon starts.
    let voiceOn = false;
    let voiceBusy = false;
    let aiRetryTimer: ReturnType<typeof setTimeout> | null = null;
    let aiLoadRetries = 0;
    let aiOauthInProgress = false;
    let aiOauthSawPending = false;
    let aiOauthLocalCode = '';
    let aiOauthLocalUri = '';
    let aiXaiKeyRevealed = false;
    let aiGeminiKeyRevealed = false;
    let aiOpenRouterKeyRevealed = false;
    // Key rows are referenced from syncAuthModeUi() before they are built.
    // Keep them as lets (not const) so an early call cannot TDZ-crash render.
    let xaiRow: KeyRow | null = null;
    let gemRow: KeyRow | null = null;
    let orRow: KeyRow | null = null;

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

    const aiStatusSection = createSection('Voice service');
    aiStatusLabel = createHint('Checking the voice service…', 'ai-status-line');
    aiStatusSection.appendChild(aiStatusLabel);
    aiCreditBanner = document.createElement('p');
    aiCreditBanner.className = 'ai-credit-banner';
    aiCreditBanner.hidden = true;
    aiStatusSection.appendChild(aiCreditBanner);
    aiStatusSection.appendChild(createHint(
      'Hold Voice on the Magic Remote to talk. Pick Grok, Gemini, or OpenRouter, add a key, then Save.'
    ));
    aiPane.appendChild(aiStatusSection);

    function makeKeyRow(label: string, focusIndex: number, placeholder: string): KeyRow {
      const field = createTextField({
        label: label,
        focusIndex: focusIndex,
        type: 'password',
        placeholder: placeholder || '',
        spellcheck: false,
        autocomplete: 'off'
      });
      field.row.classList.add('settings-key-row');
      const controls = document.createElement('div');
      controls.className = 'settings-key-controls';
      controls.appendChild(field.input);
      field.row.appendChild(controls);
      const showBtn = createMiniButton({label: 'Show', focusIndex: focusIndex + 1});
      controls.appendChild(showBtn);
      return {row: field.row, input: field.input, showBtn: showBtn};
    }

    const aiKeySection = createSection('API keys');
    aiAuthModeSelect = createOptionStepper({
      focusIndex: 1990,
      choices: [
        {value: 'API_KEY', label: 'Grok API key'},
        {value: 'SUPERGROK_OAUTH', label: 'SuperGrok sign-in'}
      ],
      value: 'API_KEY',
      onChange: function () {
        syncAuthModeUi();
        if (isSuperGrokMode()) paintOauthFromStatus({}, aiLoadedConfig);
      }
    });
    const authRow = labeledControl('Grok account', aiAuthModeSelect);
    aiKeySection.appendChild(authRow);
    const aiGrokUsing = document.createElement('p');
    aiGrokUsing.className = 'ai-using-badge';
    aiGrokUsing.hidden = true;
    aiKeySection.appendChild(aiGrokUsing);
    const authHint = createHint('Get a key at console.x.ai — stored only on this TV.');
    aiKeySection.appendChild(authHint);

    const oauthBox = document.createElement('div');
    oauthBox.hidden = true;
    aiOauthStatus = createHint('SuperGrok: not signed in');
    oauthBox.appendChild(aiOauthStatus);

    // Full-panel modal so the QR cannot be scrolled away, dismissed by a
    // stale "signed in" poll, or closed when the Magic Remote pointer
    // drifts onto Save / Close.
    aiOauthModal = document.createElement('div');
    aiOauthModal.className = 'ai-oauth-modal';
    aiOauthModal.hidden = true;
    aiOauthModal.setAttribute('role', 'dialog');
    aiOauthModal.setAttribute('aria-modal', 'true');
    aiOauthModal.setAttribute('aria-hidden', 'true');
    aiOauthModal.setAttribute('aria-label', 'SuperGrok sign-in');
    aiOauthModal.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
    });
    const oauthCard = document.createElement('div');
    oauthCard.className = 'ai-oauth-modal-card';
    oauthCard.addEventListener('click', function (event) {
      event.stopPropagation();
    });
    const oauthTitle = document.createElement('h3');
    oauthTitle.className = 'ai-oauth-modal-title';
    oauthTitle.textContent = 'Sign in with SuperGrok';
    oauthCard.appendChild(oauthTitle);
    aiOauthQrWrap = document.createElement('div');
    aiOauthQrWrap.className = 'ai-oauth-qr-wrap';
    aiOauthQrWrap.hidden = true;
    aiOauthQrWrap.setAttribute('aria-hidden', 'true');
    oauthCard.appendChild(aiOauthQrWrap);
    aiOauthCode = document.createElement('p');
    aiOauthCode.className = 'ai-oauth-code';
    aiOauthCode.hidden = true;
    oauthCard.appendChild(aiOauthCode);
    aiOauthHint = createHint('', 'ai-oauth-modal-hint');
    aiOauthHint.hidden = true;
    oauthCard.appendChild(aiOauthHint);
    aiOauthModalCancel = createMiniButton({
      label: 'Cancel sign-in',
      focusIndex: '1994',
      className: 'ai-oauth-modal-cancel'
    });
    oauthCard.appendChild(aiOauthModalCancel);
    aiOauthModal.appendChild(oauthCard);
    next.appendChild(aiOauthModal);

    function hideOauthQr(): void {
      if (aiOauthQrWrap) {
        aiOauthQrWrap.hidden = true;
        aiOauthQrWrap.setAttribute('aria-hidden', 'true');
        aiOauthQrWrap.innerHTML = '';
      }
      if (aiOauthCode) aiOauthCode.hidden = true;
      if (aiOauthHint) aiOauthHint.hidden = true;
      if (aiOauthModal) {
        aiOauthModal.hidden = true;
        aiOauthModal.setAttribute('aria-hidden', 'true');
      }
    }

    function showOauthQr(uri: string): void {
      if (!aiOauthQrWrap) return;
      const svg = qrSvgMarkup(uri);
      if (!svg) {
        aiOauthQrWrap.hidden = true;
        aiOauthQrWrap.setAttribute('aria-hidden', 'true');
        aiOauthQrWrap.innerHTML = '';
        return;
      }
      aiOauthQrWrap.innerHTML = svg;
      aiOauthQrWrap.hidden = false;
      aiOauthQrWrap.setAttribute('aria-hidden', 'false');
    }

    function isSuperGrokMode(): boolean {
      return !!(aiAuthModeSelect && aiAuthModeSelect.value === 'SUPERGROK_OAUTH');
    }

    function setBtnTone(btn: HTMLElement | null, tone: string): void {
      if (!btn) return;
      btn.classList.remove(
        'btn-tone-ok', 'btn-tone-warn', 'btn-tone-danger', 'btn-tone-quiet'
      );
      if (tone) btn.classList.add('btn-tone-' + tone);
    }

    function paintGrokUsing(kind: string, email?: string): void {
      const grok = typeof isGrokProvider === 'function' ? isGrokProvider() : true;
      if (!aiGrokUsing) return;
      if (!grok) {
        aiGrokUsing.hidden = true;
        return;
      }
      aiGrokUsing.hidden = false;
      if (kind === 'signed-in') {
        aiGrokUsing.className = 'ai-using-badge is-supergrok';
        aiGrokUsing.textContent = email
          ? ('Using SuperGrok · ' + email)
          : 'Using SuperGrok';
      } else if (kind === 'expired') {
        aiGrokUsing.className = 'ai-using-badge is-warn';
        aiGrokUsing.textContent = 'SuperGrok session expired — sign in again';
      } else if (kind === 'pending') {
        aiGrokUsing.className = 'ai-using-badge is-warn';
        aiGrokUsing.textContent = 'Waiting for SuperGrok approval';
      } else if (kind === 'signed-out') {
        aiGrokUsing.className = 'ai-using-badge is-warn';
        aiGrokUsing.textContent = 'SuperGrok — not signed in';
      } else {
        aiGrokUsing.className = 'ai-using-badge is-apikey';
        aiGrokUsing.textContent = 'Using Grok API key';
      }
    }

    function setOauthActionState(kind: string): void {
      if (!aiOauthSignInBtn || !aiOauthImportBtn || !aiOauthSignOutBtn) return;
      if (kind === 'signed-in') {
        aiOauthSignInBtn.textContent = 'Replace sign-in';
        setBtnTone(aiOauthSignInBtn, 'quiet');
        setBtnTone(aiOauthImportBtn, 'quiet');
        setBtnTone(aiOauthSignOutBtn, 'danger');
        aiOauthSignOutBtn.hidden = false;
        aiOauthImportBtn.hidden = false;
      } else if (kind === 'pending') {
        aiOauthSignInBtn.textContent = 'Cancel sign-in';
        setBtnTone(aiOauthSignInBtn, 'warn');
        setBtnTone(aiOauthImportBtn, 'quiet');
        aiOauthSignOutBtn.hidden = true;
        aiOauthImportBtn.hidden = true;
      } else if (kind === 'expired') {
        aiOauthSignInBtn.textContent = 'Sign in again';
        setBtnTone(aiOauthSignInBtn, 'ok');
        setBtnTone(aiOauthImportBtn, 'quiet');
        setBtnTone(aiOauthSignOutBtn, 'danger');
        aiOauthSignOutBtn.hidden = false;
        aiOauthImportBtn.hidden = false;
      } else {
        aiOauthSignInBtn.textContent = 'Sign in with SuperGrok';
        setBtnTone(aiOauthSignInBtn, 'ok');
        setBtnTone(aiOauthImportBtn, 'quiet');
        aiOauthSignOutBtn.hidden = true;
        aiOauthImportBtn.hidden = false;
      }
    }

    function showOauthPending(code?: string, uri?: string): void {
      if (!isSuperGrokMode() || !aiOauthStatus) {
        hideOauthQr();
        return;
      }
      const url = uri || 'https://accounts.x.ai/oauth2/device';
      aiOauthLocalCode = code || aiOauthLocalCode || '';
      aiOauthLocalUri = url;
      aiOauthStatus.textContent = 'Waiting for phone approval — keep this QR on screen';
      aiOauthStatus.className = 'settings-hint';
      if (aiOauthCode) {
        aiOauthCode.hidden = false;
        aiOauthCode.textContent = aiOauthLocalCode;
      }
      if (aiOauthHint) {
        aiOauthHint.hidden = false;
        aiOauthHint.textContent = 'Scan with your phone, or open ' + url +
          ' and enter the code. This stays open until you approve or cancel.';
      }
      showOauthQr(url);
      if (aiOauthModal) {
        aiOauthModal.hidden = false;
        aiOauthModal.setAttribute('aria-hidden', 'false');
      }
      if (aiOauthModalCancel && typeof aiOauthModalCancel.focus === 'function') {
        try { aiOauthModalCancel.focus(); } catch (err) { /* ignore */ }
        aiOauthModalCancel.classList.add('focused');
      }
      setOauthActionState('pending');
      paintGrokUsing('pending');
    }

    function syncAuthModeUi() {
      const heavy = isSuperGrokMode();
      const grok = typeof isGrokProvider === 'function' ? isGrokProvider() : true;
      if (oauthBox) oauthBox.hidden = !grok || !heavy;
      if (authHint) {
        authHint.hidden = !grok;
        authHint.textContent = heavy
          ? 'SuperGrok is an account sign-in (same as grok login). Green = sign in, red = sign out. The Grok API key is not used while SuperGrok is signed in.'
          : 'Using a Grok API key from console.x.ai. Switch Grok account to SuperGrok sign-in if you have a SuperGrok subscription instead.';
      }
      if (authRow) authRow.hidden = !grok;
      if (!heavy && grok) paintGrokUsing('apikey');
      if ((!heavy || !grok) && !aiOauthInProgress) {
        hideOauthQr();
        stopOauthPoll();
      }
      if (xaiRow && xaiRow.row && typeof syncProviderUi === 'function') {
        syncProviderUi();
      }
    }
    const oauthRow = document.createElement('div');
    oauthRow.className = 'ai-oauth-row';
    aiOauthSignInBtn = createMiniButton({
      label: 'Sign in with SuperGrok',
      focusIndex: '1991',
      className: 'btn-tone-ok'
    });
    aiOauthImportBtn = createMiniButton({
      label: 'Import login file',
      focusIndex: '1992',
      className: 'btn-tone-quiet'
    });
    aiOauthSignOutBtn = createMiniButton({
      label: 'Sign out',
      focusIndex: '1993',
      className: 'btn-tone-danger'
    });
    oauthRow.appendChild(aiOauthSignInBtn);
    oauthRow.appendChild(aiOauthImportBtn);
    oauthRow.appendChild(aiOauthSignOutBtn);
    oauthBox.appendChild(oauthRow);
    aiKeySection.appendChild(oauthBox);
    syncAuthModeUi();

    function stopOauthPoll(): void {
      if (aiOauthPollTimer) {
        clearInterval(aiOauthPollTimer);
        aiOauthPollTimer = null;
      }
    }

    function oauthPendingFrom(status: VoicePayload | null, cfg: VoicePayload | null): VoicePayload | null {
      return (status && status.oauthPending) || (cfg && cfg.oauth_pending) || null;
    }

    function isOauthPendingWaiting(pending: VoicePayload | null | undefined): boolean {
      if (!pending || !pending.userCode) return false;
      const st = String(pending.status || 'pending').toLowerCase();
      return !st || st === 'pending';
    }

    function paintSignedIn(email?: string): void {
      if (aiAuthModeSelect && aiAuthModeSelect.value !== 'SUPERGROK_OAUTH') {
        aiAuthModeSelect.value = 'SUPERGROK_OAUTH';
        if (typeof aiAuthModeSelect.setValue === 'function') {
          aiAuthModeSelect.setValue('SUPERGROK_OAUTH');
        }
        syncAuthModeUi();
      }
      aiOauthStatus.textContent = email
        ? ('Signed in as ' + email + ' — voice uses SuperGrok, not the API key')
        : 'Signed in — voice uses SuperGrok, not the API key';
      aiOauthStatus.className = 'settings-hint ai-status-ok';
      hideOauthQr();
      setOauthActionState('signed-in');
      paintGrokUsing('signed-in', email);
      stopOauthPoll();
    }

    function paintOauthFromStatus(status: VoicePayload, cfg: VoicePayload | null): void {
      syncAuthModeUi();
      // SuperGrok token / session warnings belong only on Grok + SuperGrok.
      if (!isGrokProvider() || !isSuperGrokMode()) return;
      const pending = oauthPendingFrom(status, cfg);
      const pendingWaiting = isOauthPendingWaiting(pending);
      if (pendingWaiting) aiOauthSawPending = true;
      const email = (status && status.oauthEmail) || (cfg && cfg.oauth_email) || '';
      const err = (status && status.oauthError) ||
        (pending && pending.error) ||
        (cfg && cfg.oauth_error) || '';
      const tokenExpired = !!(status && status.oauthTokenExpired) ||
        !!(cfg && cfg.oauth_token_expired);
      const signedIn = !tokenExpired && (
        !!(status && status.oauthSignedIn) || !!(cfg && cfg.oauth_signed_in)
      );
      // applyAiConfigToForm paints with {} — never treat that as "login done".
      const liveStatus = !!(status && (
        status.oauthSignedIn !== undefined ||
        status.oauthPending !== undefined ||
        status.daemonActive !== undefined
      ));

      // Device-code login in flight wins over a leftover oauth.json session.
      // Otherwise the 2s status poll hides the QR and claims "signed in".
      if (aiOauthInProgress || pendingWaiting) {
        if (liveStatus && aiOauthInProgress && aiOauthSawPending &&
            signedIn && !pendingWaiting) {
          aiOauthInProgress = false;
          paintSignedIn(email);
          return;
        }
        if (liveStatus && aiOauthInProgress && aiOauthSawPending &&
            !pendingWaiting && !signedIn) {
          aiOauthInProgress = false;
          hideOauthQr();
          aiOauthStatus.textContent = err
            ? ('SuperGrok: ' + err)
            : 'SuperGrok: sign-in did not complete';
          aiOauthStatus.className = 'settings-hint ai-status-warn';
          setOauthActionState('signed-out');
          paintGrokUsing('signed-out');
          stopOauthPoll();
          return;
        }
        showOauthPending(
          (pending && pending.userCode) || aiOauthLocalCode,
          (pending && pending.verificationUri) || aiOauthLocalUri ||
            'https://accounts.x.ai/oauth2/device'
        );
        return;
      }

      if (signedIn) {
        paintSignedIn(email);
      } else {
        aiOauthStatus.textContent = err
          ? ('SuperGrok: ' + err)
          : (tokenExpired
            ? 'SuperGrok session expired — sign in again to keep using SuperGrok'
            : 'Not signed in — use Sign in (green) or a Grok API key instead');
        aiOauthStatus.className = (err || tokenExpired)
          ? 'settings-hint ai-status-warn'
          : 'settings-hint';
        hideOauthQr();
        setOauthActionState(tokenExpired ? 'expired' : 'signed-out');
        paintGrokUsing(tokenExpired ? 'expired' : 'signed-out');
        stopOauthPoll();
      }
    }

    function pollOauthUntilDone(): void {
      stopOauthPoll();
      aiOauthPollTimer = setInterval(function () {
        if (!visible) {
          stopOauthPoll();
          return;
        }
        getVoiceStatus().then(function (status) {
          const pending = status && status.oauthPending;
          const stillWaiting = isOauthPendingWaiting(pending) ||
            (aiOauthInProgress && !aiOauthSawPending);
          const tokenExpired = !!(status && status.oauthTokenExpired);
          const signedIn = !!(status && status.oauthSignedIn) && !tokenExpired;
          paintOauthFromStatus(status || {}, aiLoadedConfig);
          if (signedIn && !stillWaiting && (!aiOauthInProgress || aiOauthSawPending)) {
            if (options.onToast) options.onToast('SuperGrok signed in');
            aiOauthInProgress = false;
            loadAiTab();
          }
        }).catch(function () { /* ignore */ });
      }, 2000);
    }

    function cancelOauthLogin(): void {
      aiOauthInProgress = false;
      aiOauthSawPending = false;
      hideOauthQr();
      stopOauthPoll();
      cancelSuperGrokLogin().then(function () {
        loadAiTab();
      }).catch(function (err) {
        if (options.onToast) options.onToast((err && err.message) || 'Cancel failed');
        loadAiTab();
      });
    }

    aiOauthSignInBtn.addEventListener('click', function () {
      const pending = aiLoadedConfig && aiLoadedConfig.oauth_pending;
      if (aiOauthInProgress ||
          aiOauthSignInBtn.textContent.indexOf('Cancel') === 0 ||
          isOauthPendingWaiting(pending)) {
        cancelOauthLogin();
        return;
      }
      aiOauthSignInBtn.disabled = true;
      aiOauthInProgress = true;
      aiOauthSawPending = false;
      startSuperGrokLogin().then(function (res) {
        aiOauthSignInBtn.disabled = false;
        const code = (res && res.userCode) || '';
        const uri = (res && res.verificationUri) || 'https://accounts.x.ai/oauth2/device';
        showOauthPending(code, uri);
        aiOauthSignInBtn.textContent = 'Cancel sign-in';
        if (code) aiOauthSawPending = true;
        if (options.onToast) options.onToast('SuperGrok code: ' + code);
        pollOauthUntilDone();
      }).catch(function (err) {
        aiOauthInProgress = false;
        aiOauthSignInBtn.disabled = false;
        hideOauthQr();
        if (options.onToast) {
          options.onToast((err && err.message) || 'Could not start SuperGrok sign-in');
        }
      });
    });
    if (aiOauthModalCancel) {
      aiOauthModalCancel.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        cancelOauthLogin();
      });
    }
    aiOauthImportBtn.addEventListener('click', function () {
      aiOauthImportBtn.disabled = true;
      importSuperGrokAuth().then(function (res) {
        aiOauthImportBtn.disabled = false;
        if (options.onToast) {
          options.onToast(res && res.email
            ? ('Imported SuperGrok for ' + res.email)
            : 'Imported SuperGrok session');
        }
        loadAiTab();
      }).catch(function (err) {
        aiOauthImportBtn.disabled = false;
        if (options.onToast) {
          options.onToast((err && err.message) ||
            'Copy ~/.grok/auth.json to /home/root/.grok/auth.json on the TV');
        }
      });
    });
    aiOauthSignOutBtn.addEventListener('click', function () {
      signOutSuperGrok().then(function () {
        if (aiAuthModeSelect) {
          aiAuthModeSelect.value = 'API_KEY';
          if (typeof aiAuthModeSelect.setValue === 'function') {
            aiAuthModeSelect.setValue('API_KEY');
          }
        }
        if (options.onToast) options.onToast('Signed out of SuperGrok');
        loadAiTab();
      }).catch(function (err) {
        if (options.onToast) options.onToast((err && err.message) || 'Sign out failed');
      });
    });

    xaiRow = makeKeyRow('Grok API key', 2001, 'xai-…');
    aiApiKeyInput = xaiRow.input;
    aiApiKeyShowBtn = xaiRow.showBtn;
    aiKeySection.appendChild(xaiRow.row);
    aiApiKeyHint = createHint(
      'Get a key at console.x.ai — stored only on this TV. Leave blank to keep the current key.'
    );
    aiKeySection.appendChild(aiApiKeyHint);

    gemRow = makeKeyRow('Gemini key', 2003, 'AIza…');
    aiGeminiKeyInput = gemRow.input;
    aiGeminiKeyShowBtn = gemRow.showBtn;
    aiKeySection.appendChild(gemRow.row);
    aiGeminiKeyHint = createHint(
      'Optional. Google AI Studio key (usually starts with AIza). Leave blank to keep current.'
    );
    aiKeySection.appendChild(aiGeminiKeyHint);

    orRow = makeKeyRow('OpenRouter key', 2005, 'sk-or-…');
    aiOpenRouterKeyInput = orRow.input;
    aiOpenRouterKeyShowBtn = orRow.showBtn;
    aiKeySection.appendChild(orRow.row);
    aiOpenRouterKeyHint = createHint(
      'Get a key at openrouter.ai — stored only on this TV. Leave blank to keep current.'
    );
    aiKeySection.appendChild(aiOpenRouterKeyHint);

    aiApiKeyShowBtn.addEventListener('click', function () {
      aiXaiKeyRevealed = !aiXaiKeyRevealed;
      const full = (aiLoadedConfig && aiLoadedConfig.xai_api_key_full) || '';
      const typed = (aiApiKeyInput.value || '').trim();
      if (aiXaiKeyRevealed) {
        aiApiKeyInput.type = 'text';
        if (!typed && full) aiApiKeyInput.value = full;
        aiApiKeyShowBtn.textContent = 'Hide';
      } else {
        aiApiKeyInput.type = 'password';
        if (full && aiApiKeyInput.value === full) aiApiKeyInput.value = '';
        aiApiKeyShowBtn.textContent = 'Show';
      }
    });
    aiGeminiKeyShowBtn.addEventListener('click', function () {
      aiGeminiKeyRevealed = !aiGeminiKeyRevealed;
      const full = (aiLoadedConfig && aiLoadedConfig.gemini_api_key_full) || '';
      const typed = (aiGeminiKeyInput.value || '').trim();
      if (aiGeminiKeyRevealed) {
        aiGeminiKeyInput.type = 'text';
        if (!typed && full) aiGeminiKeyInput.value = full;
        aiGeminiKeyShowBtn.textContent = 'Hide';
      } else {
        aiGeminiKeyInput.type = 'password';
        if (full && aiGeminiKeyInput.value === full) aiGeminiKeyInput.value = '';
        aiGeminiKeyShowBtn.textContent = 'Show';
      }
    });
    aiOpenRouterKeyShowBtn.addEventListener('click', function () {
      aiOpenRouterKeyRevealed = !aiOpenRouterKeyRevealed;
      const full = (aiLoadedConfig && aiLoadedConfig.openrouter_api_key_full) || '';
      const typed = (aiOpenRouterKeyInput.value || '').trim();
      if (aiOpenRouterKeyRevealed) {
        aiOpenRouterKeyInput.type = 'text';
        if (!typed && full) aiOpenRouterKeyInput.value = full;
        aiOpenRouterKeyShowBtn.textContent = 'Hide';
      } else {
        aiOpenRouterKeyInput.type = 'password';
        if (full && aiOpenRouterKeyInput.value === full) aiOpenRouterKeyInput.value = '';
        aiOpenRouterKeyShowBtn.textContent = 'Show';
      }
    });

    aiPane.appendChild(aiKeySection);

    const aiProviderSection = createSection('Assistant');
    const providerHint = createHint('Who listens and answers when you press Voice.');
    aiProviderSelect = createProviderPicker(1970, function () {
      syncProviderUi();
    });
    aiProviderSection.appendChild(aiProviderSelect);
    aiProviderSection.appendChild(providerHint);

    const aiVoiceSection = createSection('Voice & chat');
    aiSttSelect = createOptionStepper({
      focusIndex: 1973,
      choices: [],
      value: ''
    });
    aiVoiceSection.appendChild(labeledControl('Speech language', aiSttSelect));
    aiVoiceModelSelect = createOptionStepper({
      focusIndex: 1974,
      choices: [],
      value: ''
    });
    const aiVoiceModelRow = labeledControl('Voice model', aiVoiceModelSelect);
    aiVoiceSection.appendChild(aiVoiceModelRow);
    aiChatSelect = createOptionStepper({
      focusIndex: 1975,
      choices: [],
      value: ''
    });
    const aiChatModelRow = labeledControl('Chat model', aiChatSelect);
    aiVoiceSection.appendChild(aiChatModelRow);
    aiGeminiSttSelect = createOptionStepper({
      focusIndex: 1976,
      choices: [],
      value: ''
    });
    const aiGeminiSttRow = labeledControl('Listen model', aiGeminiSttSelect);
    aiVoiceSection.appendChild(aiGeminiSttRow);
    aiGeminiModelSelect = createOptionStepper({
      focusIndex: 1977,
      choices: [],
      value: ''
    });
    const aiGeminiModelRow = labeledControl('Answer model', aiGeminiModelSelect);
    aiVoiceSection.appendChild(aiGeminiModelRow);
    aiOpenRouterSttSelect = createOptionStepper({
      focusIndex: 1977,
      choices: [],
      value: ''
    });
    const aiOpenRouterSttRow = labeledControl('Listen model', aiOpenRouterSttSelect);
    aiVoiceSection.appendChild(aiOpenRouterSttRow);
    aiOpenRouterModelSelect = createOptionStepper({
      focusIndex: 1978,
      choices: [],
      value: ''
    });
    const aiOpenRouterModelRow = labeledControl('Answer model', aiOpenRouterModelSelect);
    aiVoiceSection.appendChild(aiOpenRouterModelRow);
    aiDismissSelect = createOptionStepper({
      focusIndex: 1979,
      choices: [
        {value: '6', label: '6 seconds'},
        {value: '8', label: '8 seconds'},
        {value: '10', label: '10 seconds'},
        {value: '12', label: '12 seconds'},
        {value: '20', label: '20 seconds'},
        {value: '30', label: '30 seconds'}
      ],
      value: '8'
    });
    aiVoiceSection.appendChild(labeledControl('Answer card auto-dismiss', aiDismissSelect));
    aiVoiceSection.appendChild(createHint(
      'Press Save after changes. Switching assistant or keys restarts the voice daemon.'
    ));

    function currentAiProvider(): string {
      const v = aiProviderSelect && aiProviderSelect.value;
      if (v === 'gemini' || v === 'openrouter') return v;
      return 'xai';
    }

    function isGrokProvider(): boolean {
      return currentAiProvider() === 'xai';
    }

    function isGeminiProvider(): boolean {
      return currentAiProvider() === 'gemini';
    }

    function isOpenRouterProvider(): boolean {
      return currentAiProvider() === 'openrouter';
    }

    function syncProviderUi(): void {
      const grok = isGrokProvider();
      const gemini = isGeminiProvider();
      const openrouter = isOpenRouterProvider();
      if (providerHint) {
        if (gemini) {
          providerHint.textContent =
            'Gemini listens and answers with the models below. Spoken replies use Gemini TTS.';
        } else if (openrouter) {
          providerHint.textContent =
            'OpenRouter listens with the speech-to-text model you pick, then answers with the chat model.';
        } else {
          providerHint.textContent =
            'Grok listens, answers, and can speak. Choose SuperGrok sign-in or a Grok API key under Grok account.';
        }
      }
      if (aiVoiceModelRow) aiVoiceModelRow.hidden = !grok;
      if (aiChatModelRow) aiChatModelRow.hidden = !grok;
      if (aiGeminiSttRow) aiGeminiSttRow.hidden = !gemini;
      if (aiGeminiModelRow) aiGeminiModelRow.hidden = !gemini;
      if (aiOpenRouterSttRow) aiOpenRouterSttRow.hidden = !openrouter;
      if (aiOpenRouterModelRow) aiOpenRouterModelRow.hidden = !openrouter;
      if (authRow) authRow.hidden = !grok;
      if (authHint) authHint.hidden = !grok;
      if (oauthBox) oauthBox.hidden = !grok || !isSuperGrokMode();
      const superGrok = grok && isSuperGrokMode();
      const showXaiKey = grok && !superGrok;
      if (xaiRow && xaiRow.row) {
        xaiRow.row.hidden = !showXaiKey;
        xaiRow.row.classList.remove('ai-key-inactive');
      }
      if (aiApiKeyHint) {
        aiApiKeyHint.hidden = !showXaiKey;
        if (showXaiKey) {
          const xaiConfigured = !!(aiLoadedConfig && (aiLoadedConfig.xai_api_key_configured ||
            (aiLoadedConfig.xai_api_key_masked && aiLoadedConfig.api_key_configured)));
          const xaiMasked = (aiLoadedConfig && aiLoadedConfig.xai_api_key_masked) || '';
          aiApiKeyHint.textContent = xaiConfigured
            ? ('Grok API key on file: ' + xaiMasked + ' — leave blank to keep it.')
            : 'Get a key at console.x.ai — stored only on this TV.';
        }
      }
      if (gemRow && gemRow.row) gemRow.row.hidden = !gemini;
      if (aiGeminiKeyHint) aiGeminiKeyHint.hidden = !gemini;
      if (orRow && orRow.row) orRow.row.hidden = !openrouter;
      if (aiOpenRouterKeyHint) aiOpenRouterKeyHint.hidden = !openrouter;
      if (grok && !isSuperGrokMode()) paintGrokUsing('apikey');
      if (aiGrokUsing) aiGrokUsing.hidden = !grok && aiGrokUsing.hidden;
      if (!grok && aiGrokUsing) aiGrokUsing.hidden = true;
      if (!grok && !aiOauthInProgress) {
        hideOauthQr();
        stopOauthPoll();
      }
      // Re-paint daemon status so leftover xAI credit/token errors hide as soon
      // as Gemini or OpenRouter is selected (even before Save).
      if (lastAiStatus != null || aiLoadedConfig) {
        paintVoiceStatus(aiLoadedConfig, lastAiStatus || {});
      }
    }

    // Voice assistant on/off. Launch Home installs and runs its own voice
    // daemon (voice/ in this app) as root; everything below talks to it, so
    // those sections only show while it is on.
    const aiPowerSection = createSection('Voice assistant');
    const aiPowerBtn = createMiniButton({
      label: '',
      focusIndex: '1960',
      className: 'settings-scan-btn'
    });
    aiPowerSection.appendChild(aiPowerBtn);
    const aiPowerStatus = createHint('', 'ai-status-line');
    aiPowerSection.appendChild(aiPowerStatus);
    const aiOtherVoice = document.createElement('p');
    aiOtherVoice.className = 'ai-credit-banner';
    aiOtherVoice.hidden = true;
    aiPowerSection.appendChild(aiOtherVoice);
    aiPowerSection.appendChild(createHint(
      'Answers the Voice button on the Magic Remote with Grok, Gemini or OpenRouter. ' +
      'It runs in the background as root (Homebrew Channel). Turning it off hands the ' +
      'button back to LG and keeps your keys and sign-in.'
    ));

    voiceOn = !!(config.launcher && config.launcher.voiceEnabled);

    function paintVoicePower(message?: string, kind?: string): void {
      aiPowerBtn.textContent = voiceBusy
        ? (voiceOn ? 'Turning off…' : 'Turning on…')
        : (voiceOn ? 'Turn off' : 'Turn on');
      aiPowerStatus.textContent = message || (voiceOn ? 'On' : 'Off');
      aiPowerStatus.className = 'settings-hint ai-status-line ' +
        (kind === 'err' ? 'ai-status-err' : (voiceOn ? 'ai-status-ok' : 'ai-status-warn'));
      [aiKeySection, aiProviderSection, aiVoiceSection, aiStatusSection].forEach(function (el) {
        el.hidden = !voiceOn;
      });
    }

    // VoxRelay (a separate project) answering the same button would clash.
    // Launch Home only reports it; it never stops or changes it.
    function paintOtherVoice(state: string): void {
      aiOtherVoice.hidden = !state;
      aiOtherVoice.textContent = state === 'running'
        ? 'VoxRelay is also running on this TV. Both answer the Voice button, so ' +
          'answers can clash. Launch Home leaves it alone: turn one of them off.'
        : (state === 'installed'
          ? 'VoxRelay is also installed on this TV. If it runs, both answer the Voice ' +
            'button. Launch Home leaves it alone.'
          : '');
    }

    // Saves just this setting: the panel's other edits still wait for Save.
    function persistVoiceEnabled(on: boolean): void {
      config.launcher.voiceEnabled = on;
      try {
        const stored = loadConfig();
        stored.launcher.voiceEnabled = on;
        saveConfig(stored);
      } catch (err) {
        console.error(err);
      }
      if (options.onVoiceEnabledChange) options.onVoiceEnabledChange(on);
    }

    aiPowerBtn.addEventListener('click', function () {
      if (voiceBusy) return;
      // Not disabled while busy: a disabled button drops focus.
      voiceBusy = true;
      const turningOn = !voiceOn;
      paintVoicePower(turningOn
        ? 'Turning on… the first time installs the voice card, up to a minute.'
        : 'Turning off…');
      (turningOn ? enableVoice() : disableVoice()).then(function (res) {
        voiceBusy = false;
        persistVoiceEnabled(turningOn);
        voiceOn = turningOn;
        paintOtherVoice(turningOn ? (res as import('@luna/luna.js').VoiceEnableResult).otherVoice : '');
        paintVoicePower(turningOn ? 'On' : 'Off. Your keys and sign-in are kept.');
        if (turningOn) loadAiTab();
      }, function (err) {
        voiceBusy = false;
        paintVoicePower((turningOn ? 'Could not turn on: ' : 'Could not turn off: ') +
          ((err && err.message) || 'it needs root (Homebrew Channel)'), 'err');
      });
    });

    // Voice assistant on/off first, then the Assistant choice (Grok, Gemini,
    // OpenRouter) with its API key / SuperGrok sign-in right underneath,
    // Voice & chat, and the service status.
    aiPane.insertBefore(aiVoiceSection, aiStatusSection);
    aiPane.insertBefore(aiKeySection, aiVoiceSection);
    aiPane.insertBefore(aiProviderSection, aiKeySection);
    aiPane.insertBefore(aiPowerSection, aiProviderSection);
    paintVoicePower();
    syncProviderUi();

    /**
     * Fill a picker from the voice service's own choices (config.options),
     * so Launch Home ships no model or language lists. The saved value is
     * always shown, even if the service no longer offers it.
     */
    function fillFromService(select: OptionStepperElement, key: string): void {
      if (!select || typeof select.setOptions !== 'function' || !aiLoadedConfig) return;
      const offered = (aiLoadedConfig.options && aiLoadedConfig.options[key]) || [];
      const list: StepperOption[] = offered.map(function (o: any) {
        return typeof o === 'object' && o
          ? {value: String(o.value), label: String(o.label || o.value)}
          : {value: String(o), label: String(o)};
      });
      let current = aiLoadedConfig[key] != null ? String(aiLoadedConfig[key]) : '';
      if (!current && list.length) current = list[0].value;
      if (current && !list.some(function (o) { return o.value === current; })) {
        list.unshift({value: current, label: current});
      }
      select.setOptions(list, current);
    }

    function applyAiConfigToForm(cfg: VoicePayload): void {
      aiLoadedConfig = cfg || {};
      aiXaiKeyRevealed = false;
      aiGeminiKeyRevealed = false;
      aiOpenRouterKeyRevealed = false;
      const xaiConfigured = !!(aiLoadedConfig.xai_api_key_configured ||
        (aiLoadedConfig.xai_api_key_masked && aiLoadedConfig.api_key_configured));
      const gemConfigured = !!aiLoadedConfig.gemini_api_key_configured ||
        !!(aiLoadedConfig.gemini_api_key_masked);
      const orConfigured = !!aiLoadedConfig.openrouter_api_key_configured ||
        !!(aiLoadedConfig.openrouter_api_key_masked);
      const xaiMasked = aiLoadedConfig.xai_api_key_masked || '';
      const gemMasked = aiLoadedConfig.gemini_api_key_masked || '';
      const orMasked = aiLoadedConfig.openrouter_api_key_masked || '';
      const provider = (aiLoadedConfig.ai_provider === 'gemini' ||
        aiLoadedConfig.ai_provider === 'openrouter')
        ? aiLoadedConfig.ai_provider
        : 'xai';
      aiApiKeyInput.type = 'password';
      aiApiKeyInput.value = '';
      aiApiKeyInput.placeholder = xaiConfigured ? (xaiMasked || '••••••••') : 'xai-…';
      aiApiKeyShowBtn.textContent = 'Show';
      aiApiKeyHint.textContent = xaiConfigured
        ? ('Grok API key on file: ' + xaiMasked + ' — leave blank to keep it.')
        : 'Get a key at console.x.ai — stored only on this TV.';
      if (aiProviderSelect) {
        aiProviderSelect.value = provider;
        if (typeof aiProviderSelect.setValue === 'function') {
          aiProviderSelect.setValue(provider);
        }
      }
      const authMode = ((aiLoadedConfig.oauth_signed_in &&
        !aiLoadedConfig.oauth_token_expired) && 'SUPERGROK_OAUTH') ||
        aiLoadedConfig.auth_mode || 'API_KEY';
      if (aiAuthModeSelect) {
        aiAuthModeSelect.value = authMode;
        if (typeof aiAuthModeSelect.setValue === 'function') {
          aiAuthModeSelect.setValue(authMode);
        }
      }
      fillFromService(aiGeminiModelSelect, 'gemini_model');
      fillFromService(aiGeminiSttSelect, 'gemini_stt_model');
      fillFromService(aiOpenRouterModelSelect, 'openrouter_model');
      fillFromService(aiOpenRouterSttSelect, 'openrouter_stt_model');
      syncAuthModeUi();
      if (typeof syncProviderUi === 'function') syncProviderUi();
      paintOauthFromStatus({}, aiLoadedConfig);
      aiGeminiKeyInput.type = 'password';
      aiGeminiKeyInput.value = '';
      aiGeminiKeyInput.placeholder = gemConfigured ? (gemMasked || '••••••••') : 'AIza…';
      aiGeminiKeyShowBtn.textContent = 'Show';
      aiGeminiKeyHint.textContent = gemConfigured
        ? ('Current Gemini key: ' + gemMasked + ' — leave blank to keep it')
        : 'Required for Gemini. Google AI Studio key (usually starts with AIza).';
      if (aiOpenRouterKeyInput) {
        aiOpenRouterKeyInput.type = 'password';
        aiOpenRouterKeyInput.value = '';
        aiOpenRouterKeyInput.placeholder = orConfigured ? (orMasked || '••••••••') : 'sk-or-…';
      }
      if (aiOpenRouterKeyShowBtn) aiOpenRouterKeyShowBtn.textContent = 'Show';
      if (aiOpenRouterKeyHint) {
        aiOpenRouterKeyHint.textContent = orConfigured
          ? ('Current OpenRouter key: ' + orMasked + ' — leave blank to keep it')
          : 'Required for OpenRouter. Get a key at openrouter.ai (usually starts with sk-or-).';
      }
      fillFromService(aiSttSelect, 'stt_language');
      fillFromService(aiChatSelect, 'chat_model');
      fillFromService(aiVoiceModelSelect, 'voice_model');
      let dismissN = Math.round(Number(aiLoadedConfig.overlay_auto_dismiss_sec));
      if (!isFinite(dismissN) || dismissN < 3) dismissN = 8;
      const dismiss = String(dismissN);
      aiDismissSelect.value = dismiss;
      if (typeof aiDismissSelect.setValue === 'function') aiDismissSelect.setValue(dismiss);
    }

    function paintVoiceStatus(cfg: VoicePayload, status: VoicePayload): void {
      if (!aiStatusLabel) return;
      cfg = cfg || {};
      status = status || {};
      const provider = currentAiProvider();
      const usingGemini = provider === 'gemini';
      const usingOpenRouter = provider === 'openrouter';
      const usingGrok = !usingGemini && !usingOpenRouter;
      // Leftover xAI errors (credits, spend limit, expired API tokens)
      // are Grok-only. Gemini / OpenRouter must not inherit it.
      const lastErr = usingGrok ? (status.lastXaiError || cfg.last_xai_error) : null;
      if (aiCreditBanner) {
        if (lastErr && lastErr.message) {
          aiCreditBanner.hidden = false;
          aiCreditBanner.textContent = lastErr.message;
        } else {
          aiCreditBanner.hidden = true;
          aiCreditBanner.textContent = '';
        }
      }
      const tokenExpired = !!(status.oauthTokenExpired || cfg.oauth_token_expired);
      const oauthOk = !tokenExpired &&
        !!(status.oauthSignedIn || cfg.oauth_signed_in);
      const ready = usingGemini
        ? !!cfg.gemini_api_key_configured
        : (usingOpenRouter
          ? !!cfg.openrouter_api_key_configured
          : !!(cfg.api_key_configured || oauthOk));
      if (lastErr && lastErr.message) {
        aiStatusLabel.textContent = lastErr.kind === 'credits'
          ? 'Voice blocked — xAI API credits / spend limit'
          : 'Voice blocked — xAI API error';
        aiStatusLabel.className = 'settings-hint ai-status-line ai-status-err';
      } else if (status.daemonActive) {
        aiStatusLabel.textContent = ready
          ? 'Voice daemon running — ready'
          : (usingGemini
            ? 'Daemon running — Gemini key still needed'
            : (usingOpenRouter
              ? 'Daemon running — OpenRouter key still needed'
              : 'Daemon running — API key or SuperGrok sign-in still needed'));
        aiStatusLabel.className = 'settings-hint ai-status-line ' +
          (ready ? 'ai-status-ok' : 'ai-status-warn');
      } else {
        aiStatusLabel.textContent = ready
          ? ((usingGemini ? 'Gemini' : (usingOpenRouter ? 'OpenRouter' : 'Signed in')) +
            ' configured — daemon not running (Save AI to restart)')
          : (usingGemini
            ? 'Voice service idle — add a Gemini key, then Save'
            : (usingOpenRouter
              ? 'Voice service idle — add an OpenRouter key, then Save'
              : 'Voice service idle — add an API key or SuperGrok sign-in, then Save'));
        aiStatusLabel.className = 'settings-hint ai-status-line ai-status-warn';
      }
    }

    function loadAiTab(isRetry?: boolean): void {
      if (aiRetryTimer !== null) clearTimeout(aiRetryTimer);
      if (isRetry !== true) aiLoadRetries = 0;
      if (!voiceOn) {
        // Off in this app's settings, but the daemon may still be running
        // (e.g. Launch Home was reinstalled): show what is really there.
        isVoiceRunning().then(function (running) {
          if (gen !== renderGen || !visible || voiceBusy || voiceOn || !running) return;
          persistVoiceEnabled(true);
          voiceOn = true;
          paintVoicePower();
          loadAiTab();
        }).catch(function () { /* not rooted / desktop preview */ });
        return;
      }
      Promise.all([
        getVoiceConfig().catch(function (err) { return {__error: err}; }),
        getVoiceStatus().catch(function () { return {}; })
      ]).then(function (results) {
        if (gen !== renderGen || !visible) return;
        const cfg = results[0] || {};
        const status = results[1] || {};
        if (cfg.__error) {
          lastAiStatus = null;
          if (aiCreditBanner) {
            aiCreditBanner.hidden = true;
            aiCreditBanner.textContent = '';
          }
          // Just turned on or restarting after Save: keep trying for a while.
          aiLoadRetries += 1;
          if (voiceOn && aiLoadRetries <= 10) {
            aiStatusLabel.textContent = 'Starting the voice assistant…';
            aiStatusLabel.className = 'settings-hint ai-status-line ai-status-warn';
            aiRetryTimer = setTimeout(function () { loadAiTab(true); }, 2500);
            return;
          }
          aiStatusLabel.textContent = 'The voice assistant is not answering. Turn it off and on ' +
            'again; its log is /tmp/launch-home-voice.log on the TV.';
          aiStatusLabel.className = 'settings-hint ai-status-line ai-status-err';
          return;
        }
        aiLoadRetries = 0;
        lastAiStatus = status;
        applyAiConfigToForm(cfg);
        paintOauthFromStatus(status, cfg);
        paintVoiceStatus(cfg, status);
      });
    }

    const profileSection = createSection('Profile');

    const profileSelect = createOptionStepper({
      focusIndex: 901,
      choices: PROFILE_OPTIONS.map(function (entry) {
        return {value: entry.id, label: entry.label};
      }),
      onChange: function (value) { syncProfileBackgroundNote(value); }
    });
    binder.bind(stepperField(profileSelect, 'profile'));
    profileSection.appendChild(labeledControl('Active profile', profileSelect));

    profileSection.appendChild(createHint(
      'Night lowers ambient volume and darkens the scrim. Cinema disables music and uses a dark gradient.'
    ));
    panes.look.appendChild(profileSection);

    const section = createSection('Background');

    const sourceSelect = createOptionStepper({
      focusIndex: 902,
      choices: [
        {value: 'preset', label: 'Gradient'},
        {value: 'animated-gradient', label: 'Animated Gradient'},
        {value: 'builtin', label: 'Built-in photos'},
        {value: 'usb', label: 'USB folder'},
        {value: 'url', label: 'Online URL (nature + anime)'},
        {value: 'aerial', label: 'Aerial videos (Apple)'}
      ],
      onChange: function (value) {
        syncFields({
          revealGallery: value === 'url' || value === 'builtin' || value === 'aerial'
        });
      }
    });
    binder.bind(stepperField(sourceSelect, 'background.source'));
    section.appendChild(labeledControl('Source', sourceSelect));

    // A profile with its own background (Cinema) overrides the Source above.
    // Unexplained, Save looked like it reset photos back to Gradient.
    const profileBgNote = createHint('');
    section.appendChild(profileBgNote);
    function syncProfileBackgroundNote(profileId: string): void {
      const overrides = getProfileOverrides(
        {profile: profileId, profiles: config.profiles} as Config);
      const forced = !!(overrides.background && overrides.background.source);
      const entry = PROFILE_OPTIONS.filter(function (p) { return p.id === profileId; })[0];
      profileBgNote.hidden = !forced;
      profileBgNote.textContent = forced
        ? 'The ' + (entry ? entry.label : profileId) + ' profile uses its own dark background, ' +
          'so this Source applies once Active profile is Default or Night.'
        : '';
    }
    syncProfileBackgroundNote(config.profile || 'default');

    const presetSelect = createOptionStepper({
      focusIndex: 903,
      choices: [
        {value: 'warm-gradient', label: 'Warm gradient'},
        {value: 'cool-gradient', label: 'Cool gradient'},
        {value: 'midnight', label: 'Midnight'},
        {value: 'ember', label: 'Ember'}
      ]
    });
    binder.bind(stepperField(presetSelect, 'background.preset'));
    // Only shown when Source is Gradient / Animated Gradient (not when Photo is set).
    const presetRow = labeledControl('Gradient style', presetSelect);
    section.appendChild(presetRow);

    const displaySelect = createOptionStepper({
      focusIndex: 904,
      choices: [
        {value: 'static', label: 'Single image'},
        {value: 'slideshow', label: 'Slideshow'}
      ],
      onChange: function () {
        syncFields();
      }
    });
    binder.bind(stepperField(displaySelect, 'background.mode'));
    const displayRow = labeledControl('Display', displaySelect);
    section.appendChild(displayRow);

    // Aerial Slideshow only: randomise the clip order.
    const bgShuffleField = createToggle({
      label: 'Shuffle clips',
      focusIndex: '936',
      path: 'background.shuffle'
    });
    const bgShuffleRow = bgShuffleField.row;
    binder.bind(bgShuffleField.field!);
    section.appendChild(bgShuffleRow);

    // Aerial clips (Apple) — title-only picker; the clips stream from Apple's
    // CDN, so there are no packaged thumbnails to show.
    let selectedAerialId = bg.aerial || (AERIAL_BACKGROUNDS[0] && AERIAL_BACKGROUNDS[0].id) || '';
    const aerialGallery = createGallery({
      heading: 'Choose an aerial clip (' + AERIAL_BACKGROUNDS.length + ' \u00b7 streams from Apple)',
      focusIndex: indexInRow('settings-photo', 0),
      gridClassName: 'aerial-picker-grid',
      selectedId: selectedAerialId,
      entries: AERIAL_BACKGROUNDS.map(function (entry) {
        return {id: entry.id, title: entry.title || entry.id, text: true};
      }),
      onSelect: function (id) {
        selectedAerialId = id || '';
        aerialGallery.markSelection(selectedAerialId);
      }
    });
    const aerialRow = aerialGallery.row;
    section.appendChild(aerialRow);

    aerialRow.appendChild(createHint(
      'Clips stream from Apple\u2019s network (nothing is packaged) and play muted, full-screen and looping. The TV must be online; if a clip will not play, the gradient above is used instead. ' +
      'Aerials are the heaviest background source (network plus continuous video decode), and Performance mode has no effect on video.'
    ));

    // Built-in photo gallery (thumbnails) — only visible when Source is Built-in photos.
    let selectedBuiltinId = bg.builtin || (builtinManifest[0] && builtinManifest[0].id) || '';
    const builtinGallery = createGallery({
      heading: 'Choose a built-in photo (~3840px, sharp on 4K)',
      focusIndex: indexInRow('settings-photo', 0),
      selectedId: selectedBuiltinId,
      entries: (builtinManifest || []).map(function (entry) {
        return {
          id: entry.id,
          title: entry.title || entry.id,
          // 480px thumbnails: decoding the full wallpapers for 200px tiles
          // stalled the panel on open and while scrolling past the gallery.
          sources: [
            builtinImageUrl('thumbs/' + entry.file),
            builtinImageUrl(entry.file),
            'assets/backgrounds/' + entry.file
          ]
        };
      }),
      onSelect: function (id) {
        selectedBuiltinId = id || '';
        builtinGallery.markSelection(selectedBuiltinId);
      }
    });
    const builtinRow = builtinGallery.row;
    builtinRow.appendChild(createHint(
      'Packaged at ~3840px for 4K TVs; Performance mode downloads 1920px copies. Arrows browse \u00b7 OK chooses the photo and moves on.'
    ));
    section.appendChild(builtinRow);

    const usbHint = createHint('USB path: lounge/backgrounds/ with images.json. For a single file, enter the filename below.');
    section.appendChild(usbHint);

    const usbField = createTextField({
      label: 'USB filename',
      focusIndex: '930',
      placeholder: 'living-room.jpg',
      path: 'background.file',
      trim: true
    });
    const usbFileRow = usbField.row;
    binder.bind(usbField.field!);
    section.appendChild(usbFileRow);

    // Match curated remote by saved id, else by URL, else default first entry.
    let initialRemote = bg.remote || '';
    if (!findRemoteBackgroundById(initialRemote)) {
      const byUrl = findRemoteBackgroundByUrl(bg.url);
      initialRemote = byUrl ? byUrl.id : (REMOTE_BACKGROUNDS[0] && REMOTE_BACKGROUNDS[0].id) || '';
    }
    // Empty string = custom typed URL (not a catalog entry).
    if (bg.url && !findRemoteBackgroundByUrl(bg.url) && !findRemoteBackgroundById(bg.remote)) {
      initialRemote = '';
    }

    const urlHint = createHint('Loads over the network (not stored in the app package). Choose a photo below (nature or anime), or pick Custom URL and paste any direct https image link (Unsplash, Pexels, Wallhaven, your own host). TV must be online. Slideshow with no URLs uses the curated set.');
    section.appendChild(urlHint);

    const urlField = createTextField({
      label: 'Image URL',
      focusIndex: '931',
      placeholder: 'https://images.unsplash.com/photo-…'
    });
    const urlInput = urlField.input;
    const urlRow = urlField.row;
    // Prefer saved URL; if empty and a catalog pick is selected, prefill that.
    const remotePrefill = findRemoteBackgroundById(initialRemote);
    urlInput.value = bg.url || (remotePrefill && remotePrefill.url) || '';
    // Derived init (a catalog pick prefills the field), so register the field
    // without reading the raw config over it.
    binder.add(textField(urlInput, 'background.url', {trim: true}));

    // Visual photo gallery (replaces text-only stepper) — D-pad pickable tiles.
    let selectedRemoteId = initialRemote;
    const customHint = document.createElement('span');
    customHint.className = 'photo-picker-custom-hint';
    customHint.textContent = 'Paste link below';
    customHint.style.pointerEvents = 'none';
    const customEntry: GalleryEntry = {
      id: '',
      title: 'Custom URL',
      className: 'photo-picker-custom',
      ariaLabel: 'Custom URL',
      extra: customHint,
      onSelect: function () {
        selectRemote('');
        try {
          urlInput.scrollIntoView({block: 'nearest', behavior: 'smooth'});
        } catch (err) {
          try { urlInput.scrollIntoView(true); } catch (err2) { /* ignore */ }
        }
        window.setTimeout(function () {
          beginSettingsTextEdit(urlInput);
        }, 120);
      }
    };
    const remoteGallery = createGallery({
      heading: 'Choose an online photo (' + REMOTE_BACKGROUNDS.length + ' network images · nature + anime)',
      focusIndex: indexInRow('settings-photo', 0),
      selectedId: selectedRemoteId,
      entries: REMOTE_BACKGROUNDS.map(function (entry): GalleryEntry {
        return {
          id: entry.id,
          title: entry.title || entry.id,
          sources: [remoteThumbUrl(entry.url)]
        };
      }).concat([customEntry]),
      onSelect: function (id) { selectRemote(id); }
    });
    const remoteRow = remoteGallery.row;
    function markRemoteSelection(): void {
      remoteGallery.markSelection(selectedRemoteId);
    }
    function selectRemote(id: string): void {
      selectedRemoteId = id || '';
      const picked = findRemoteBackgroundById(selectedRemoteId);
      if (picked) {
        urlInput.value = picked.url;
      }
      markRemoteSelection();
    }
    section.appendChild(remoteRow);

    // Keep remote id aligned when the user edits the URL by hand.
    // Under the field: whether the link loads as an image. A web page link
    // (an image host's page for the photo) was accepted and silently showed
    // nothing on the home screen.
    const urlStatus = createHint('', 'settings-url-status');
    urlStatus.hidden = true;
    let urlCheckTimer: ReturnType<typeof setTimeout> | null = null;
    let urlCheckGen = 0;
    function showUrlStatus(text: string, kind: string): void {
      urlStatus.textContent = text;
      urlStatus.hidden = !text;
      urlStatus.classList.toggle('is-ok', kind === 'ok');
      urlStatus.classList.toggle('is-error', kind === 'error');
    }
    function checkUrl() {
      const url = urlInput.value.trim();
      const gen = ++urlCheckGen;
      // A built-in online photo: known good.
      if (!url || findRemoteBackgroundByUrl(url)) {
        showUrlStatus('', '');
        return;
      }
      if (!/^https?:\/\//i.test(url)) {
        showUrlStatus('This needs a web link starting with https://', 'error');
        return;
      }
      showUrlStatus('Checking the link\u2026', '');
      const img = new Image();
      let settled = false;
      function done(ok: boolean) {
        if (settled || gen !== urlCheckGen) return;
        settled = true;
        if (ok) {
          showUrlStatus('The link loads as an image (' + img.naturalWidth + ' \u00d7 ' +
            img.naturalHeight + '). Press Save to use it.', 'ok');
        } else {
          showUrlStatus('That link didn\u2019t load as an image. Use the direct image link: it ' +
            'usually ends in .jpg or .png (on an image host, \u201cCopy image address\u201d or ' +
            '\u201cDirect link\u201d). A link to a web page about the photo won\u2019t work.', 'error');
        }
      }
      img.onload = function () { done(true); };
      img.onerror = function () { done(false); };
      setTimeout(function () { done(false); }, 20000);
      img.src = jpegForTv(url);
    }
    urlInput.addEventListener('input', function () {
      const match = findRemoteBackgroundByUrl(urlInput.value.trim());
      selectedRemoteId = match ? match.id : '';
      markRemoteSelection();
      if (urlCheckTimer !== null) clearTimeout(urlCheckTimer);
      urlCheckTimer = setTimeout(checkUrl, 800);
    });

    section.appendChild(urlRow);
    section.appendChild(urlStatus);
    // A saved link is checked when Settings opens, too.
    if (urlInput.value.trim()) checkUrl();

    // Gallery picks and the URL/remote-id alignment are derived fields.
    binder.hook(function (cfg) {
      cfg.background.builtin = selectedBuiltinId || '';
      cfg.background.aerial = selectedAerialId || '';
      // Online catalog is independent of built-in; only apply when source is url,
      // and keep the remote id aligned with a matching URL.
      cfg.background.remote = selectedRemoteId || '';
      if (cfg.background.url) {
        const match = findRemoteBackgroundByUrl(cfg.background.url);
        if (match) cfg.background.remote = match.id;
      } else if (selectedRemoteId) {
        const picked = findRemoteBackgroundById(selectedRemoteId);
        if (picked) {
          cfg.background.url = picked.url;
          cfg.background.remote = picked.id;
        }
      }
    });

    const urlsField = createTextField({
      label: 'Slideshow URLs',
      focusIndex: '932',
      textarea: true,
      rows: 4,
      block: true,
      placeholder: 'One https image URL per line (leave empty to use curated online set)',
      path: 'background.urls',
      parse: parseUrlList,
      format: function (value) { return Array.isArray(value) ? value.join('\n') : ''; }
    });
    const urlsRow = urlsField.row;
    binder.bind(urlsField.field!);
    section.appendChild(urlsRow);

    const intervalField = createTextField({
      label: 'Seconds per slide',
      focusIndex: '933',
      type: 'number',
      min: '30',
      max: '3600',
      step: '30',
      path: 'background.slideshowIntervalSec',
      parse: function (raw) { return Number(raw) || 300; },
      format: function (value) { return String(value || 300); }
    });
    const intervalRow = intervalField.row;
    binder.bind(intervalField.field!);
    section.appendChild(intervalRow);

    const kenBurnsField = createToggle({
      label: 'Slow zoom background',
      focusIndex: '934',
      path: 'background.kenBurns'
    });
    const kenBurnsRow = kenBurnsField.row;
    binder.bind(kenBurnsField.field!);
    section.appendChild(kenBurnsRow);
    const kenBurnsHint = createHint(
      'When on, the wallpaper slowly zooms in and drifts a little (like a calm slideshow). When off, the picture stays still. Photos only — not gradients. ' +
      'While the wallpaper moves, tiles and buttons are tinted instead of frosted glass: blurring a moving picture makes TVs stutter.'
    );
    section.appendChild(kenBurnsHint);

    const overlayField = createTextField({
      label: 'Overlay opacity',
      focusIndex: '935',
      type: 'range',
      className: 'focusable',
      min: '20',
      max: '60',
      path: 'background.overlayOpacity',
      parse: function (raw) { return Number(raw) / 100; },
      format: function (value) { return String(Math.round(Number(value || 0.45) * 100)); }
    });
    binder.bind(overlayField.field!);
    section.appendChild(overlayField.row);

    const oledNote = document.createElement('p');
    oledNote.className = 'oled-note';
    oledNote.textContent = 'On OLED TVs, prefer slideshow or gradients over a single static photo left on screen for long periods.';
    section.appendChild(oledNote);
    panes.look.appendChild(section);

    const refs = {
      displayRow: displayRow,
      bgShuffleRow: bgShuffleRow,
      aerialRow: aerialRow,
      builtinRow: builtinRow,
      usbHint: usbHint,
      usbFileRow: usbFileRow,
      remoteRow: remoteRow,
      urlHint: urlHint,
      urlRow: urlRow,
      urlsRow: urlsRow,
      intervalRow: intervalRow,
      kenBurnsRow: kenBurnsRow,
      kenBurnsHint: kenBurnsHint,
      displaySelect: displaySelect
    };

    function syncFields(opts?: SyncFieldsOptions): void {
      // Gradient style only applies to gradient sources — hide entirely for
      // photos (builtin/USB/URL) so a leftover "Warm gradient" is not confusing.
      const isGradientSource =
        sourceSelect.value === 'preset' || sourceSelect.value === 'animated-gradient';
      presetRow.hidden = !isGradientSource;
      syncBackgroundFields(sourceSelect.value, refs, opts);
    }

    syncFields();

    // Swap loading shell → full chrome now (profile + background already in body).
    // Remaining sections append to the live body so the user always sees content.
    panel.innerHTML = '';
    panel.appendChild(next);

    const music = normalizeMusicConfig(config.music);
    const builtinTracks: BuiltinMusicEntry[] =
      (await withDeadline(loadBuiltinMusicManifest(), 4000)) || [];

    if (gen !== renderGen || !visible) return;

    const musicSection = createSection('Music');

    const musicEnabledField = createToggle({
      label: 'Ambient music',
      focusIndex: '940',
      path: 'music.enabled'
    });
    binder.bind(musicEnabledField.field!);
    musicSection.appendChild(musicEnabledField.row);

    const showMusicBarField = createToggle({
      label: 'Show music bar',
      focusIndex: '9405',
      path: 'music.showBar'
    });
    binder.bind(showMusicBarField.field!);
    musicSection.appendChild(showMusicBarField.row);

    musicSection.appendChild(createHint(
      'When on, shows the track name next to the volume control. Off by default (volume only).'
    ));

    const musicSourceSelect = createOptionStepper({
      focusIndex: 941,
      choices: [
        {value: 'builtin', label: 'Built-in ambient (6 tracks)'},
        {value: 'usb', label: 'My tracks (USB)'}
      ],
      onChange: function () {
        syncMusicFields();
      }
    });
    binder.bind(stepperField(musicSourceSelect, 'music.source'));
    const musicSourceRow = labeledControl('Source', musicSourceSelect);
    musicSection.appendChild(musicSourceRow);

    // --- Built-in: multi-select which of the 8 packaged tracks to rotate ---
    const savedBuiltinPlaylist = Array.isArray(music.builtinPlaylist)
      ? music.builtinPlaylist.slice()
      : [];
    // Empty playlist in config means “all packaged tracks”.
    const builtinSelected: Record<string, boolean> = {};
    builtinTracks.forEach(function (entry) {
      builtinSelected[entry.id] = !savedBuiltinPlaylist.length
        || savedBuiltinPlaylist.indexOf(entry.id) >= 0;
    });

    const builtinPlaylistList = document.createElement('div');
    builtinPlaylistList.className = 'settings-track-list';
    const builtinPlaylistBlock = labeledBlock('Built-in tracks (tick to include)', builtinPlaylistList);

    builtinTracks.forEach(function (entry, index) {
      const row = document.createElement('div');
      row.className = 'settings-track-row';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'focusable';
      checkbox.dataset.focusIndex = String(942 + index);
      checkbox.checked = !!builtinSelected[entry.id];
      checkbox.addEventListener('change', function () {
        builtinSelected[entry.id] = checkbox.checked;
        // Keep “Start with” options in sync with enabled set.
        refreshBuiltinStartOptions();
      });

      const title = document.createElement('span');
      title.className = 'settings-track-title';
      const detail = entry.description ? ' — ' + entry.description : '';
      title.textContent = (entry.title || entry.id) + detail;

      row.appendChild(checkbox);
      row.appendChild(title);
      builtinPlaylistList.appendChild(row);
    });
    musicSection.appendChild(builtinPlaylistBlock);

    function enabledBuiltinIds(): string[] {
      return builtinTracks
        .map(function (entry) { return entry.id; })
        .filter(function (id) { return builtinSelected[id]; });
    }

    function builtinStartOptions(): StepperOption[] {
      const enabled = enabledBuiltinIds();
      const source = enabled.length
        ? builtinTracks.filter(function (e) { return enabled.indexOf(e.id) >= 0; })
        : builtinTracks;
      return source.map(function (entry) {
        return {value: entry.id, label: entry.title || entry.id};
      });
    }

    const builtinTrackSelect = createOptionStepper({
      focusIndex: 950,
      choices: builtinStartOptions()
    });
    binder.bind(stepperField(builtinTrackSelect, 'music.builtin'));
    const builtinTrackRow = labeledControl('Start with', builtinTrackSelect);
    musicSection.appendChild(builtinTrackRow);

    function refreshBuiltinStartOptions(): void {
      const opts = builtinStartOptions();
      let cur = builtinTrackSelect.value;
      const still = opts.some(function (o) { return o.value === cur; });
      if (!still && opts.length) cur = opts[0].value;
      builtinTrackSelect.setOptions(opts, cur || '');
    }

    // --- USB: folder + multi-select discovered tracks ---
    const musicFolderPicker = createOptionStepper({
      focusIndex: 951,
      choices: [
        {value: '', label: 'Custom path (type below)…'}
      ],
      value: '',
      onChange: function (value) {
        if (value) {
          musicPathInput.value = value;
          scanUsbTracks(value);
        }
      }
    });
    const musicFolderRow = labeledControl('Browse folders', musicFolderPicker);
    musicSection.appendChild(musicFolderRow);

    findLoungeRoots().then(function (roots) {
      const opts = [{value: '', label: 'Custom path (type below)…'}];
      roots.forEach(function (root) {
        opts.push({value: joinPath(root, 'music'), label: joinPath(root, 'music')});
        opts.push({value: joinPath(root, 'music'), label: joinPath(root, 'music')});
        opts.push({value: joinPath(root, 'music'), label: joinPath(root, 'music')});
      });

      if (opts.length === 1) {
        opts[0].label = 'No USB drives detected — type a path below';
      }
      musicFolderPicker.setOptions(opts, config.music.path || '');
    }).catch(function () {
      musicFolderPicker.setOptions(
        [{value: '', label: 'Could not scan USB drives — type a path below'}], '');
    });

    const musicPathField = createTextField({
      label: 'Music folder',
      focusIndex: '952',
      placeholder: 'e.g. /media/usb1/lounge/music',
      path: 'music.path',
      trim: true
    });
    const musicPathInput = musicPathField.input;
    const musicPathRow = musicPathField.row;
    binder.bind(musicPathField.field!);
    musicSection.appendChild(musicPathRow);

    musicPathInput.addEventListener('change', function () {
      musicFolderPicker.setValue(musicPathInput.value);
      scanUsbTracks(musicPathInput.value.trim());
    });
    musicPathInput.addEventListener('blur', function () {
      scanUsbTracks(musicPathInput.value.trim());
    });

    const usbPlaylistList = document.createElement('div');
    usbPlaylistList.className = 'settings-track-list';
    const usbPlaylistBlock = labeledBlock('USB tracks (tick to include)', usbPlaylistList);

    const usbScanStatus = createHint('Set a folder with playlist.m3u or tracks.json, then scan.');
    usbPlaylistBlock.insertBefore(usbScanStatus, usbPlaylistList);
    musicSection.appendChild(usbPlaylistBlock);

    // url -> checked
    const usbSelected: Record<string, boolean> = {};
    const savedUsb = Array.isArray(music.usbPlaylist) ? music.usbPlaylist : [];
    let usbTrackEntries: UsbTrack[] = [];

    function renderUsbTrackList(entries: UsbTrack[]): void {
      usbTrackEntries = entries || [];
      usbPlaylistList.innerHTML = '';
      if (!usbTrackEntries.length) {
        usbScanStatus.textContent = musicPathInput.value.trim()
          ? 'No tracks found. Add playlist.m3u or tracks.json in that folder.'
          : 'Set a USB music folder to load your tracks.';
        return;
      }
      usbScanStatus.textContent = usbTrackEntries.length + ' track(s) found — tick the ones to play.';
      const hadSaved = savedUsb.length > 0;
      usbTrackEntries.forEach(function (entry, index) {
        const url = entry.url || '';
        if (usbSelected[url] === undefined) {
          usbSelected[url] = !hadSaved || savedUsb.indexOf(url) >= 0;
        }
        const row = document.createElement('div');
        row.className = 'settings-track-row';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'focusable';
        checkbox.dataset.focusIndex = String(960 + index);
        checkbox.checked = !!usbSelected[url];
        checkbox.addEventListener('change', function () {
          usbSelected[url] = checkbox.checked;
        });

        const title = document.createElement('span');
        title.className = 'settings-track-title';
        if (entry.artist && entry.title) {
          title.textContent = entry.artist + ' — ' + entry.title;
        } else if (entry.title) {
          title.textContent = entry.title;
        } else {
          const parts = String(url).split('/');
          title.textContent = (parts[parts.length - 1] || url).replace(/\.[^.]+$/, '');
        }

        row.appendChild(checkbox);
        row.appendChild(title);
        usbPlaylistList.appendChild(row);
      });
      if (options.onRendered) options.onRendered();
    }

    let usbScanGen = 0;
    function scanUsbTracks(folder: string): void {
      const gen = (usbScanGen += 1);
      if (!folder) {
        renderUsbTrackList([]);
        return;
      }
      usbScanStatus.textContent = 'Scanning USB music…';
      withDeadline(discoverMusicTracks(folder), 5000).then(function (list) {
        if (gen !== usbScanGen || !visible) return;
        renderUsbTrackList((list || []) as UsbTrack[]);
      });
    }

    if (music.path) {
      scanUsbTracks(music.path);
    }

    const shuffleField = createToggle({
      label: 'Shuffle',
      focusIndex: '990',
      path: 'music.shuffle'
    });
    const shuffleRow = shuffleField.row;
    binder.bind(shuffleField.field!);
    musicSection.appendChild(shuffleRow);

    const repeatSelect = createOptionStepper({
      focusIndex: 991,
      choices: [
        {value: 'all', label: 'Repeat all'},
        {value: 'one', label: 'Repeat one'},
        {value: 'off', label: 'Play once'}
      ]
    });
    binder.bind(stepperField(repeatSelect, 'music.repeat'));
    const repeatRow = labeledControl('Repeat', repeatSelect);
    musicSection.appendChild(repeatRow);

    const musicVolumeField = createTextField({
      label: 'Ambient volume',
      focusIndex: '992',
      type: 'range',
      className: 'focusable',
      min: '0',
      max: '50',
      path: 'music.volume',
      parse: function (raw) { return Number(raw) / 100; },
      format: function (value) { return String(Math.round(Number(value || 0.15) * 100)); }
    });
    binder.bind(musicVolumeField.field!);
    musicSection.appendChild(musicVolumeField.row);

    musicSection.appendChild(createHint(
      'Six built-in tracks ship in the app (48 kbps ambient, CC0 / CC BY). If music is silent at launch, press any remote key once (autoplay unlock). Red = pause, Green = skip. USB: Source → My tracks for more.'
    ));

    function syncMusicFields(): void {
      const isBuiltin = musicSourceSelect.value === 'builtin';
      builtinPlaylistBlock.hidden = !isBuiltin;
      builtinTrackRow.hidden = !isBuiltin;
      musicFolderRow.hidden = isBuiltin;
      musicPathRow.hidden = isBuiltin;
      usbPlaylistBlock.hidden = isBuiltin;
      // Shuffle/repeat apply to multi-track playlists (built-in or USB).
      shuffleRow.hidden = false;
      repeatRow.hidden = false;
    }

    syncMusicFields();
    // The playlists come from the tick boxes, not a plain control.
    binder.hook(function (cfg) {
      // Empty array = all built-ins; otherwise only ticked ids.
      let pickedBuiltin = enabledBuiltinIds();
      if (!pickedBuiltin.length && builtinTracks.length) {
        // Don't allow empty playlist — keep the start track (or first).
        pickedBuiltin = [builtinTrackSelect.value || builtinTracks[0].id];
      }
      cfg.music.builtinPlaylist =
        pickedBuiltin.length === builtinTracks.length ? [] : pickedBuiltin;

      // Empty = all USB tracks found; otherwise only ticked urls.
      let pickedUsb: string[] = [];
      usbTrackEntries.forEach(function (entry) {
        const url = entry && entry.url;
        if (url && usbSelected[url]) pickedUsb.push(url);
      });
      if (!pickedUsb.length && usbTrackEntries.length) {
        pickedUsb = [usbTrackEntries[0].url];
      }
      cfg.music.usbPlaylist =
        usbTrackEntries.length && pickedUsb.length === usbTrackEntries.length
          ? []
          : pickedUsb;
    });
    panes.music.appendChild(musicSection);

    // The old Launcher section, now three: System (volume levels, then
    // Performance mode, Home button, boot), Screensaver, and Clock & icons in
    // Look. `launcherSection` is pointed at each in turn as controls are built.
    const systemSection = createSection('System');
    const screensaverSection = createSection('Screensaver');
    const clockSection = createSection('Clock & icons');
    let launcherSection = systemSection;

    // TV system volume levels (0–100), separate from ambient music slider.
    // '' = "Don't change": leave whatever the remote set (stored as null).
    function volumeLevelValue(level: number | null): string {
      return typeof level === 'number' ? String(level) : '';
    }

    function volumeLevelParse(raw: string): number | null {
      const level = parseInt(raw, 10);
      return isNaN(level) ? null : level;
    }

    function volumeLevelOptions(selected: string): StepperOption[] {
      const opts: StepperOption[] = [{value: '', label: 'Don’t change'}];
      for (let v = 0; v <= 30; v += 1) {
        opts.push({value: String(v), label: String(v)});
      }
      // Also offer a few higher steps for loud setups.
      [35, 40, 45, 50, 60, 70, 80, 90, 100].forEach(function (v) {
        opts.push({value: String(v), label: String(v)});
      });
      if (!opts.some(function (o) { return o.value === selected; })) {
        opts.splice(1, 0, {value: selected, label: selected});
      }
      return opts;
    }

    const volumeAtHomeValue = volumeLevelValue(config.launcher.volumeAtHome);
    const volumeAtHomeSelect = createOptionStepper({
      focusIndex: 993,
      choices: volumeLevelOptions(volumeAtHomeValue)
    });
    binder.bind(stepperField(volumeAtHomeSelect, 'launcher.volumeAtHome', {
      parse: volumeLevelParse
    }));
    launcherSection.appendChild(labeledControl('Volume in Launch Home', volumeAtHomeSelect));

    const volumeOnAppValue = volumeLevelValue(config.launcher.volumeOnAppLaunch);
    const volumeOnAppSelect = createOptionStepper({
      focusIndex: 994,
      choices: volumeLevelOptions(volumeOnAppValue)
    });
    binder.bind(stepperField(volumeOnAppSelect, 'launcher.volumeOnAppLaunch', {
      parse: volumeLevelParse
    }));
    launcherSection.appendChild(labeledControl('Volume when apps launch', volumeOnAppSelect));

    launcherSection.appendChild(createHint(
      'TV system volume (0–100). “Don’t change” keeps whatever you set with the remote. Otherwise Launch Home switches to the first level when you return home, and the second when Netflix / HDMI / other apps launch.'
    ));

    // ── Launch Home (in-app) screensaver ──────────────────────────────
    launcherSection = screensaverSection;
    const customSsField = createToggle({
      label: 'Launch Home screensaver',
      focusIndex: '990',
      path: 'launcher.customScreensaver'
    });
    binder.bind(customSsField.field!);
    launcherSection.appendChild(customSsField.row);

    const customSsIdle = createOptionStepper({
      focusIndex: 991,
      choices: [
        {value: '2', label: '2 minutes'},
        {value: '5', label: '5 minutes'},
        {value: '10', label: '10 minutes'},
        {value: '15', label: '15 minutes'},
        {value: '20', label: '20 minutes'},
        {value: '30', label: '30 minutes'},
        {value: '45', label: '45 minutes'},
        {value: '60', label: '60 minutes'}
      ]
    });
    binder.bind(stepperField(customSsIdle, 'launcher.customScreensaverMinutes', {
      parse: function (raw) {
        const n = parseInt(raw, 10);
        return isNaN(n) || n < 1 ? 5 : n;
      }
    }));
    launcherSection.appendChild(labeledControl('Start after (idle)', customSsIdle));

    const customSsSlide = createOptionStepper({
      focusIndex: 992,
      choices: [
        {value: '12', label: '12 seconds'},
        {value: '20', label: '20 seconds'},
        {value: '30', label: '30 seconds'},
        {value: '45', label: '45 seconds'},
        {value: '60', label: '1 minute'},
        {value: '120', label: '2 minutes'}
      ]
    });
    binder.bind(stepperField(customSsSlide, 'launcher.customScreensaverSlideSec', {
      parse: function (raw) {
        const n = parseInt(raw, 10);
        return isNaN(n) || n < 8 ? 20 : n;
      }
    }));
    launcherSection.appendChild(labeledControl('Photo change every', customSsSlide));

    const customSsClockField = createToggle({
      label: 'Screensaver clock',
      focusIndex: '993',
      path: 'launcher.customScreensaverShowClock'
    });
    binder.bind(customSsClockField.field!);
    launcherSection.appendChild(customSsClockField.row);

    const customSsDateField = createToggle({
      label: 'Screensaver date',
      focusIndex: '994',
      path: 'launcher.customScreensaverShowDate'
    });
    binder.bind(customSsDateField.field!);
    launcherSection.appendChild(customSsDateField.row);

    launcherSection.appendChild(createHint(
      'Full-screen photo slideshow from your Launch Home wallpapers while this app is open. Any remote button wakes. Uses Ken Burns motion for OLED care.'
    ));

    // Preview over the open panel. Closing Settings first threw away any
    // unsaved changes; the saver sits above it and hands focus back here.
    launcherSection.appendChild(createMiniButton({
      label: 'Preview screensaver now',
      focusIndex: '996',
      className: 'settings-preview-ss-btn',
      onClick: function () {
        if (options.onPreviewScreensaver) {
          options.onPreviewScreensaver();
        } else if (options.onToast) {
          options.onToast('Save & reopen Launch Home to preview');
        }
      }
    }));

    // System LG gallery saver (rooted write). Pushed to 30 min when custom is on.
    const ssMins = coerceScreensaverMinutes(
      typeof config.launcher.screensaverMinutes === 'number'
        ? config.launcher.screensaverMinutes
        : 30
    );
    const screensaverSelect = createOptionStepper({
      focusIndex: 995,
      choices: [
        {value: '0', label: 'Off (never)'},
        {value: '3', label: '3 minutes'},
        {value: '10', label: '10 minutes'},
        {value: '20', label: '20 minutes'},
        {value: '30', label: '30 minutes'}
      ],
      value: String(ssMins)
    });
    // The TV enum is coerced, and the value is raised past the in-app saver.
    binder.add(stepperField(screensaverSelect, 'launcher.screensaverMinutes', {
      parse: function (raw) { return parseInt(raw, 10); }
    }));
    binder.hook(function (cfg) {
      cfg.launcher.screensaverMinutes = coerceScreensaverMinutes(cfg.launcher.screensaverMinutes);
      // Keep system saver from firing before the in-app one.
      if (cfg.launcher.customScreensaver &&
          cfg.launcher.screensaverMinutes > 0 &&
          cfg.launcher.screensaverMinutes < 30) {
        cfg.launcher.screensaverMinutes = 30;
      }
    });
    launcherSection.appendChild(labeledControl('TV system screensaver', screensaverSelect));

    launcherSection.appendChild(createHint(
      'LG system gallery timeout (3/10/20/30 min only). When Launch Home screensaver is on, leave this at 30 so the TV does not interrupt first. Requires rooted TV.'
    ));

    launcherSection = clockSection;
    const showClockField = createToggle({
      label: 'Show clock',
      focusIndex: '1000',
      path: 'launcher.showClock'
    });
    binder.bind(showClockField.field!);
    launcherSection.appendChild(showClockField.row);

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
    launcherSection.appendChild(labeledControl('Clock format', clockFormatSelect));

    const showDateField = createToggle({
      label: 'Show date',
      focusIndex: '1001',
      path: 'launcher.showDate'
    });
    binder.bind(showDateField.field!);
    launcherSection.appendChild(showDateField.row);

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
    launcherSection.appendChild(labeledControl('Clock position', clockAlignSelect));

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
    launcherSection.appendChild(labeledControl('Clock size', clockSizeSelect));

    const timezoneSelect = createOptionStepper({
      focusIndex: 1004,
      choices: TIMEZONE_OPTIONS.map(function (option) {
        return {value: option.value, label: option.label};
      })
    });
    binder.bind(stepperField(timezoneSelect, 'launcher.timezone'));
    launcherSection.appendChild(labeledControl('Timezone', timezoneSelect));

    const iconSizeSelect = createOptionStepper({
      focusIndex: 1005,
      choices: [
        {value: 'small', label: 'Small'},
        {value: 'medium', label: 'Medium'},
        {value: 'large', label: 'Large'}
      ]
    });
    binder.bind(stepperField(iconSizeSelect, 'launcher.iconSize'));
    launcherSection.appendChild(labeledControl('Icon size', iconSizeSelect));

    const iconAlignSelect = createOptionStepper({
      focusIndex: 1006,
      choices: [
        {value: 'left', label: 'Left'},
        {value: 'center', label: 'Centre'},
        {value: 'right', label: 'Right'}
      ]
    });
    binder.bind(stepperField(iconAlignSelect, 'launcher.iconAlign'));
    launcherSection.appendChild(labeledControl('Icon alignment', iconAlignSelect));

    const iconLayoutSelect = createOptionStepper({
      focusIndex: 1007,
      choices: [
        {value: 'scroll', label: 'Scroll one row'},
        {value: 'wrap', label: 'Stacked rows'}
      ]
    });
    binder.bind(stepperField(iconLayoutSelect, 'launcher.iconLayout'));
    launcherSection.appendChild(labeledControl('Icon layout', iconLayoutSelect));

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
    launcherSection.appendChild(labeledControl('Icons per row (scroll mode)', iconsPerRowSelect));

    const bundledIconsField = createToggle({
      label: 'Use Launch Home app icons',
      focusIndex: '1008',
      path: 'launcher.bundledIcons'
    });
    binder.bind(bundledIconsField.field!);
    launcherSection.appendChild(bundledIconsField.row);

    launcherSection.appendChild(createHint(
      'Off = each app’s own icon from the TV (Netflix, YouTube, TV Settings, …). Reading the TV’s icons needs root; apps without one keep the Launch Home icon.'
    ));

    launcherSection = systemSection;
    const perfModeField = createToggle({
      label: 'Performance mode (low-spec TVs)',
      focusIndex: '1009',
      path: 'launcher.perfMode'
    });
    binder.bind(perfModeField.field!);
    launcherSection.appendChild(perfModeField.row);
    launcherSection.appendChild(createHint(
      'Turns off the frosted glass and uses 1920px wallpapers. ' +
      'With Slow zoom on (Look), the glass is already off while the wallpaper moves.'
    ));

    // Off by default: when enabled, stock Home coming to the foreground
    // (Home button press after another app, or an app exiting to home)
    // relaunches Launch Home.
    const launchOnHomeField = createToggle({
      label: 'Launch on Home button',
      focusIndex: '1010',
      checked: !!(config.launcher.launchOnHome || config.launcher.returnOnAppExit)
    });
    const launchOnHomeToggle = launchOnHomeField.input;
    launcherSection.appendChild(launchOnHomeField.row);
    // The legacy key stays in sync so older builds / USB config still work.
    binder.add(toggleField(launchOnHomeToggle, 'launcher.launchOnHome'));
    binder.hook(function (cfg) {
      cfg.launcher.returnOnAppExit = cfg.launcher.launchOnHome;
    });

    launcherSection.appendChild(createHint(
      'When enabled, a root service opens Launch Home whenever stock Home appears. A brief flash of the LG home screen is normal (the TV opens Home first; we cannot block the key without a separate input-hook app). Requires rooted TV + Homebrew Channel. Toggle off/on and Save after updates if it stops working.'
    ));

    const bootField = createToggle({
      label: 'Boot on TV start',
      focusIndex: '1011',
      path: 'launcher.bootOnStart'
    });
    binder.bind(bootField.field!);
    launcherSection.appendChild(bootField.row);

    launcherSection.appendChild(createHint(
      'When enabled, a root init.d script launches Launch Home after the TV powers on. Requires rooted TV + Homebrew Channel (same as Home button). A short delay on boot is normal while webOS starts. With Quick Start+ on, the TV only wakes from standby and this doesn’t run; turn it off under General → Devices → TV Management.'
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
    panes.screensaver.appendChild(screensaverSection);
    panes.system.appendChild(systemSection);

    // ── Weather (today + 4 days on the home screen) ─────────────────────
    const weatherPane = createWeatherPane();
    paneHandles.weather = weatherPane;
    weatherPane.build(context);

    // ── Inputs & channels ───────────────────────────────────────────────
    const inputsPane = createInputsPane();
    paneHandles.inputs = inputsPane;
    inputsPane.build(context);

    const appsSection = createSection('Pinned apps');
    appsSection.appendChild(createHint('Reorder or remove apps pinned to the home row.'));

    // All apps: a tile on the home row that opens every app on the TV.
    const allAppsTileField = createToggle({
      label: 'All apps tile on the home row',
      focusIndex: '1190',
      path: 'launcher.allAppsTile'
    });
    binder.bind(allAppsTileField.field!);
    appsSection.appendChild(allAppsTileField.row);
    appsSection.appendChild(createHint(
      'Opens a grid of every app on the TV: open any app without pinning it here.'
    ));

    // Number keys: press 1-9 on the remote to open the home row tile at that
    // position (apps.js numbers the tiles and launches by number).
    const numberKeyField = createToggle({
      label: 'Number keys open home row tiles',
      focusIndex: '1191',
      path: 'launcher.numberKeyLaunch'
    });
    binder.bind(numberKeyField.field!);
    appsSection.appendChild(numberKeyField.row);
    appsSection.appendChild(createHint(
      'Press 1\u20139 on the remote to open the tile at that position ' +
      '(1 is the first); each tile shows its number.'
    ));

    const pinnedList = document.createElement('div');
    pinnedList.className = 'settings-pinned-list';
    appsSection.appendChild(pinnedList);

    const addHeading = document.createElement('h4');
    addHeading.className = 'settings-subheading';
    addHeading.textContent = 'Add an app';
    appsSection.appendChild(addHeading);

    appsSection.appendChild(createHint(
      'Add every app from LG\u2019s home screen at once, or open the list and ' +
      'press + next to an app to pin it to the home row.'
    ));

    // Every app on LG's own home screen in one press, in LG's order, after
    // the ones already here (instead of adding them one by one).
    const importLgBtn = createMiniButton({
      label: 'Add all apps from LG\u2019s home screen',
      focusIndex: '1298'
    });
    appsSection.appendChild(importLgBtn);
    const importLgStatus = createHint('');
    importLgStatus.hidden = true;
    appsSection.appendChild(importLgStatus);
    let importingLg = false;
    importLgBtn.addEventListener('click', async function () {
      if (importingLg) return;
      importingLg = true;
      // Not disabled while busy: a disabled button drops focus.
      importLgBtn.textContent = 'Reading LG\u2019s home screen\u2026';
      importLgStatus.hidden = false;
      importLgStatus.textContent = '';
      try {
        const points = await listLaunchPoints();
        // Their names and icons, for when the TV can't be asked later.
        rememberApps(points);
        if (!points.length) {
          importLgStatus.textContent = 'Couldn\u2019t read LG\u2019s home screen. It needs root ' +
            '(Homebrew Channel).';
          return;
        }
        const toAdd = lgHomeAppsToAdd(points, pinnedOrder, customApps);
        if (!toAdd.length) {
          importLgStatus.textContent = 'Every app on LG\u2019s home screen is already here.';
          return;
        }
        toAdd.forEach(function (id) { pinnedOrder.push(id); });
        await loadAppsLists(pinnedList, addAppsList, config);
        importLgStatus.textContent = 'Added ' + toAdd.length + (toAdd.length === 1 ? ' app' : ' apps') +
          ' from LG\u2019s home screen, in LG\u2019s order, after the ones you had. Remove or move ' +
          'any of them above, then press Save to keep them.';
      } catch (err: any) {
        importLgStatus.textContent = 'Couldn\u2019t read LG\u2019s home screen: ' +
          ((err && err.message) || 'it needs root (Homebrew Channel)');
      } finally {
        importingLg = false;
        importLgBtn.textContent = 'Add all apps from LG\u2019s home screen';
      }
    });

    // Collapsed by default: with root this lists every installed app, and
    // scrolling past it was the only way to reach the sections below.
    const addAppsToggle = createMiniButton({
      label: '',
      focusIndex: '1299',
      className: 'settings-apps-toggle'
    });
    appsSection.appendChild(addAppsToggle);

    const showHiddenField = createToggle({
      label: 'Show hidden and system apps',
      focusIndex: '1280',
      checked: showHiddenApps,
      onChange: function (checked) {
        showHiddenApps = checked;
        loadAppsLists(pinnedList, addAppsList, config);
      }
    });
    appsSection.appendChild(showHiddenField.row);

    const addAppsList = document.createElement('div');
    addAppsList.className = 'settings-apps';
    appsSection.appendChild(addAppsList);
    // The pin order and custom apps are edited by the lists, not a control.
    binder.hook(function (cfg) {
      cfg.launcher.pinnedApps = pinnedOrder.slice();
      cfg.launcher.customApps = customApps.slice();
    });
    panes.apps.appendChild(appsSection);

    let addAppsExpanded = false;
    syncAddAppsToggle = function () {
      const count = addAppsList.querySelectorAll('.settings-app-row').length;
      // No rows: skip the button and show the "all pinned / none found" note.
      addAppsToggle.hidden = !count;
      addAppsList.hidden = !!count && !addAppsExpanded;
      addAppsToggle.textContent = addAppsExpanded
        ? 'Hide installed apps'
        : 'Show installed apps (' + count + ')';
    };
    addAppsToggle.addEventListener('click', function () {
      addAppsExpanded = !addAppsExpanded;
      if (syncAddAppsToggle) syncAddAppsToggle();
    });
    syncAddAppsToggle();

    const customSection = createSection('Custom app');
    customSection.appendChild(createHint('Pin any installed app by its App ID and choose a bundled icon. Find the App ID on your TV or in the Homebrew app list.'));

    const customAppIdField = createTextField({
      label: 'App ID',
      focusIndex: '1400',
      placeholder: 'e.g. com.spotify.tv'
    });
    const customAppIdInput = customAppIdField.input;
    customSection.appendChild(customAppIdField.row);

    const customNameField = createTextField({
      label: 'Name',
      focusIndex: '1401',
      placeholder: 'e.g. Spotify'
    });
    const customNameInput = customNameField.input;
    customSection.appendChild(customNameField.row);

    const iconPreview = document.createElement('img');
    iconPreview.className = 'settings-app-icon';
    iconPreview.alt = '';
    iconPreview.src = BUILTIN_ICON_CHOICES[0].value;

    const iconSelect = createOptionStepper({
      focusIndex: 1402,
      choices: BUILTIN_ICON_CHOICES,
      value: BUILTIN_ICON_CHOICES[0].value,
      onChange: function (value) {
        iconPreview.src = value;
      }
    });

    const iconRow = labeledControl('Icon', iconSelect);
    iconRow.insertBefore(iconPreview, iconRow.lastChild);
    customSection.appendChild(iconRow);

    const addCustomBtn = createMiniButton({
      label: 'Add custom app',
      focusIndex: '1403',
      className: 'settings-add-custom',
      onClick: function () {
        const launchId = customAppIdInput.value.trim();
        if (!launchId) {
          if (options.onToast) options.onToast('Enter an App ID first');
          return;
        }

        const id = 'custom:' + Date.now() + '-' + Math.floor(Math.random() * 1000);
        const title = customNameInput.value.trim() || getBuiltinAppTitle(launchId) || launchId;

        customApps.push({id: id, launchId: launchId, title: title, icon: iconSelect.value});
        pinnedOrder.push(id);

        customAppIdInput.value = '';
        customNameInput.value = '';

        loadAppsLists(pinnedList, addAppsList, config);
      }
    });
    customSection.appendChild(addCustomBtn);
    panes.apps.appendChild(customSection);

    const discoverSection = createSection('Discover apps');
    discoverSection.appendChild(createHint('Scan this TV for installed apps, then add any of them to the dock. Discovered apps keep their own icon unless you pick a bundled one below.'));

    const scanBtn = createMiniButton({
      label: 'Scan for apps',
      focusIndex: '1500',
      className: 'settings-scan-btn'
    });
    discoverSection.appendChild(scanBtn);

    const discoverIconSelect = createOptionStepper({
      focusIndex: 1501,
      choices: [{value: '', label: 'Use native icon'}].concat(BUILTIN_ICON_CHOICES),
      value: ''
    });
    discoverSection.appendChild(labeledControl('Icon override', discoverIconSelect));

    const discoverStatus = createHint('');
    discoverSection.appendChild(discoverStatus);

    const discoverList = document.createElement('div');
    discoverList.className = 'settings-apps';
    discoverSection.appendChild(discoverList);
    panes.apps.appendChild(discoverSection);

    let discovered: AppRecord[] = [];

    function inDock(appId: string): boolean {
      if (pinnedOrder.indexOf(appId) >= 0) return true;
      for (let i = 0; i < customApps.length; i += 1) {
        if (customApps[i].launchId === appId) return true;
      }
      return false;
    }

    function renderDiscoverList(): void {
      discoverList.innerHTML = '';
      if (!discovered.length) return;

      const available = discovered.filter(function (app) {
        return app && app.id && !inDock(app.id);
      });

      discoverStatus.textContent = available.length
        ? 'Found ' + discovered.length + ' apps.'
        : 'All discovered apps are already in your dock.';

      available.forEach(function (app, index) {
        const iconSrc = app.icon;
        const addBtn = createMiniButton({
          label: '+',
          focusIndex: 1510 + index,
          dataset: {pointerFocus: 'off'},
          onClick: function () {
            if (inDock(app.id)) return; // second OK before the list redraws
            const keepFocus = document.activeElement === addBtn;
            const override = discoverIconSelect.value;
            if (override) {
              const id = 'custom:' + Date.now() + '-' + Math.floor(Math.random() * 1000);
              customApps.push({id: id, launchId: app.id, title: app.title || app.id, icon: override});
              pinnedOrder.push(id);
            } else {
              pinnedOrder.push(app.id);
            }
            loadAppsLists(pinnedList, addAppsList, config);
            renderDiscoverList();
            // The next app slides into this row; land on its +.
            if (keepFocus) refocusListButton(discoverList, index, [0]);
          }
        });
        const row = createAppRow({
          title: app.title || app.id,
          icon: iconSrc,
          mountIcon: function (icon) {
            icon.addEventListener('error', function () { icon.remove(); });
            lazyLoadIcon(icon, iconSrc as string, discoverList);
          }
        }).row;
        row.appendChild(addBtn);
        discoverList.appendChild(row);
      });
    }

    let scanning = false;
    scanBtn.addEventListener('click', async function () {
      if (scanning) return;
      scanning = true;
      scanBtn.disabled = true;
      discoverStatus.textContent = 'Scanning\u2026';
      try {
        discovered = await listInstalledApps({includeHidden: true});
        discovered.sort(function (a, b) {
          return (a.title || a.id).localeCompare(b.title || b.id);
        });
        if (!discovered.length) {
          discoverStatus.textContent = 'No apps found on this TV.';
        } else {
          renderDiscoverList();
        }
      } catch (err) {
        discoverStatus.textContent = 'Could not scan for apps.';
      } finally {
        scanning = false;
        scanBtn.disabled = false;
      }
    });

    // Backup & restore: every Launch Home setting to a file on the TV (kept
    // when Launch Home is reinstalled) and to a plugged-in USB drive, to move
    // them to another TV. Launch Home also keeps copies by itself, before each
    // restore and each update. Backups from other versions restore as far as
    // they fit (config.js, configFromBackup). Needs root (Homebrew Channel).
    const backupSection = createSection('Backup & restore');
    backupSection.appendChild(createHint('Saves all your Launch Home settings: apps, wallpaper, music, clock, weather and profiles. The copy on the TV is kept if you reinstall Launch Home. A plugged-in USB drive gets a copy too (lounge/launch-home-settings.json), to move your settings to another TV. Launch Home also keeps a copy by itself before each restore and each update. Backups made by other versions of Launch Home can be restored too: you’re told what fitted. Voice keys and sign-in aren’t included; they stay on the TV.'));
    const backupActions = document.createElement('div');
    backupActions.className = 'settings-backup-actions';
    const backupBtn = createMiniButton({
      label: 'Back up settings',
      focusIndex: '1590',
      className: 'settings-scan-btn',
      dataset: {backupAction: 'backup'}
    });
    const restoreBtn = createMiniButton({
      label: 'Restore settings',
      focusIndex: '1591',
      className: 'settings-scan-btn',
      dataset: {backupAction: 'restore'}
    });
    backupActions.appendChild(backupBtn);
    backupActions.appendChild(restoreBtn);
    backupSection.appendChild(backupActions);
    // Which backup to restore: shown once Restore has found them.
    let backupsFound: BackupRecord[] = [];
    const backupPicker = createOptionStepper({
      focusIndex: 1592,
      choices: [],
      value: '',
      onChange: function () {
        showChosenBackup();
      }
    });
    const backupPickRow = labeledControl('Backup to restore', backupPicker);
    backupPickRow.hidden = true;
    backupSection.appendChild(backupPickRow);
    const backupStatus = createHint(backupNote || lastBackupNote());
    backupNote = '';
    backupSection.appendChild(backupStatus);
    panes.tools.appendChild(backupSection);

    let backupBusy = false;
    function chosenBackup(): BackupRecord | null {
      return backupsFound[parseInt(backupPicker.value, 10)] || null;
    }
    function showChosenBackup(): void {
      const chosen = chosenBackup();
      if (!chosen) return;
      backupStatus.textContent = compatibilityNote(chosen) + (chosen.readable
        ? ' Press “Restore this backup” to replace your current settings with it; ' +
          'a copy of them is kept first.'
        : '');
    }
    function closeBackupPicker(): void {
      backupsFound = [];
      backupPickRow.hidden = true;
      restoreBtn.textContent = 'Restore settings';
    }

    backupBtn.addEventListener('click', async function () {
      if (backupBusy) return;
      backupBusy = true;
      closeBackupPicker();
      // Not disabled while busy: a disabled button drops focus.
      backupBtn.textContent = 'Backing up…';
      backupStatus.textContent = 'Backing up…';
      try {
        const roots = (await withDeadline(findLoungeRoots(), 4000)) || [];
        const text = settingsBackupText(loadConfig(), {reason: 'manual'});
        const res = await writeSettingsBackup(text, roots[0] || '');
        const savedAt = JSON.parse(text).savedAt;
        const where = res.usb ? 'TV and USB drive' : 'TV';
        try {
          localStorage.setItem(LAST_BACKUP_KEY, JSON.stringify({savedAt: savedAt, where: where}));
        } catch (err) {
          // The note is optional.
        }
        backupStatus.textContent = 'Backed up on ' + backupWhen(savedAt) + ' to the ' + where + '.' +
          (res.usb === false ? ' The USB drive couldn’t be written' +
            (res.usbError ? ' (' + res.usbError + ')' : '') + '.' : '') +
          (res.usb === null ? ' No USB drive plugged in.' : '');
      } catch (err: any) {
        backupStatus.textContent = 'Backup failed: ' +
          ((err && err.message) || 'it needs root (Homebrew Channel)');
      } finally {
        backupBusy = false;
        backupBtn.textContent = 'Back up settings';
      }
    });

    restoreBtn.addEventListener('click', async function () {
      if (backupBusy) return;
      backupBusy = true;
      try {
        if (!backupsFound.length) {
          // First press: find the backups and let the user pick one.
          restoreBtn.textContent = 'Looking…';
          backupStatus.textContent = 'Looking for backups on the TV and USB drive…';
          const roots = (await withDeadline(findLoungeRoots(), 4000)) || [];
          backupsFound = listBackups(await readSettingsBackups(roots)) as BackupRecord[];
          if (!backupsFound.length) {
            restoreBtn.textContent = 'Restore settings';
            backupStatus.textContent = 'No backup found on the TV or a USB drive.';
            return;
          }
          backupPicker.setOptions(backupsFound.map(function (b, i) {
            return {value: String(i), label: backupLabel(b)};
          }), '0');
          backupPickRow.hidden = false;
          restoreBtn.textContent = 'Restore this backup';
          showChosenBackup();
          return;
        }
        const chosen = chosenBackup();
        if (!chosen || !chosen.readable) return;
        restoreBtn.textContent = 'Restoring…';
        // Keep the current settings first, so this restore can be undone
        // (it shows up as "before your last restore").
        try {
          await writeAutoBackup('before-restore.json',
            settingsBackupText(loadConfig(), {reason: 'before-restore'}));
        } catch (err: any) {
          restoreBtn.textContent = 'Restore this backup';
          backupStatus.textContent = 'Couldn’t keep a copy of your current settings first, so ' +
            'nothing was changed' + (err && err.message ? ': ' + err.message : '.');
          return;
        }
        const result = configFromBackup(chosen.data.config, config);
        if (!result) {
          restoreBtn.textContent = 'Restore this backup';
          backupStatus.textContent = 'That backup has no Launch Home settings in it.';
          return;
        }
        saveConfig(result.config);
        if (options.onSave) options.onSave(result.config);
        backupNote = restoreReport(chosen, result);
        redrawAfterRestore();
      } catch (err: any) {
        closeBackupPicker();
        backupStatus.textContent = 'Could not look for backups: ' +
          ((err && err.message) || 'it needs root (Homebrew Channel)');
      } finally {
        backupBusy = false;
      }
    });

    // TV check: a root script reports the TV's model, memory, CPU load and
    // background activity, and times how long TV Settings takes to open. The
    // summary is shown with a QR code so it can be sent from a phone.
    const tvCheckSection = createSection('TV check');
    tvCheckSection.appendChild(createHint('If the TV or TV Settings feels slow, this collects the TV model, memory, CPU load and what is running in the background, and times how long TV Settings takes to open. TV Settings opens and closes by itself, twice; it takes about 40 seconds. Scan the code with your phone to share the result.'));

    const tvCheckBtn = createMiniButton({
      label: 'Run TV check',
      focusIndex: '1600',
      className: 'settings-scan-btn'
    });
    tvCheckSection.appendChild(tvCheckBtn);

    const tvCheckStatus = createHint('');
    tvCheckSection.appendChild(tvCheckStatus);

    const tvCheckResult = document.createElement('div');
    tvCheckResult.className = 'tv-check-result focusable';
    tvCheckResult.dataset.focusIndex = '1601';
    tvCheckResult.tabIndex = 0;
    tvCheckResult.hidden = true;
    const tvCheckText = document.createElement('pre');
    tvCheckText.className = 'tv-check-report';
    const tvCheckQr = document.createElement('div');
    tvCheckQr.className = 'tv-check-qr';
    tvCheckResult.appendChild(tvCheckText);
    tvCheckResult.appendChild(tvCheckQr);
    tvCheckSection.appendChild(tvCheckResult);
    panes.tools.appendChild(tvCheckSection);

    let checking = false;
    tvCheckBtn.addEventListener('click', async function () {
      if (checking) return;
      checking = true;
      // Not disabled: a disabled button drops focus, and Settings would jump
      // back to the top when TV Settings closes.
      tvCheckBtn.textContent = 'Checking…';
      tvCheckResult.hidden = true;
      tvCheckStatus.textContent =
        'Checking… about 40 seconds. TV Settings will open and close by itself, twice ' +
        '(if it stays open, press Exit).';
      try {
        const head = tvCheckHead(getConfig());
        const probe = startLauncherProbe();
        let report: string;
        try {
          report = await runTvCheck(head);
        } catch (err) {
          probe.stop();
          throw err;
        }
        const probeLine = probe.stop();
        const summary = tvCheckSummary(report, head) + '\n' + probeLine;
        // Also into the saved report, which is what people usually send.
        execRoot('printf \'%s\\n\' \'' + probeLine.replace(/'/g, '') +
          '\' >> /tmp/launch-home-diagnostics.txt').catch(function () { /* optional */ });
        tvCheckText.textContent = summary;
        tvCheckQr.innerHTML = qrSvgMarkup(summary);
        tvCheckResult.hidden = false;
        // Some TVs (webOS 9) keep TV Settings open despite the check's close.
        const stuck = /didn.t close by itself/.test(report);
        tvCheckStatus.textContent = (stuck
          ? 'Done, but TV Settings didn\u2019t close by itself on this TV: press Exit or Back ' +
            'to close it. '
          : 'Done. ') + 'Scan the code to copy this text. The full report is in ' +
          '/tmp/launch-home-diagnostics.txt on the TV.';
        focusSettingsControlNow(tvCheckResult);
      } catch (err: any) {
        tvCheckStatus.textContent = 'TV check failed: ' +
          ((err && err.message) || 'it needs root (Homebrew Channel)');
      } finally {
        checking = false;
        tvCheckBtn.textContent = 'Run TV check';
      }
    });

    saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'settings-save focusable';
    saveBtn.dataset.focusIndex = String(indexInRow('settings-header', 0));
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', function () {
      // AI tab: send the voice service its settings only.
      if (activeSettingsTab === 'ai') {
        const payload: Record<string, any> = {
          ai_provider: (aiProviderSelect && aiProviderSelect.value) || 'xai',
          overlay_auto_dismiss_sec: parseInt(aiDismissSelect.value, 10) || 8,
          auth_mode: (aiAuthModeSelect && aiAuthModeSelect.value) || 'API_KEY'
        };
        // Model / language choices: only what the service offered and the
        // user has; the service keeps its own defaults.
        const modelPairs: Array<[OptionStepperElement, string]> = [
          [aiSttSelect, 'stt_language'],
          [aiChatSelect, 'chat_model'],
          [aiVoiceModelSelect, 'voice_model'],
          [aiGeminiModelSelect, 'gemini_model'],
          [aiGeminiSttSelect, 'gemini_stt_model'],
          [aiOpenRouterModelSelect, 'openrouter_model'],
          [aiOpenRouterSttSelect, 'openrouter_stt_model']
        ];
        modelPairs.forEach(function (pair) {
          if (pair[0] && pair[0].value) payload[pair[1]] = pair[0].value;
        });
        const key = (aiApiKeyInput.value || '').trim();
        // Hidden Grok key field must not toast xAI/SuperGrok token warnings
        // when Gemini or OpenRouter is the selected assistant.
        if (key && isGrokProvider()) {
          if (key.indexOf('xai-') !== 0 && key.indexOf('eyJ') !== 0) {
            if (options.onToast) {
              options.onToast('Grok key should start with xai- (or paste a SuperGrok token)');
            }
            return;
          }
          payload.xai_api_key = key;
        }
        const gemKey = (aiGeminiKeyInput.value || '').trim();
        if (gemKey) {
          payload.gemini_api_key = gemKey;
        }
        const orKey = ((aiOpenRouterKeyInput && aiOpenRouterKeyInput.value) || '').trim();
        if (orKey) {
          payload.openrouter_api_key = orKey;
        }
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';
        setVoiceConfig(payload).then(function (res) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save';
          if (res && res.restarting) {
            if (options.onToast) options.onToast('AI settings saved — restarting voice…');
          } else if (options.onToast) {
            options.onToast('AI settings saved');
          }
          aiApiKeyInput.value = '';
          aiGeminiKeyInput.value = '';
          if (aiOpenRouterKeyInput) aiOpenRouterKeyInput.value = '';
          loadAiTab();
        }).catch(function (err) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save';
          if (options.onToast) {
            options.onToast((err && err.message) || 'Could not save AI settings');
          }
        });
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

    await withDeadline(loadAppsLists(pinnedList, addAppsList, config), 8000);
    if (gen !== renderGen || !visible) return;
    attachInputScrollHelpers(body);
    // Load AI tab in background so Home settings stay snappy.
    loadAiTab();
  }

  async function loadAppsLists(
    pinnedListEl: HTMLElement,
    addContainer: HTMLElement,
    config: Config
  ): Promise<void> {
    // The old list stays up (and keeps focus) until the new one is ready; it
    // is cleared just before the synchronous rebuild below.
    const catalog = await loadAppCatalog();
    installedCatalog = catalog;
    const listed = await listInstalledApps({includeHidden: true});
    const apps = listed.filter(function (app) { return !app.hidden; });
    appsByIdMap = Object.assign({}, catalog);
    apps.forEach(function (app) {
      appsByIdMap[app.id] = app;
    });

    customApps.forEach(function (entry) {
      if (!entry || !entry.id) return;
      appsByIdMap[entry.id] = {
        id: entry.id,
        launchId: entry.launchId,
        title: entry.title || entry.launchId || entry.id,
        icon: entry.icon || ''
      };
    });

    for (let i = 0; i < pinnedOrder.length; i += 1) {
      const appId = pinnedOrder[i];
      if (findCustomApp(appId)) continue;
      if (!appsByIdMap[appId] || !appsByIdMap[appId].title || !appsByIdMap[appId].icon) {
        appsByIdMap[appId] = (await resolvePinnedApp(appId, appsByIdMap)) as AppRecord;
      }
    }

    KNOWN_BUILTIN_APPS.forEach(function (id) {
      if (appsByIdMap[id] && appsByIdMap[id].title) return;
      appsByIdMap[id] = {
        id: id,
        title: getBuiltinAppTitle(id) || id,
        icon: getBuiltinAppIcon(id) || ''
      };
    });

    pinnedContainer = pinnedListEl;
    // Redrawn after a + elsewhere: keep focus if the user is in this list.
    let pinnedSpot: {row: number; button: number} | null = null;
    const oldRows = pinnedListEl.querySelectorAll('.settings-pinned-row');
    for (let r = 0; r < oldRows.length; r += 1) {
      const btns = Array.prototype.slice.call(oldRows[r].querySelectorAll('.settings-mini-btn'));
      const b = btns.indexOf(document.activeElement);
      if (b >= 0) pinnedSpot = {row: r, button: b};
    }
    renderPinnedList(pinnedListEl);
    if (pinnedSpot) refocusListButton(pinnedListEl, pinnedSpot.row, [pinnedSpot.button, 0, 1, 2]);

    const seen: Record<string, boolean> = {};
    const candidates: AppRecord[] = [];
    apps.forEach(function (app) {
      if (app && app.id && !seen[app.id]) {
        seen[app.id] = true;
        candidates.push(app);
      }
    });
    // Hidden and system apps only on request: with root the TV lists every
    // installed app, and the list ran to hundreds of rows.
    if (showHiddenApps) {
      listed.forEach(function (app) {
        if (app && app.id && !seen[app.id]) {
          seen[app.id] = true;
          candidates.push(app);
        }
      });
    }
    // The TV's list couldn't be read (no root): offer the apps Launch Home knows.
    if (!listed.length) {
      KNOWN_BUILTIN_APPS.forEach(function (id) {
        const app = appsByIdMap[id];
        if (app && app.title && !seen[id]) {
          seen[id] = true;
          candidates.push(app);
        }
      });
    }

    candidates.sort(function (a, b) {
      return (a.title || a.id).localeCompare(b.title || b.id);
    });

    const customLaunchIds: Record<string, boolean> = {};
    customApps.forEach(function (entry) {
      if (entry && entry.launchId) customLaunchIds[entry.launchId] = true;
    });

    const remaining = candidates.filter(function (app) {
      return pinnedOrder.indexOf(app.id) < 0 && !customLaunchIds[app.id];
    });

    addContainer.innerHTML = '';
    if (!remaining.length) {
      addContainer.appendChild(createHint(candidates.length
        ? 'All available apps are already pinned.'
        : 'No other apps were found on this TV.'));
    }

    remaining.forEach(function (app, index) {
      const iconSrc = app.icon;
      const addBtn = createMiniButton({
        label: '+',
        focusIndex: 1300 + index,
        dataset: {pointerFocus: 'off'},
        onClick: function () {
          if (pinnedOrder.indexOf(app.id) >= 0) return; // second OK before the redraw
          const keepFocus = document.activeElement === addBtn;
          pinnedOrder.push(app.id);
          loadAppsLists(pinnedListEl, addContainer, config).then(function () {
            // The next app slides into this row; land on its + (unless the
            // user already moved on while the list was loading).
            if (keepFocus && !panel.contains(document.activeElement)) {
              refocusListButton(addContainer, index, [0]);
            }
          });
        }
      });
      const row = createAppRow({
        title: app.title || app.id,
        icon: iconSrc,
        mountIcon: function (icon) {
          icon.addEventListener('error', function () { icon.remove(); });
          lazyLoadIcon(icon, iconSrc as string, addContainer);
        }
      }).row;
      row.appendChild(addBtn);
      addContainer.appendChild(row);
    });
    if (syncAddAppsToggle) syncAddAppsToggle();
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