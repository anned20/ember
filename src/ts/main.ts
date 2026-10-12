import {setClockTime} from '@lib/clock-format.js';
import {createAllApps} from '@apps/all-apps.js';
import type {AllApps} from '@apps/all-apps.js';
import '@lib/compat.js';
import {loadConfig, saveConfig, applyUsbConfig, readStoredConfigText} from '@config/config.js';
import {applyActiveProfile} from '@config/profiles.js';
import {resolveLoungePaths} from '@lib/usb.js';
import {createBackgroundController} from '@background/background.js';
import type {BackgroundController} from '@background/background.js';
import {createMusicPlayer} from '@music/music.js';
import type {MusicPlayer} from '@music/music.js';
import {createAppGrid} from '@apps/apps.js';
import type {AppGrid, LaunchableApp} from '@apps/apps.js';
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
import {createVoiceIndicator} from '@voice/voice-indicator.js';
import type {VoiceIndicator} from '@voice/voice-indicator.js';
import {
  getForegroundApp,
  launchApp,
  launchAppViaRoot,
  listApps,
  closeApp,
  enableHomeWatcher,
  disableHomeWatcher,
  enableBootLaunch,
  disableBootLaunch,
  enableVoice,
  writeAutoBackup,
  setSystemVolume,
  setScreensaverTimeout,
  execRoot
} from '@luna/luna.js';
import {createForegroundWatcher, shouldInterceptHome} from '@lib/foreground-watcher.js';
import type {ForegroundWatcher} from '@lib/foreground-watcher.js';
import {isTerminalAppId, getAppIdCandidates} from '@apps/app-icons.js';
import {setPreferBundledIcons} from '@apps/app-catalog.js';
import {setLiteImages} from '@background/background-sources.js';
import {addVoiceListener, setVoiceWsEnabled, stopVoiceWs} from '@voice/voice-ws.js';
import {resolveVoiceLaunch} from '@voice/voice-launch.js';
import {activity, noteForeground} from '@lib/activity.js';
import {settingsBackupText} from '@settings/settings-backup.js';
import {APP_VERSION} from '@lib/version.js';
import type {Config, LauncherConfig, AppRecord, LunaResponse} from '@lib/types.js';

const APP_ID = 'org.webosbrew.lounge.launcher';

type ErrorLike = {message?: unknown} | null | undefined;

interface HomeElements {
  backgroundLayer: HTMLElement;
  scrim: HTMLElement;
  clock: HTMLElement | null;
  clockDate: HTMLElement | null;
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
  voiceIndicator: HTMLElement | null;
  customScreensaver: HTMLElement;
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
const LAST_RUN_VERSION_KEY = 'lounge.lastRunVersion';

// When a user on a weaker TV enables Performance mode, the glassmorphic blur and
// animated background are disabled for smoother rendering, while the layout stays
// intact (see the `.perf-mode` rules in styles/main.css).
// Settings -> Look -> Glass colour and Glass border: body.glass-<tint> and
// body.glass-border-<colour> recolour the glass (main.css). Light glass with
// a white border is the original look and needs no class.
const GLASS_TINTS = ['dark', 'black', 'blue', 'purple', 'green', 'warm'];
const GLASS_BORDERS = ['glass', 'none', 'black', 'blue', 'purple', 'green', 'warm', 'gold'];
// Settings -> Look -> Focus colour: body.focus-<colour>; warm needs no class.
const FOCUS_COLOURS = ['white', 'border', 'blue', 'purple', 'green', 'gold'];

// Run `fn` once the first paint and the current work are done, so startup side
// work (root hooks, voice, backups) does not compete with bringing the screen
// up on a cold boot.
function whenIdle(fn: () => void) {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(function () { fn(); }, {timeout: 3000});
  } else {
    setTimeout(fn, 250);
  }
}

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
    return new Intl.DateTimeFormat('en-GB', options).format(date);
  } catch (err) {
    // Invalid timezone — fall back to local date.
    delete options.timeZone;
    return new Intl.DateTimeFormat('en-GB', options).format(date);
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
  const previewFlag = (window as Window & {__LH_PREVIEW_SS?: unknown}).__LH_PREVIEW_SS;
  try {
    // Injected by install/SSH: <script>window.__LH_PREVIEW_SS=1</script>
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
  const candidates: string[] = [];
  try {
    if (window.PalmSystem && window.PalmSystem.launchParams) {
      candidates.push(window.PalmSystem.launchParams);
    }
  } catch (err2) { /* ignore */ }
  try {
    if (window.webOSSystem && window.webOSSystem.launchParams) {
      candidates.push(window.webOSSystem.launchParams);
    }
  } catch (err3) { /* ignore */ }
  for (let i = 0; i < candidates.length; i += 1) {
    const p = parseLaunchParamsObject(candidates[i]);
    if (p && isTrueFlag(p.previewSs)) {
      return true;
    }
  }
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
  let lastVoiceLaunchKey = '';
  let lastVoiceLaunchAt = 0;

  let started = false;
  let stopped = false;

  let clockTimer: ReturnType<typeof setInterval> | null = null;
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
    voiceIndicator: document.getElementById('voice-indicator'),
    customScreensaver: document.getElementById('custom-screensaver')!,
    weatherPanel: document.getElementById('weather-panel')
  };

  // Modules are wired here in dependency order. The few genuinely cyclic edges
  // (focus <-> settings/apps, settings <-> screensaver) go through these
  // forward-declared handles, which are assigned before any callback can run.
  let focus: FocusManager;
  let settings: SettingsPanelHandle;
  let customScreensaver: CustomScreensaver;
  let channelStrip: ChannelStripHandle;
  let inputs: InputRowHandle;
  let apps: AppGrid;
  let allApps: AllApps;
  let foregroundWatcher: ForegroundWatcher;

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

  // --- leaf modules: no collaborators beyond config and the DOM ---
  const voiceIndicator: VoiceIndicator = createVoiceIndicator(elements.voiceIndicator);
  const weather: WeatherPanelHandle = createWeatherPanel(elements.weatherPanel, getConfig, {
    isVisible: function () { return visible; }
  });
  const background: BackgroundController =
    createBackgroundController(elements, getConfig);
  const music: MusicPlayer = createMusicPlayer(getConfig, Object.assign({}, elements, {
    onToast: showToast,
    onBarChange: function () { updateMusicBarClearance(); }
  }));

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
    // Settings -> AI Voice turned the voice assistant on/off (already applied
    // and saved there).
    onVoiceEnabledChange: function (on: boolean) {
      setVoiceWsEnabled(on);
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
    }
  });

  // All apps: the grid of every app on the TV, from the All apps tile.
  allApps = createAllApps({
    mount: document.getElementById('app')!,
    focus: focus,
    launch: function (app: AppRecord) {
      allApps.hide();
      apps.launchApp(app);
    }
  });

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
      if (on && !quiet) showToast('Home button → Launch Home is active');
    }).catch(function (err: ErrorLike) {
      console.error(err);
      if (on) {
        const detail = err && err.message ? String(err.message) : '';
        const short = detail.replace(/\s+/g, ' ').slice(0, 90);
        showToast(short
          ? 'Home watcher failed: ' + short
          : 'Home watcher failed — check root / Homebrew Channel');
      }
    });
  }

  function syncBootLaunch(config: Config | null | undefined, opts?: {quiet?: boolean}) {
    const quiet = opts && opts.quiet;
    const on = !!(config && config.launcher && config.launcher.bootOnStart);
    const apply = on ? enableBootLaunch : disableBootLaunch;
    return apply().then(function () {
      if (on && !quiet) showToast('Boot on TV start is active');
    }).catch(function (err: ErrorLike) {
      console.error(err);
      if (on) {
        const detail = err && err.message ? String(err.message) : '';
        const short = detail.replace(/\s+/g, ' ').slice(0, 90);
        showToast(short
          ? 'Boot on start failed: ' + short
          : 'Boot on start failed — check root / Homebrew Channel');
      }
    });
  }

  // Voice assistant (Settings -> AI Voice). Re-running the enable at start is
  // cheap when all is current, and restarts the daemon on the code this Launch
  // Home version ships after an update.
  function syncVoice(config: Config | null | undefined) {
    if (!(config && config.launcher && config.launcher.voiceEnabled)) {
      return Promise.resolve();
    }
    return enableVoice().catch(function (err: ErrorLike) {
      console.error(err);
      const detail = err && err.message ? String(err.message) : '';
      showToast('Voice assistant failed to start' +
        (detail ? ': ' + detail.replace(/\s+/g, ' ').slice(0, 80) : ''));
    });
  }

  function syncRootHooks(config: Config | null | undefined, opts?: {quiet?: boolean}) {
    return Promise.all([
      syncHomeWatcher(config, opts),
      syncBootLaunch(config, opts)
    ]);
  }

  async function openTvSettings() {
    // TV Settings opens as a panel over Launch Home, which stays on screen
    // underneath: pause its animations now rather than waiting for a blur event
    // (older webOS may not send one). Any key back in Launch Home clears it.
    setAppInactive(true);
    const config = getConfig();
    if (config.music && config.music.pauseOnLaunch) {
      music.fadeOutAndPause();
    }
    applyAppLaunchVolume();
    const ids = getAppIdCandidates('com.webos.app.settings');
    for (let i = 0; i < ids.length; i += 1) {
      try {
        await launchSystemApp(ids[i]);
        return;
      } catch (err) {
        // Try the next candidate id.
      }
    }
    showToast('Could not open TV Settings');
  }

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

  // Icon row layout: 'scroll' keeps a single horizontal row capped to N icons
  // (the rest reachable by scrolling left/right), 'wrap' lets icons stack onto
  // multiple rows. Scroll is the default.
  function applyIconLayout() {
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

  /**
   * The music bar sits in the bottom-right corner. When the lowest row of app
   * tiles reaches under it (a wide row, wrapped rows), lift the launcher clear
   * of it (body.music-bar-clear). Only across, and only what the row shows:
   * lifting doesn't move tiles sideways, and the one-row layout's scrolling
   * doesn't change which part of the screen it covers, so this never flips.
   */
  function updateMusicBarClearance() {
    const bar = document.getElementById('music-bar');
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
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(function () {
        if (stopped) return;
        updateAppScrollHints();
        setTimeout(function () {
          if (!stopped) updateAppScrollHints();
        }, 80);
      });
    } else {
      setTimeout(function () {
        if (!stopped) updateAppScrollHints();
      }, 80);
    }
  }

  function bindAppScrollHints() {
    const grid = elements.appGrid;
    if (!grid) return;

    on(grid, 'scroll', function () {
      updateAppScrollHints();
    }, {passive: true});

    on(window, 'resize', function () {
      scheduleAppScrollHints();
    });
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

  function applyPerfMode() {
    const config = getConfig();
    const on = !!(config.launcher && config.launcher.perfMode);
    document.body.classList.toggle('perf-mode', on);
    // 1920px wallpapers instead of 4K (see backgrounds.js).
    setLiteImages(on);
  }

  /**
   * @param {{resume?: boolean}} [opts] resume: returning to Launch Home; keeps
   *   the dock as-is when nothing about it changed (see apps.refresh).
   */
  async function refreshAll(opts?: {resume?: boolean}) {
    const resume = !!(opts && opts.resume);
    updateClock();
    applyIconAlign();
    applyPerfMode();
    applyGlassTint();
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
    applyIconLayout();
    scheduleAppScrollHints();
    await music.loadTracks({reuse: resume});
    // After a return the remote is already on the tile it was on (handleResume).
    // Otherwise (start-up, after Save): where the remote was on the home screen,
    // else the first tile. Not while Settings is still open.
    if (!resume && !settings.isVisible()) focus.focusHomeDock();
  }

  // Reclaim system keyboard/pointer focus and re-select a dock tile.
  // After Home-button intercept, webOS often leaves INPUT routed to stock Home
  // even though Launch Home is painted on top — remote OK does nothing until we
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

  // An overlay app such as LG Settings takes the remote but leaves Launch Home
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
    voiceIndicator.start();
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
      voiceIndicator.hide();
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
    selfAppId: APP_ID,
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

  function keepSettingsFromBeforeUpdate() {
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST_RUN_VERSION_KEY);
      if (last === APP_VERSION) return;
      localStorage.setItem(LAST_RUN_VERSION_KEY, APP_VERSION);
    } catch (err) {
      return;
    }
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
    console.log('[launch-home] screensaver preview:', reason || '');
    customScreensaver.preview();
  }

  // Voice app launch. A voice assistant on the local socket sends appLaunch
  // ("launch Prime Video") or transcriptFinal; launching from this foreground
  // web app is what reliably brings native apps (Prime Video) to the front.
  // The assistant opens its own app itself and doesn't send appLaunch for it.
  function voiceLaunchDeduped(spec: LaunchableApp) {
    if (!spec) return;
    const key = String((spec.ids && spec.ids[0]) || spec.id || spec.title || '');
    const now = Date.now();
    if (key && key === lastVoiceLaunchKey && now - lastVoiceLaunchAt < 4000) {
      return;
    }
    lastVoiceLaunchKey = key;
    lastVoiceLaunchAt = now;
    apps.launchApp(spec).catch(function (err) {
      console.error(err);
    });
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
    setVoiceWsEnabled(!!(baseConfig.launcher && baseConfig.launcher.voiceEnabled));

    await applyUsbOverrides();
    if (stopped) return;
    updateClock();
    clockTimer = setInterval(updateClock, 30000);
    bindAppScrollHints();

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

    // In-app photo/clock screensaver after idle.
    customScreensaver.start();

    // One-shot force preview: URL, PalmSystem launch params, webOSRelaunch,
    // or root flag file /tmp/launch-home-preview-ss (written by install/SSH).
    if (launchParamsWantPreview()) {
      laterTracked(function () { triggerScreensaverPreview('launchParams'); }, 900);
      laterTracked(function () { triggerScreensaverPreview('launchParams-retry'); }, 2500);
    }
    // Root-written flag: reliable on TV even when launch params are dropped.
    try {
      execRoot(
        'if [ -f /tmp/launch-home-preview-ss ]; then cat /tmp/launch-home-preview-ss; rm -f /tmp/launch-home-preview-ss; fi'
      ).then(function (res: LunaResponse) {
        let text = (res && res.stdoutString ? String(res.stdoutString) : '').trim();
        if (!text && res && res.stdoutBytes) {
          try { text = String(atob(res.stdoutBytes)).trim(); } catch (e) { /* ignore */ }
        }
        if (text === '1' || text === 'preview' || text.indexOf('1') === 0) {
          laterTracked(function () { triggerScreensaverPreview('flag-file'); }, 600);
          laterTracked(function () { triggerScreensaverPreview('flag-file-retry'); }, 2200);
        }
      }).catch(function () { /* ignore */ });
    } catch (errFlag) { /* ignore */ }
    on(document, 'webOSRelaunch', function (ev: Event) {
      try {
        const d = ((ev as CustomEvent).detail) || {};
        const p = d.returnValue != null ? d : (d.params || d);
        if (p && isTrueFlag(p.previewSs)) {
          laterTracked(function () { triggerScreensaverPreview('webOSRelaunch'); }, 400);
        }
      } catch (errR) { /* ignore */ }
    });

    // Mic + AI badge while a voice assistant is listening (top-right).
    voiceIndicator.start();

    const removeVoiceListener = addVoiceListener(function (eventName, payload) {
      if (eventName === 'appLaunch') {
        const ids: string[] = [];
        if (payload && payload.id) ids.push(payload.id);
        if (payload && Array.isArray(payload.ids)) {
          payload.ids.forEach(function (id) {
            if (id && ids.indexOf(id) < 0) ids.push(id);
          });
        }
        if (!ids.length) return;
        voiceLaunchDeduped({
          id: ids[0],
          launchId: ids[0],
          ids: ids,
          title: (payload && payload.spoken) || ids[0]
        });
        return;
      }
      if (eventName === 'transcriptFinal') {
        const text = payload && (payload.text || payload.transcript);
        const spec = resolveVoiceLaunch(text, getConfig());
        if (spec) voiceLaunchDeduped(spec);
      }
    });
    removers.push(removeVoiceListener);

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

    // Side work that the first usable screen does not need: the before-update
    // settings backup, the terminal auto-pin, the weather timers, and re-asserting
    // the root/voice hooks. Each runs root/network work through Homebrew Channel,
    // which is itself still starting up on a cold boot, so run them once idle.
    whenIdle(function () {
      if (stopped) return;
      keepSettingsFromBeforeUpdate();
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
      syncVoice(cfg);
    });
  }

  function start() {
    if (started) return;
    started = true;
    init().catch(function (err) {
      showToast('Startup error — check USB paths');
      console.error(err);
    });
  }

  function stop() {
    stopped = true;
    if (clockTimer !== null) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
    clearTimeout(toastTimer);
    clearTimeout(resumeTimer ?? undefined);
    clearTimeout(reclaimTimer1);
    clearTimeout(reclaimTimer2);
    clearTimeout(reclaimTimer3);
    pendingTimers.forEach(function (timer) { clearTimeout(timer); });
    pendingTimers.length = 0;
    foregroundWatcher.stop();
    if (settings.isVisible()) settings.hide();
    weather.stop();
    customScreensaver.stop();
    voiceIndicator.stop();
    stopVoiceWs();
    background.destroy();
    music.stop();
    focus.destroy();
    removers.forEach(function (remove) { remove(); });
    removers.length = 0;
  }

  return {start: start, stop: stop};
}
