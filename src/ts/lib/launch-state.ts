/**
 * The ghost-focus launch state machine, lifted out of main.js so it can be
 * exercised on its own.
 *
 * When the user launches an app from the dock we start watching it. A launch
 * that never takes the graphics foreground — it grabs the remote but our
 * surface stays on top, so the launcher feels frozen — is recovered by either
 * re-asserting the native card once, or closing the stuck app and reclaiming
 * the launcher. See `observeForeground` for the exact decision.
 */

/** What to do about a launch that may have become the stuck foreground app. */
export type LaunchRecovery = 'none' | 'reassert' | 'close';

/** The launch machine needs to know our own app id to spot "not us". */
export interface LaunchStateOptions {
  /** Ember's own app id. */
  selfAppId: string;
}

/** One foreground poll's observation. */
export interface ForegroundObservation {
  /** Now, in ms. */
  now: number;
  /** The system foreground app id, '' when unknown. */
  appId: string;
  /** Whether our surface is on screen. */
  visible: boolean;
  /** Whether we are already bringing ourselves back (Home intercept). */
  returningToLounge: boolean;
}

/** The launch state machine handle. */
export interface LaunchState {
  /** The user launched an app from the dock. */
  noteLaunch(now: number): void;
  /** Our surface was backgrounded, so a launch took the foreground normally. */
  noteHidden(): void;
  /** We are back on screen; any launch in flight has resolved. */
  noteResume(): void;
  /** Whether a launch is still being watched. */
  isPending(): boolean;
  /** Whether our surface was backgrounded since the last launch. */
  wentHiddenSinceLaunch(): boolean;
  /** Whether ambient music should stay paused for a launch in flight. */
  shouldPauseForLaunch(visible: boolean): boolean;
  /** Advance the machine on a foreground poll; returns the recovery to run. */
  observeForeground(obs: ForegroundObservation): LaunchRecovery;
}

const DEFAULT_REASSERT_APPS = /amazon|netflix|youtube|disney|iplayer|apple\.appletv/i;
const GHOST_DELAY_MS = 2500;
const WATCH_WINDOW_MS = 15000;

export function createLaunchState(options: LaunchStateOptions): LaunchState {
  const selfAppId = options.selfAppId;

  let pending = false;
  let hiddenSinceLaunch = false;
  let reasserted = false;
  let launchAt = 0;

  return {
    noteLaunch: function (now: number) {
      pending = true;
      hiddenSinceLaunch = false;
      reasserted = false;
      launchAt = now;
    },
    noteHidden: function () {
      hiddenSinceLaunch = true;
    },
    noteResume: function () {
      pending = false;
    },
    isPending: function () {
      return pending;
    },
    wentHiddenSinceLaunch: function () {
      return hiddenSinceLaunch;
    },
    shouldPauseForLaunch: function (visible: boolean) {
      return !visible || pending || hiddenSinceLaunch;
    },
    observeForeground: function (obs: ForegroundObservation) {
      // Ghost-focus recovery: we launched something, our own surface was never
      // backgrounded, yet the foreground app is not us.
      if (pending && !hiddenSinceLaunch && obs.visible &&
          obs.appId && obs.appId !== selfAppId && !obs.returningToLounge &&
          (obs.now - launchAt) > GHOST_DELAY_MS) {
        if (DEFAULT_REASSERT_APPS.test(obs.appId)) {
          if (!reasserted) {
            reasserted = true;
            return 'reassert';
          }
          return 'none';
        }
        return 'close';
      }

      // Stop watching a launch once it clearly resolved one way or another.
      if (pending && (hiddenSinceLaunch || (obs.now - launchAt) > WATCH_WINDOW_MS)) {
        pending = false;
      }
      return 'none';
    }
  };
}
