import {createAllApps} from '@apps/all-apps.js';
import type {AllApps} from '@apps/all-apps.js';
import {loadConfig, saveConfig, applyUsbConfig, readStoredConfigText} from '@config/config.js';
import {applyActiveProfile} from '@config/profiles.js';
import {resolveLoungePaths, findLoungeRoots} from '@lib/usb.js';
import {createBackgroundController} from '@background/background.js';
import type {BackgroundController} from '@background/background.js';
import {createMusicPlayer} from '@music/music.js';
import type {MusicPlayer} from '@music/music.js';
import {createAppGrid} from '@apps/apps.js';
import type {AppGrid} from '@apps/apps.js';
import {dock} from '@apps/dock.js';
import {createInputRow} from '@home/inputs.js';
import type {InputRowHandle} from '@home/inputs.js';
import {createChannelStrip} from '@home/channels.js';
import type {ChannelStripHandle} from '@home/channels.js';
import {createFocusManager} from '@focus/focus.js';
import type {FocusManager} from '@focus/focus.js';
import {createSettingsPanel} from '@settings/settings.js';
import type {SettingsPanelHandle} from '@settings/settings.js';
import {createCustomScreensaver} from '@background/screensaver.js';
import type {CustomScreensaver} from '@background/screensaver.js';
import {createWeatherPanel} from '@home/weather.js';
import type {WeatherPanelHandle} from '@home/weather.js';
import {createHomePaint} from '@home/paint.js';
import type {HomePaint} from '@home/paint.js';
import {
  getForegroundApp,
  launchApp,
  launchAppViaRoot,
  listApps,
  closeApp,
  removeApp,
  setSystemVolume
} from '@luna/luna.js';
import {
  enableHomeWatcher,
  disableHomeWatcher,
  enableBootLaunch,
  disableBootLaunch,
  cleanupVoice,
  writeAutoBackup,
  readSettingsBackups,
  setScreensaverTimeout,
  takePreviewFlag
} from '@luna/root.js';
import {createForegroundWatcher, shouldInterceptHome} from '@lib/foreground-watcher.js';
import type {ForegroundWatcher} from '@lib/foreground-watcher.js';
import {getSdkVersion, isSupportedPlatform} from '@luna/platform.js';
import {describeDetectedPlatform, renderUnsupportedSurface} from '@lib/unsupported-surface.js';
import {isTerminalAppId, getAppIdCandidates} from '@apps/app-icons.js';
import {setPreferBundledIcons} from '@apps/app-catalog.js';
import {setLiteImages} from '@background/background-sources.js';
import {activity, noteForeground} from '@lib/activity.js';
import {settingsBackupText, importLegacySettings} from '@settings/settings-backup.js';
import {APP_VERSION} from '@lib/version.js';
import {BRAND} from '@lib/brand.js';
import {setLanguage, t} from '@lib/i18n.js';
import type {Config, LauncherConfig, AppRecord, LunaResponse} from '@lib/types.js';

type ErrorLike = {message?: unknown} | null | undefined;

interface HomeElements {
  backgroundLayer: HTMLElement;
  scrim: HTMLElement;
  clock: HTMLElement | null;
  clockDate: HTMLElement | null;
  clockWeather: HTMLElement | null;
  appSettingsBtn: HTMLElement | null;
  inputRow: HTMLElement | null;
  channelStrip: HTMLElement | null;
  launcher: Element | null;
  appGridShell: HTMLElement | null;
  appGrid: HTMLElement;
  musicBar: HTMLElement | null;
  trackTitle: HTMLElement;
  muteBtn: HTMLElement;
  volumeSlider: HTMLInputElement;
  audio: HTMLAudioElement;
  settingsPanel: HTMLElement | null;
  toast: HTMLElement | null;
  customScreensaver: HTMLElement;
  screensaverWeather: HTMLElement | null;
  weatherPanel: HTMLElement | null;
  onToast?: (message: string) => void;
  onAerialChange?: (change: {mode?: string; id?: string; title?: string} | null) => void;
}

/** The lifecycle the composition root hands back. */
export interface AppLifecycle {
  start(): void;
  stop(): void;
}

// The sandboxed launch of the TV's own Settings app can go unanswered on newer
// webOS. Waiting out launchApp's 5 s timeout for each candidate id left about
// 10 s of nothing after pressing the tile, so after a short wait also launch
// it via root. Whichever answers first wins; a second launch of an app that
// is already opening just brings it forward.
const SYSTEM_APP_ROOT_AFTER_MS = 1200;

// Settings -> Backup & restore: the first start after an update keeps the
// settings as the previous version stored them (auto/before-update-to-<this
// version>.json), so going back to that version can restore them unchanged.
// Needs root; skipped quietly without it.
const LAST_RUN_VERSION_KEY = BRAND.storage.lastRunVersion;

// Run `fn` once the first paint and the current work are done, so startup side
// work (root hooks, backups) does not compete with bringing the screen
// up on a cold boot.
function whenIdle(fn: () => void) {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(function () { fn(); }, {timeout: 3000});
  } else {
    setTimeout(fn, 250);
  }
}

function launchSystemApp(id: string) {
  return new Promise(function (resolve, reject) {
    let settled = false;
    let failures = 0;
    let rootStarted = false;
    let rootTimer: ReturnType<typeof setTimeout> | null = null;
    function succeed() {
      if (settled) return;
      settled = true;
      clearTimeout(rootTimer ?? undefined);
      resolve(id);
    }
    function failOne() {
      failures += 1;
      if (!settled && failures >= 2) {
        settled = true;
        reject(new Error('Could not launch ' + id));
      }
    }
    function startRoot() {
      if (rootStarted || settled) return;
      rootStarted = true;
      launchAppViaRoot(id).then(succeed, failOne);
    }
    rootTimer = setTimeout(startRoot, SYSTEM_APP_ROOT_AFTER_MS);
    launchApp(id).then(succeed, function () {
      clearTimeout(rootTimer);
      failOne();
      startRoot();
    });
  });
}

function parseLaunchParamsObject(raw: unknown): Record<string, any> | null {
  if (!raw) return null;
  if (typeof raw === 'object') return raw as Record<string, any>;
  try { return JSON.parse(String(raw)); } catch (err) { return null; }
}

/** Whether a launch param / flag asks for the screensaver preview. */
function isTrueFlag(value: unknown): boolean {
  return value === 1 || value === true || value === '1';
}

function launchParamsWantPreview() {
  const previewFlag = (window as Window & {__EMBER_PREVIEW_SS?: unknown}).__EMBER_PREVIEW_SS;
  try {
    // Injected by install/SSH: <script>window.__EMBER_PREVIEW_SS=1</script>
    if (isTrueFlag(previewFlag)) {
      return true;
    }
  } catch (err0) { /* ignore */ }
  try {
    if (typeof location !== 'undefined' &&
        /(?:\?|&)previewSs=1(?:&|$)/.test(location.search || '')) {
      return true;
    }
  } catch (err) { /* ignore */ }
  try {
    const raw = window.webOSSystem && window.webOSSystem.launchParams;
    const p = parseLaunchParamsObject(raw);
    if (p && isTrueFlag(p.previewSs)) {
      return true;
    }
  } catch (err3) { /* ignore */ }
  return false;
}

/**
 * Build the home screen's modules in dependency order, inject their
 * collaborators, and return the lifecycle that starts and stops them. Importing
 * this module has no side effects; nothing runs until `start()`.
 */
export function createApp(): AppLifecycle {
  // The settings as the previous Launch Home stored them, before loadConfig()
  // updates them (see keepSettingsFromBeforeUpdate).
  const storedSettingsAtStart = readStoredConfigText();
  let baseConfig: Config = loadConfig();
  let visible = true;
  // Set when a Launch Home backup was imported on this first start, for the toast.
  let importedPreviousSettings = false;

  let started = false;
  let stopped = false;

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let resumeTimer: ReturnType<typeof setTimeout> | null = null;
  let reclaimTimer1: ReturnType<typeof setTimeout> | undefined;
  let reclaimTimer2: ReturnType<typeof setTimeout> | undefined;
  let reclaimTimer3: ReturnType<typeof setTimeout> | undefined;
  const pendingTimers: Array<ReturnType<typeof setTimeout>> = [];
  const removers: Array<() => void> = [];

  const elements: HomeElements = {
    backgroundLayer: document.getElementById('background-layer')!,
    scrim: document.getElementById('scrim')!,
    clock: document.getElementById('clock'),
    clockDate: document.getElementById('clock-date'),
    clockWeather: document.getElementById('clock-weather'),
    appSettingsBtn: document.getElementById('app-settings-btn'),
    inputRow: document.getElementById('input-row'),
    channelStrip: document.getElementById('channel-strip'),
    launcher: document.querySelector('.launcher'),
    appGridShell: document.getElementById('app-grid-shell'),
    appGrid: document.getElementById('app-grid')!,
    musicBar: document.getElementById('music-bar'),
    trackTitle: document.getElementById('track-title')!,
    muteBtn: document.getElementById('mute-btn')!,
    volumeSlider: document.getElementById('volume-slider')! as HTMLInputElement,
    audio: document.getElementById('ambient-audio')! as HTMLAudioElement,
    settingsPanel: document.getElementById('settings-panel'),
    toast: document.getElementById('toast'),
    customScreensaver: document.getElementById('custom-screensaver')!,
    screensaverWeather: document.getElementById('screensaver-weather'),
    weatherPanel: document.getElementById('weather-panel')
  };

  // Modules are built by buildModules() after the platform gate has passed, so
  // an unsupported TV never constructs them (some subscribe to the Luna bus on
  // construction). The handles are assigned before any callback can run.
  let weather!: WeatherPanelHandle;
  let background!: BackgroundController;
  let music!: MusicPlayer;
  let focus!: FocusManager;
  let settings!: SettingsPanelHandle;
  let customScreensaver!: CustomScreensaver;
  let channelStrip!: ChannelStripHandle;
  let inputs!: InputRowHandle;
  let apps!: AppGrid;
  let allApps!: AllApps;
  let paint!: HomePaint;
  let foregroundWatcher!: ForegroundWatcher;
  let built = false;

  function getBaseConfig(): Config {
    return baseConfig;
  }

  function getConfig(): Config {
    return applyActiveProfile(baseConfig);
  }

  function setConfig(nextConfig: Config) {
    baseConfig = nextConfig;
  }

  function showToast(message: string): void {
    const toast = elements.toast;
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      if (elements.toast) elements.toast.classList.remove('visible');
    }, 2800);
  }

  elements.onToast = showToast;

  // The labels index.html bakes in, worded once the language is known.
  function applyMarkupLabels() {
    if (elements.weatherPanel) elements.weatherPanel.setAttribute('aria-label', t('markup.weather'));
    if (elements.appSettingsBtn) elements.appSettingsBtn.setAttribute('aria-label', t('markup.settings'));
    if (elements.channelStrip) elements.channelStrip.setAttribute('aria-label', t('markup.channels'));
    if (elements.inputRow) elements.inputRow.setAttribute('aria-label', t('markup.inputs'));
    if (elements.appGrid) elements.appGrid.setAttribute('aria-label', t('markup.apps'));
    if (elements.muteBtn) elements.muteBtn.setAttribute('aria-label', t('markup.mute'));
    if (elements.volumeSlider) elements.volumeSlider.setAttribute('aria-label', t('markup.ambientVolume'));
    if (elements.customScreensaver) elements.customScreensaver.setAttribute('aria-label', t('markup.screensaver'));
    const hint = elements.customScreensaver && elements.customScreensaver.querySelector('.custom-screensaver-hint');
    if (hint) hint.textContent = t('markup.pressAnyButton');
  }

  // Aerial clip switched by the remote's Channel Up / Channel Down. In Single
  // mode the landed clip becomes the saved choice (the Settings picker reads the
  // base config, so it follows); in Slideshow mode the skip is transient and
  // nothing is written.
  elements.onAerialChange = function (change) {
    if (!change) return;
    if (change.mode === 'single' && change.id) {
      const config = getBaseConfig();
      setConfig(Object.assign({}, config, {
        background: Object.assign({}, config.background, {aerial: change.id})
      }));
      saveConfig(baseConfig);
    }
    if (change.title) {
      showToast('Aerial \u00b7 ' + change.title);
    }
  };

  // All apps -> long-press menu. Pinning writes the base config (never the
  // active profile) and repaints, so the home row behind the overlay follows.
  function launcherWrite(update: (launcher: LauncherConfig) => LauncherConfig) {
    const config = getBaseConfig();
    const launcher = update(config.launcher);
    setConfig(Object.assign({}, config, {launcher: launcher}));
    saveConfig(baseConfig);
    refreshAll();
  }

  function isAppPinned(app: AppRecord): boolean {
    return dock.contains(getBaseConfig().launcher, app.id);
  }

  function pinApp(app: AppRecord) {
    launcherWrite(function (launcher) { return dock.pin(launcher, app.id); });
  }

  // The same rule the Settings pinned list uses when an app is removed.
  function unpinApp(app: AppRecord) {
    launcherWrite(function (launcher) { return dock.remove(launcher, app.id); });
  }

  function restartApp(app: AppRecord) {
    allApps.hide();
    // Best-effort close: a stopped app errors "app is not running".
    closeApp(app.id).catch(function () { /* not running */ }).then(function () {
      return apps.launchApp(app);
    });
  }

  function deleteApp(app: AppRecord): Promise<void> {
    return removeApp(app.id).then(function () {
      unpinApp(app);
      showToast(t('apps.deleted', {app: app.title}));
    });
  }

  // HDMI / input switch or a TV channel — raise TV volume like launching an app.
  function beforeInputLaunch() {
    applyAppLaunchVolume();
    const config = getConfig();
    if (config.music && config.music.pauseOnLaunch) {
      music.fadeOutAndPause();
    }
  }

  function channelsChip() {
    const row = elements.inputRow;
    if (!row) return null;
    return row.querySelector('[data-channels-chip]');
  }

  // Build the modules once the platform gate has passed. Some subscribe to
  // the Luna bus on construction, so this must not run on an unsupported TV.
  function buildModules() {
    // Leaf modules: no collaborators beyond config and the DOM.
    paint = createHomePaint({
      clock: elements.clock,
      clockDate: elements.clockDate,
      launcher: elements.launcher,
      appGrid: elements.appGrid,
      appGridShell: elements.appGridShell,
      musicBar: elements.musicBar
    }, getConfig, {
      // 1920px wallpapers instead of 4K (see backgrounds.js).
      onPerfMode: setLiteImages
    });
    weather = createWeatherPanel(elements.weatherPanel, getConfig, {
      isVisible: function () { return visible; },
      inlineEls: [elements.clockWeather, elements.screensaverWeather]
    });
    background = createBackgroundController(elements, getConfig);
    music = createMusicPlayer(getConfig, Object.assign({}, elements, {
      onToast: showToast,
      onBarChange: function () { paint.layoutChanged(); }
    }));

    // Live TV channels above the inputs row (Channels chip; channels.js).
    channelStrip = createChannelStrip(elements.channelStrip, getConfig, {
      onToast: showToast,
      onBeforeLaunch: beforeInputLaunch,
      focusControl: function (el: Element | null) {
        return focus.focusElement(el);
      },
      // Mark the chip open/closed in place: redrawing the row would drop focus.
      onToggle: function (isOpen: boolean) {
        const chip = channelsChip();
        if (!chip) return;
        chip.classList.toggle('active', isOpen);
        chip.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        // Closing took the focused channel away (a pick that didn't switch, or
        // Back): land on the Channels chip rather than on nothing.
        const active = document.activeElement;
        if (!isOpen && (!active || active === document.body)) focus.focusElement(chip);
      },
      // The chip appears once channels are found (or goes if they are gone).
      onAvailabilityChange: function () {
        inputs.render();
      }
    });

    inputs = createInputRow(elements.inputRow, getConfig, {
      onToast: showToast,
      onBeforeLaunch: beforeInputLaunch,
      channels: channelStrip
    });

    // In-app photo/clock screensaver after idle.
    customScreensaver = createCustomScreensaver({
      rootEl: elements.customScreensaver,
      getConfig: getConfig,
      // Aerial saver: reuse the wallpaper's already-warm clip rather than opening
      // a second, cold decoder (see isPresentingAerial).
      isWallpaperAerial: function () { return background.isPresentingAerial(); },
      isBlocked: function () {
        if (!visible) return true;
        // Another app or TV Settings has the remote: keys go there, so we'd count
        // as idle and start a 4K slideshow underneath it.
        if (document.body.classList.contains('app-inactive')) return true;
        if (settings.isVisible()) return true;
        if (foregroundWatcher.isPending()) return true;
        return false;
      },
      onShow: function () {
        // Ambient music keeps playing under the saver.
      },
      onHide: function () {
        reclaimInput();
      }
    });

    settings = createSettingsPanel(elements.settingsPanel as HTMLElement, getBaseConfig, {
      onOpen: function () {
        music.fadeInAndResume();
        customScreensaver.hide();
      },
      onRendered: function () {
        // Land focus inside the panel so wheel / arrows navigate options immediately.
        focus.focusWithin('#settings-panel');
      },
      onSave: function (savedConfig: Config) {
        setConfig(savedConfig);
        applyHomeVolume();
        applyScreensaverSetting();
        customScreensaver.applyConfig();
        refreshAll();
        syncRootHooks(savedConfig);
      },
      onClose: function () {
        // Back on the home control Settings was opened from (the gear).
        focus.focusHomeDock();
        customScreensaver.resetIdle();
      },
      onPreviewScreensaver: function () {
        // Shown over the still-open panel; dismissing it hands focus back to
        // Settings via reclaimInput().
        customScreensaver.preview();
      },
      // Inputs list: offer Live TV when the TV has channels tuned.
      hasTvChannels: function () {
        return channelStrip.hasChannels();
      },
      // Re-focus a control after Settings redraws it (e.g. the pinned-apps list).
      focusControl: function (el: Element | null) {
        return focus.focusElement(el);
      },
      onToast: showToast
    });

    apps = createAppGrid(elements.appGrid, getConfig, {
      onBeforeLaunch: function () {
        foregroundWatcher.poke();
        customScreensaver.hide();
        const config = getConfig();
        if (config.music && config.music.pauseOnLaunch) {
          music.fadeOutAndPause();
        }
        applyAppLaunchVolume();
      },
      onOpenSettings: function () {
        settings.show();
      },
      onOpenTvSettings: function () {
        openTvSettings();
      },
      onOpenAllApps: function () {
        allApps.show();
      },
      onToast: showToast
    });

    focus = createFocusManager(document.getElementById('app') as HTMLElement, {
      onNumber: function (n: number) {
        // While the screensaver is showing, a key press dismisses it (screensaver.js)
        // rather than opening an app behind it.
        if (customScreensaver.isActive()) {
          return;
        }
        apps.launchByNumber(n);
      },
      onBack: function () {
        if (allApps.isOpen()) {
          // The menu unwinds first (its confirm, then itself), then the overlay.
          if (allApps.handleBack()) return;
          allApps.hide();
          return;
        }
        if (channelStrip.isOpen()) {
          channelStrip.close();
          return;
        }
        if (settings.isVisible()) {
          if (settings.handleBack()) {
            return;
          }
          settings.hide();
          return;
        }
      },
      onRed: function () {
        if (settings.isVisible()) return;
        // Red also unlocks autoplay if the TV blocked silent start.
        music.unlockAutoplay();
        music.togglePause();
      },
      onGreen: function () {
        if (settings.isVisible()) return;
        music.nextTrack();
      },
      onVolumeUp: function () {
        if (settings.isVisible()) return;
        music.nudgeVolume(5);
      },
      onVolumeDown: function () {
        if (settings.isVisible()) return;
        music.nudgeVolume(-5);
      },
      onVolumeMute: function () {
        if (settings.isVisible()) return;
        elements.muteBtn.click();
      },
      onBlue: function () {
        stepAerialBackground(1);
      },
      onChannelUp: function () {
        stepAerialBackground(1);
      },
      onChannelDown: function () {
        stepAerialBackground(-1);
      },
      onLongPress: function (el: Element) {
        allApps.openMenu(el);
      }
    });

    // All apps: the grid of every app on the TV, from the All apps tile.
    allApps = createAllApps({
      mount: document.getElementById('app')!,
      focus: focus,
      launch: function (app: AppRecord) {
        allApps.hide();
        apps.launchApp(app);
      },
      // Long-press menu actions (all-apps.js); the config and Luna live here.
      isPinned: isAppPinned,
      pin: function (app) { pinApp(app); showToast(t('apps.pinned', {app: app.title})); },
      unpin: function (app) { unpinApp(app); showToast(t('apps.unpinned', {app: app.title})); },
      restart: restartApp,
      remove: deleteApp,
      onToast: showToast
    });
  }

  // Blue (and Channel Up / Channel Down where the remote delivers them) steps the
  // aerial wallpaper to the next clip. They do nothing — like today — when an open
  // surface owns the keys: Settings, the Channels strip, All apps, or the
  // screensaver (which a key dismisses instead).
  function stepAerialBackground(direction: number) {
    if (settings.isVisible()) return;
    if (allApps.isOpen()) return;
    if (channelStrip.isOpen()) return;
    if (customScreensaver.isActive()) {
      return;
    }
    background.stepAerial(direction);
  }

  // A null level ("Don't change" in Settings) leaves the TV volume alone.
  function applySystemVolume(level: number | null | undefined) {
    if (typeof level !== 'number') return Promise.resolve();
    return setSystemVolume(level).catch(function () { /* best-effort */ });
  }

  function applyHomeVolume() {
    const config = getConfig();
    return applySystemVolume(config.launcher && config.launcher.volumeAtHome);
  }

  function applyAppLaunchVolume() {
    const config = getConfig();
    return applySystemVolume(config.launcher && config.launcher.volumeOnAppLaunch);
  }

  function applyScreensaverSetting() {
    const config = getConfig();
    let mins = config.launcher && typeof config.launcher.screensaverMinutes === 'number'
      ? config.launcher.screensaverMinutes
      : 30;
    // When the in-app screensaver is on, push the LG system timer to max so it
    // does not launch com.webos.app.screensaver over our slideshow.
    if (config.launcher && config.launcher.customScreensaver !== false && mins > 0 && mins < 30) {
      mins = 30;
    }
    // Guard against legacy invalid values (5/15/60) still in memory.
    if (mins !== 0 && mins !== 3 && mins !== 10 && mins !== 20 && mins !== 30) {
      if (mins === 5) mins = 3;
      else if (mins === 15) mins = 10;
      else if (mins >= 60) mins = 30;
      else mins = 30;
    }
    return setScreensaverTimeout(mins).catch(function () { /* best-effort */ });
  }

  function syncHomeWatcher(config: Config | null | undefined, opts?: {quiet?: boolean}) {
    const quiet = opts && opts.quiet;
    const on = !!(config && config.launcher &&
      (config.launcher.launchOnHome || config.launcher.returnOnAppExit));
    const apply = on ? enableHomeWatcher : disableHomeWatcher;
    return apply().then(function () {
      if (on && !quiet) showToast(t('system.homeActive', {brand: BRAND.name}));
    }).catch(function (err: ErrorLike) {
      console.error(err);
      if (on) {
        const detail = err && err.message ? String(err.message) : '';
        const short = detail.replace(/\s+/g, ' ').slice(0, 90);
        showToast(short
          ? t('system.homeFailed', {detail: short})
          : t('system.homeFailedHint'));
      }
    });
  }

  function syncBootLaunch(config: Config | null | undefined, opts?: {quiet?: boolean}) {
    const quiet = opts && opts.quiet;
    const on = !!(config && config.launcher && config.launcher.bootOnStart);
    const apply = on ? enableBootLaunch : disableBootLaunch;
    return apply().then(function () {
      if (on && !quiet) showToast(t('system.bootActive'));
    }).catch(function (err: ErrorLike) {
      console.error(err);
      if (on) {
        const detail = err && err.message ? String(err.message) : '';
        const short = detail.replace(/\s+/g, ' ').slice(0, 90);
        showToast(short
          ? t('system.bootFailed', {detail: short})
          : t('system.bootFailedHint'));
      }
    });
  }

  function syncRootHooks(config: Config | null | undefined, opts?: {quiet?: boolean}) {
    return Promise.all([
      syncHomeWatcher(config, opts),
      syncBootLaunch(config, opts)
    ]);
  }

  async function openTvSettings() {
    // TV Settings opens as a panel over Ember, which stays on screen
    // underneath: pause its animations now rather than waiting for a blur event
    // (older webOS may not send one). Any key back in Ember clears it.
    setAppInactive(true);
    const config = getConfig();
    if (config.music && config.music.pauseOnLaunch) {
      music.fadeOutAndPause();
    }
    applyAppLaunchVolume();
    // LG's Settings app, with webOS OSE's id as the fallback (see app-icons).
    const ids = getAppIdCandidates('com.palm.app.settings');
    for (let i = 0; i < ids.length; i += 1) {
      try {
        await launchSystemApp(ids[i]);
        return;
      } catch (err) {
        // Try the next candidate id.
      }
    }
    showToast(t('apps.tvSettingsFailed'));
  }

  async function applyUsbOverrides() {
    const config = getBaseConfig();
    const paths = await resolveLoungePaths(config);

    if (paths.usbConfig) {
      setConfig(applyUsbConfig(config, paths.usbConfig));
      saveConfig(baseConfig);
    }

    if (!baseConfig.music.path && paths.musicPath) {
      baseConfig.music.path = paths.musicPath;
    }

    if (!baseConfig.background.path && paths.backgroundPath) {
      baseConfig.background.path = paths.backgroundPath;
    }
  }

  /**
   * @param {{resume?: boolean}} [opts] resume: returning to Ember; keeps
   *   the dock as-is when nothing about it changed (see apps.refresh).
   */
  async function refreshAll(opts?: {resume?: boolean}) {
    const resume = !!(opts && opts.resume);
    paint.apply();
    music.applyConfig();
    // Paints the cached forecast at once; the network fetch (if stale) is not awaited.
    weather.refresh();
    // Returning from an app: the wallpaper and playlist stay as they are when
    // their settings haven't changed (see background.refresh, music.loadTracks).
    await background.refresh({reuse: resume});
    await inputs.refresh();
    // Whether the TV has channels decides if the Channels chip shows.
    channelStrip.refresh().catch(function () { /* no channels chip */ });
    const launcherConfig = getConfig().launcher || ({} as LauncherConfig);
    setPreferBundledIcons(launcherConfig.bundledIcons !== false);
    await apps.refresh({reuse: resume});
    paint.layoutChanged();
    await music.loadTracks({reuse: resume});
    // After a return the remote is already on the tile it was on (handleResume).
    // Otherwise (start-up, after Save): where the remote was on the home screen,
    // else the first tile. Not while Settings or All apps is open: a config
    // write from the All apps menu must not pull focus out of its menu.
    if (!resume && !settings.isVisible() && !allApps.isOpen()) focus.focusHomeDock();
  }

  // Reclaim system keyboard/pointer focus and re-select a dock tile.
  // After Home-button intercept, webOS often leaves INPUT routed to stock Home
  // even though Ember is painted on top — remote OK does nothing until we
  // re-assert window focus and a real focusable tile.
  function reclaimInput() {
    // Settings is open (e.g. after a screensaver preview): stay on the row the
    // user was on instead of jumping to the hidden dock.
    if (settings.isVisible()) {
      try { window.focus(); } catch (err) { /* ignore */ }
      const current = elements.settingsPanel &&
        elements.settingsPanel.querySelector('.focusable.focused');
      if (!(current && focus.focusElement(current))) {
        focus.focusWithin('#settings-panel');
      }
      return;
    }
    // All apps is open: stay on the app the remote was on.
    if (allApps.isOpen()) {
      try { window.focus(); } catch (err) { /* ignore */ }
      allApps.refocus();
      return;
    }
    // Clear any stuck settings-open dim/hide that would block the dock.
    document.body.classList.remove('settings-open');
    if (elements.settingsPanel) {
      elements.settingsPanel.hidden = true;
    }
    try { window.focus(); } catch (err) { /* ignore */ }
    try { document.body && document.body.focus && document.body.focus(); } catch (err) { /* ignore */ }
    try {
      const active = document.activeElement as HTMLElement | null;
      if (active) {
        active.blur();
      }
    } catch (err) { /* ignore */ }
    focus.focusHomeDock();
  }

  function scheduleReclaimBursts() {
    activity.reclaims += 1;
    // webOS may deliver input ownership a few hundred ms after the surface paints.
    reclaimInput();
    clearTimeout(reclaimTimer1);
    clearTimeout(reclaimTimer2);
    clearTimeout(reclaimTimer3);
    reclaimTimer1 = setTimeout(reclaimInput, 250);
    reclaimTimer2 = setTimeout(reclaimInput, 800);
    reclaimTimer3 = setTimeout(reclaimInput, 1600);
  }

  // An overlay app such as LG Settings takes the remote but leaves Ember
  // on screen underneath. Hold the wallpaper motion still meanwhile, so the TV
  // isn't re-compositing the 4K photo and the glass blur behind that panel on
  // every frame (its menus felt sluggish).
  function setAppInactive(on: boolean) {
    document.body.classList.toggle('app-inactive', !!on);
  }

  function handleResume() {
    visible = true;
    foregroundWatcher.noteResume();
    setAppInactive(false);
    // Debounce stacked resume events (visibility + webOSRelaunch + focus).
    clearTimeout(resumeTimer ?? undefined);
    resumeTimer = setTimeout(function () {
      const config = getConfig();
      applyHomeVolume();
      if (config.music && config.music.resumeOnReturn) {
        music.fadeInAndResume();
      }
      // Do not kill an intentional screensaver preview on resume noise.
      // (Idle auto-show still ends on real key press via the saver itself.)
      if (customScreensaver.isActive()) {
        /* leave preview up */
      } else {
        customScreensaver.resetIdle();
      }
      // Give the remote back at once, on the control it was on; the refresh
      // runs behind it. Waiting for the refresh first (Luna and root calls one
      // after another) left the remote dead for seconds on slow TVs.
      reclaimInput();
      refreshAll({resume: true}).then(function () {
        scheduleReclaimBursts();
      }, function (err) {
        console.error(err);
        scheduleReclaimBursts();
      });
    }, 50);
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      visible = false;
      // Our surface was backgrounded, so any app we launched took the foreground
      // normally. This disarms the ghost-focus recovery for that launch.
      foregroundWatcher.noteHidden();
      customScreensaver.hide();
      channelStrip.close();
      return;
    }
    handleResume();
  }

  // Polls the system foreground app id and drives music pause, ghost-focus
  // launch recovery and the home intercept. The poll loop, its state and its
  // cadence live in lib/foreground-watcher.js; every side effect is injected.
  foregroundWatcher = createForegroundWatcher({
    selfAppId: BRAND.appId,
    getForegroundApp: getForegroundApp,
    launchApp: launchApp,
    launchAppViaRoot: launchAppViaRoot,
    closeApp: closeApp,
    isVisible: function () { return visible; },
    shouldInterceptHome: function () { return shouldInterceptHome(getBaseConfig().launcher); },
    pauseMusic: function () {
      const config = getConfig();
      if (config.music && config.music.pauseOnLaunch) {
        music.fadeOutAndPause();
      }
    },
    reclaimInput: reclaimInput,
    reclaimBursts: scheduleReclaimBursts,
    isAvailable: function () { return !!(window.webOS && window.webOS.service); },
    activity: {
      noteForeground: noteForeground,
      noteReturn: function () { activity.returns += 1; },
      noteClose: function () { activity.closes += 1; }
    }
  });

  function handlePowerOff() {
    music.stop();
  }

  async function autoEnableTerminal() {
    if (baseConfig.launcher && baseConfig.launcher.terminalChecked) return false;

    let installed: LunaResponse[] = [];
    try {
      const res = await listApps();
      installed = (res && res.apps) || [];
    } catch (err) {
      return false; // Could not list apps; try again on the next launch.
    }

    const terminal = installed.find(function (app) {
      return app && isTerminalAppId(app.id);
    });

    const pinned = (baseConfig.launcher.pinnedApps || []);
    let added = false;
    if (terminal && pinned.indexOf(terminal.id) < 0) {
      pinned.push(terminal.id);
      baseConfig.launcher.pinnedApps = pinned;
      added = true;
    }

    baseConfig.launcher.terminalChecked = true;
    saveConfig(baseConfig);
    return added;
  }

  /**
   * On the first start with no stored config, adopt the newest Launch Home
   * backup (TV copy, automatic copies, or a USB drive) so an upgrade keeps its
   * setup. Doing it before buildModules() means the home screen paints with it.
   * Quietly stays on defaults when there is nothing to import or root is absent.
   */
  async function importLegacyOnFirstRun() {
    let imported = null;
    try {
      imported = await importLegacySettings(storedSettingsAtStart, baseConfig, async function () {
        const roots = await findLoungeRoots();
        return readSettingsBackups(roots);
      });
    } catch (err) {
      // No root (Homebrew Channel) or unreadable drive: start on defaults.
    }
    if (!imported) return;
    setConfig(imported);
    saveConfig(baseConfig);
    // Flag only: the toast is worded when it shows, after this import's
    // language setting has been applied.
    importedPreviousSettings = true;
  }

  /**
   * The first start after an update. Version bookkeeping first, then the two
   * things it triggers: the voice teardown (an earlier Ember may have installed
   * a root daemon and a boot hook) and the before-update settings backup. The
   * teardown is fired before the checks below can return early, because a TV
   * whose stored settings are unreadable still needs its daemon stopped.
   */
  function workAfterUpdate() {
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST_RUN_VERSION_KEY);
      if (last === APP_VERSION) return;
      localStorage.setItem(LAST_RUN_VERSION_KEY, APP_VERSION);
    } catch (err) {
      return;
    }
    // Optional, and needs root: without Homebrew Channel the daemon keeps
    // running until there is one, exactly as the backup below does.
    cleanupVoice().catch(function () { /* no root / desktop preview */ });
    if (!storedSettingsAtStart) return;  // first install: nothing to keep
    let stored = null;
    try {
      stored = JSON.parse(storedSettingsAtStart);
    } catch (err) {
      return;
    }
    const text = settingsBackupText(stored, {
      reason: 'before-update',
      appVersion: last || '',
      updatedTo: APP_VERSION
    });
    writeAutoBackup('before-update-to-' + APP_VERSION + '.json', text).catch(function () {
      /* optional */
    });
  }

  function triggerScreensaverPreview(reason: string) {
    console.log('[' + BRAND.slug + '] screensaver preview:', reason || '');
    customScreensaver.preview();
  }

  // Register a listener and remember how to remove it, so stop() leaves the
  // document clean.
  function on(
    target: EventTarget,
    type: string,
    fn: EventListener,
    opts?: AddEventListenerOptions | boolean
  ): void {
    target.addEventListener(type, fn, opts);
    removers.push(function () { target.removeEventListener(type, fn, opts); });
  }

  // Track a one-shot timer so stop() can clear it.
  function laterTracked(fn: () => void, ms: number): void {
    pendingTimers.push(setTimeout(function () { fn(); }, ms));
  }

  async function init() {
    // Platform gate, step 0: an unsupported TV never starts a module, the
    // Luna ladder, root hooks or the foreground watcher. Fail closed, visibly.
    const sdkVersion = await getSdkVersion();
    if (stopped) return;
    // The interface language, resolved before anything renders: the platform
    // gate's surface and the page markup follow it too.
    setLanguage(baseConfig.launcher.language);
    applyMarkupLabels();
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    if (!isSupportedPlatform(sdkVersion, userAgent)) {
      renderUnsupportedSurface(describeDetectedPlatform(sdkVersion));
      return;
    }

    await importLegacyOnFirstRun();
    if (stopped) return;
    // An imported backup may carry its own language setting.
    setLanguage(baseConfig.launcher.language);
    applyMarkupLabels();
    buildModules();
    built = true;

    await applyUsbOverrides();
    if (stopped) return;
    paint.start();

    applyHomeVolume();
    applyScreensaverSetting();

    // Paint the dock from remembered info and hand the remote over before the
    // app list / root work below. On a cold boot we are replacing the stock Home
    // screen, so being interactive soon matters more than complete tiles; the
    // refresh below fills them in.
    apps.renderShell();
    focus.focusHomeDock();

    await refreshAll();
    if (stopped) return;

    // Confirms a first-run import once the home screen is up.
    if (importedPreviousSettings) {
      laterTracked(function () { showToast(t('app.importedSettings')); }, 900);
    }

    // In-app photo/clock screensaver after idle.
    customScreensaver.start();

    // One-shot force preview: URL, webOSSystem launch params, webOSRelaunch,
    // or the root flag file (written by install/SSH).
    if (launchParamsWantPreview()) {
      laterTracked(function () { triggerScreensaverPreview('launchParams'); }, 900);
      laterTracked(function () { triggerScreensaverPreview('launchParams-retry'); }, 2500);
    }
    // Root-written flag: reliable on TV even when launch params are dropped.
    takePreviewFlag().then(function (wanted) {
      if (!wanted) return;
      laterTracked(function () { triggerScreensaverPreview('flag-file'); }, 600);
      laterTracked(function () { triggerScreensaverPreview('flag-file-retry'); }, 2200);
    });
    on(document, 'webOSRelaunch', function (ev: Event) {
      try {
        const d = ((ev as CustomEvent).detail) || {};
        const p = d.returnValue != null ? d : (d.params || d);
        if (p && isTrueFlag(p.previewSs)) {
          laterTracked(function () { triggerScreensaverPreview('webOSRelaunch'); }, 400);
        }
      } catch (errR) { /* ignore */ }
    });

    // Retry ambient autoplay shortly after startup (webOS often allows play once
    // the app surface is fully focused, even if the first play() was blocked).
    laterTracked(function () { music.unlockAutoplay(); }, 600);
    laterTracked(function () { music.unlockAutoplay(); }, 2000);

    if (elements.appSettingsBtn) {
      // Use click only (not pointerup+click). Dual handlers raced with Settings
      // Close, which sits in the same top-right corner as the gear on Magic Remote.
      on(elements.appSettingsBtn, 'click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        settings.show();
      });
    }

    on(document, 'visibilitychange', handleVisibilityChange);
    // webOS fires `webOSRelaunch` on the document when the user returns to an
    // already-running app (e.g. after another app closes or fails to launch).
    // Treat it as a resume so a suspended launcher wakes up and regains input.
    on(document, 'webOSRelaunch', function () {
      activity.relaunches += 1;
    });
    on(document, 'webOSRelaunch', handleResume);
    on(window, 'focus', function () {
      setAppInactive(false);
      reclaimInput();
      music.unlockAutoplay();
    });
    on(window, 'blur', function () {
      setAppInactive(true);
    });
    // Keys only reach the surface that has the remote, so any key means we're
    // active again even if the focus event was missed.
    on(document, 'keydown', function () {
      setAppInactive(false);
    }, true);
    on(window, 'pagehide', handlePowerOff);
    foregroundWatcher.start();

    // Side work that the first usable screen does not need: the after-update
    // work (the old voice assistant's teardown, the before-update settings
    // backup), the terminal auto-pin, the weather timers, and re-asserting the
    // root hooks. Each runs root/network work through Homebrew Channel, which
    // is itself still starting up on a cold boot, so run them once idle.
    whenIdle(function () {
      if (stopped) return;
      workAfterUpdate();
      autoEnableTerminal().then(function (added) {
        // The idle pass runs after the first dock render; if it pinned the
        // terminal, redraw so the tile shows now instead of next boot.
        if (added) apps.refresh();
      }).catch(function () { /* optional */ });
      weather.start();
      // The home watcher and boot-launch init.d must be re-written after every
      // install (ipk replace drops scripts; hbchannel may kill orphan processes).
      const cfg = getBaseConfig();
      if (shouldInterceptHome(cfg.launcher) || (cfg.launcher && cfg.launcher.bootOnStart)) {
        syncRootHooks(cfg, {quiet: true}).catch(function () { /* ignore */ });
      }
    });
  }

  function start() {
    if (started) return;
    started = true;
    init().catch(function (err) {
      showToast(t('app.startupError'));
      console.error(err);
    });
  }

  function stop() {
    stopped = true;
    if (!built) return;
    clearTimeout(toastTimer);
    clearTimeout(resumeTimer ?? undefined);
    clearTimeout(reclaimTimer1);
    clearTimeout(reclaimTimer2);
    clearTimeout(reclaimTimer3);
    pendingTimers.forEach(function (timer) { clearTimeout(timer); });
    pendingTimers.length = 0;
    foregroundWatcher.stop();
    paint.stop();
    if (settings.isVisible()) settings.hide();
    weather.stop();
    customScreensaver.stop();
    background.destroy();
    music.stop();
    focus.destroy();
    removers.forEach(function (remove) { remove(); });
    removers.length = 0;
  }

  return {start: start, stop: stop};
}
