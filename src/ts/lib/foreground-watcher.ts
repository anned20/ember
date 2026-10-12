/**
 * The foreground watcher, lifted out of main.js so the poll loop, its state and
 * its cadence live in one place and can be exercised with a fake foreground
 * source. It polls the system foreground app id and drives three things:
 *
 * 1. Music: it pauses ambient audio when Launch Home actually left the
 *    foreground while a launch is in flight.
 * 2. Launch recovery: it hands the observation to `launch-state.ts` and acts on
 *    the result — `reassert` brings the native card forward, `close` kills the
 *    stuck app and reclaims input.
 * 3. Home intercept and return: when stock Home comes up it brings Launch Home
 *    back, and when we reappear it regains the remote.
 *
 * It performs no DOM work: every side effect is an injected callback.
 */
import {createLaunchState} from './launch-state.js';
import type {LaunchState} from './launch-state.js';
import {isHomeApp} from './remote.js';
import type {LauncherConfig} from './types.js';

// Each foreground check runs luna-send as root through Homebrew Channel (a new
// shell and process every time). Polling every 800 ms around the clock, also
// while another app was open, kept the TV busy. Poll quickly only while a
// launch is being watched; otherwise slowly. The root home-watcher reacts to
// the Home button itself; this is its backup.
const POLL_FAST_MS = 800;
const POLL_IDLE_MS = 3000;

// The root home-watcher and the in-app poll can both fire when stock Home
// appears, so coalesce a burst of them into one return.
const HOME_INTERCEPT_RATE_LIMIT_MS = 1500;

/**
 * Whether Launch Home should intercept stock Home and bring itself back.
 * `launchOnHome` (preferred) or legacy `returnOnAppExit`: when the stock home
 * comes to the foreground after another app (Home button or app exit),
 * relaunch Launch Home so it acts as the home screen.
 */
export function shouldInterceptHome(launcher: LauncherConfig | null | undefined): boolean {
  if (!launcher) return false;
  return !!(launcher.launchOnHome || launcher.returnOnAppExit);
}

/** What the watcher reports to Settings -> TV check. */
export interface ForegroundActivitySink {
  /** A foreground app id was observed. */
  noteForeground(appId: string): void;
  /** We brought ourselves back because stock Home came up. */
  noteReturn(): void;
  /** Stuck-app recovery closed another app. */
  noteClose(): void;
}

/** The collaborators the watcher needs; it imports nothing but its machine. */
export interface ForegroundWatcherOptions {
  /** Launch Home's own app id. */
  selfAppId: string;
  /** The system foreground app id, '' when unknown. */
  getForegroundApp(): Promise<{appId?: string}>;
  /** Launch an app in the sandboxed applicationManager. */
  launchApp(id: string): Promise<unknown>;
  /** Launch an app via root luna-send, for backgrounded contexts. */
  launchAppViaRoot(id: string): Promise<unknown>;
  /** Close an app by id. */
  closeApp(id: string): Promise<unknown>;
  /** Whether our surface is on screen. */
  isVisible(): boolean;
  /** Whether to keep watching while backgrounded to intercept Home. */
  shouldInterceptHome(): boolean;
  /** Pause ambient music because a launch left Launch Home. */
  pauseMusic(): void;
  /** Reclaim the remote's input focus at once. */
  reclaimInput(): void;
  /** Reclaim input with the delayed bursts used after returning from an app. */
  reclaimBursts(): void;
  /** Where the activity counters go. */
  activity: ForegroundActivitySink;
  /** Whether the platform can be polled at all; defaults to always. */
  isAvailable?(): boolean;
}

/** The watcher handle. */
export interface ForegroundWatcher {
  /** Start polling; no-op when the platform cannot be polled. */
  start(): void;
  /** Stop polling and clear the timer. */
  stop(): void;
  /** Note that an app was launched, and poll again soon. */
  poke(): void;
  /** Our surface came back to the foreground; any launch in flight resolved. */
  noteResume(): void;
  /** Our surface was backgrounded, so a launch took the foreground normally. */
  noteHidden(): void;
  /** Whether a launch is still being watched. */
  isPending(): boolean;
}

export function createForegroundWatcher(options: ForegroundWatcherOptions): ForegroundWatcher {
  const launchState: LaunchState = createLaunchState({selfAppId: options.selfAppId});
  const isAvailable = options.isAvailable || function () { return true; };

  let timer: ReturnType<typeof setTimeout> | null = null;
  let on = false;
  let busy = false;
  let returningToLounge = false;
  let lastForegroundAppId = options.selfAppId;
  let lastHomeLaunchAt = 0;

  function nextDelay() {
    return launchState.isPending() ? POLL_FAST_MS : POLL_IDLE_MS;
  }

  function schedule(delay: number) {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(runPoll, delay);
  }

  // One check at a time: the next is scheduled only after this one finishes, so
  // slow root calls can't pile up on a busy TV.
  async function runPoll() {
    busy = true;
    try {
      await pollOnce();
    } finally {
      busy = false;
      // A poll in flight when stop() ran must not revive the timer.
      if (on) schedule(nextDelay());
    }
  }

  async function launchLoungeBestEffort() {
    try {
      await options.launchApp(options.selfAppId);
      return;
    } catch (err) {
      // Sandboxed launch often fails while we are backgrounded.
    }
    try {
      await options.launchAppViaRoot(options.selfAppId);
    } catch (err) {
      // Best-effort.
    }
  }

  // In-app backup for the root home-watcher: whenever stock Home is foreground,
  // bring Launch Home forward. (The root watcher is the reliable path when
  // suspended.)
  async function maybeReturnToLounge(appId: string) {
    if (!options.shouldInterceptHome()) return;
    if (returningToLounge) return;
    if (appId === options.selfAppId) return;
    if (!isHomeApp(appId)) return;

    const now = Date.now();
    if (now - lastHomeLaunchAt < HOME_INTERCEPT_RATE_LIMIT_MS) return;
    lastHomeLaunchAt = now;

    options.activity.noteReturn();
    returningToLounge = true;
    try {
      await launchLoungeBestEffort();
    } finally {
      returningToLounge = false;
    }
  }

  async function pollOnce() {
    const visible = options.isVisible();
    // Keep polling while backgrounded only when we may need to intercept Home.
    if (!visible && !options.shouldInterceptHome()) return;

    try {
      const res = await options.getForegroundApp();
      const appId = res.appId || '';
      options.activity.noteForeground(appId);

      // Only pause ambient when we actually left Launch Home (or launched an
      // app). Pausing whenever the foreground is not us kills music on cold
      // start (the poll often returns Home / empty for a few seconds after a
      // launch).
      if (appId && appId !== options.selfAppId &&
          launchState.shouldPauseForLaunch(visible)) {
        options.pauseMusic();
      }

      // Ghost-focus recovery (see launch-state.js). A launch that took the
      // remote but never painted is either re-asserted once (native streaming
      // apps) or closed and reclaimed.
      const recovery = launchState.observeForeground({
        now: Date.now(),
        appId: appId,
        visible: visible,
        returningToLounge: returningToLounge
      });

      if (recovery === 'reassert') {
        try {
          await options.launchAppViaRoot(appId);
        } catch (errAssert) {
          /* keep waiting for the native card */
        }
        return;
      }

      if (recovery === 'close') {
        returningToLounge = true;
        options.activity.noteClose();
        try {
          await options.closeApp(appId);
        } catch (err) {
          // The stuck app may already be gone; keep going.
        }
        try {
          await options.launchApp(options.selfAppId);
        } catch (err) {
          // Best-effort reclaim.
        } finally {
          returningToLounge = false;
        }
        options.reclaimInput();
        lastForegroundAppId = options.selfAppId;
        return;
      }

      // We just became the system foreground again (e.g. after Home intercept).
      // Force input reclaim even if visibilitychange was flaky.
      if (appId === options.selfAppId && lastForegroundAppId &&
          lastForegroundAppId !== options.selfAppId) {
        options.reclaimBursts();
      }

      await maybeReturnToLounge(appId);
      lastForegroundAppId = appId || lastForegroundAppId;
    } catch (err) {
      // Foreground polling is best-effort.
    }
  }

  return {
    start: function () {
      if (!isAvailable()) return;
      on = true;
      schedule(nextDelay());
    },
    stop: function () {
      on = false;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
    poke: function () {
      launchState.noteLaunch(Date.now());
      // Check soon after launching an app instead of waiting out the idle delay.
      if (!on || busy) return;
      schedule(POLL_FAST_MS);
    },
    noteResume: function () {
      launchState.noteResume();
      returningToLounge = false;
    },
    noteHidden: function () {
      launchState.noteHidden();
    },
    isPending: function () {
      return launchState.isPending();
    }
  };
}
