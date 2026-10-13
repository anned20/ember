import {afterEach, describe, expect, it, vi} from 'vitest';
import {createForegroundWatcher, shouldInterceptHome} from '@lib/foreground-watcher.js';
import type {ForegroundWatcherOptions} from '@lib/foreground-watcher.js';
import type {LauncherConfig} from '@lib/types.js';
import {BRAND} from '@lib/brand.js';

const SELF: string = BRAND.appId;

function makeHarness(overrides: Partial<ForegroundWatcherOptions> = {}) {
  let visible = true;
  let intercept = false;
  let nextAppId = SELF;
  const calls = {
    launch: [] as string[],
    launchViaRoot: [] as string[],
    close: [] as string[],
    pause: 0,
    reclaim: 0,
    bursts: 0,
    returns: 0,
    closes: 0,
    seen: [] as string[]
  };
  const options: ForegroundWatcherOptions = Object.assign({
    selfAppId: SELF,
    getForegroundApp: function () {
      return Promise.resolve({appId: nextAppId});
    },
    launchApp: function (id: string) { calls.launch.push(id); return Promise.resolve({}); },
    launchAppViaRoot: function (id: string) {
      calls.launchViaRoot.push(id);
      return Promise.resolve({});
    },
    closeApp: function (id: string) { calls.close.push(id); return Promise.resolve({}); },
    isVisible: function () { return visible; },
    shouldInterceptHome: function () { return intercept; },
    pauseMusic: function () { calls.pause += 1; },
    reclaimInput: function () { calls.reclaim += 1; },
    reclaimBursts: function () { calls.bursts += 1; },
    activity: {
      noteForeground: function (appId: string) { calls.seen.push(appId); },
      noteReturn: function () { calls.returns += 1; },
      noteClose: function () { calls.closes += 1; }
    }
  }, overrides);

  return {
    watcher: createForegroundWatcher(options),
    calls: calls,
    setForeground: function (id: string) { nextAppId = id; },
    setVisible: function (value: boolean) { visible = value; },
    setIntercept: function (value: boolean) { intercept = value; }
  };
}

afterEach(function () {
  vi.useRealTimers();
});

describe('shouldInterceptHome', function () {
  it('follows launchOnHome or the legacy returnOnAppExit', function () {
    expect(shouldInterceptHome({launchOnHome: true} as LauncherConfig)).toBe(true);
    expect(shouldInterceptHome({returnOnAppExit: true} as LauncherConfig)).toBe(true);
    expect(shouldInterceptHome({} as LauncherConfig)).toBe(false);
    expect(shouldInterceptHome(null)).toBe(false);
  });
});

describe('createForegroundWatcher', function () {
  it('polls on the idle cadence from start and stops on stop', async function () {
    vi.useFakeTimers();
    const h = makeHarness();

    h.watcher.start();
    expect(h.calls.seen).toEqual([]);

    await vi.advanceTimersByTimeAsync(3000);
    expect(h.calls.seen).toEqual([SELF]);

    h.watcher.stop();
    await vi.advanceTimersByTimeAsync(10000);
    expect(h.calls.seen).toEqual([SELF]);
  });

  it('does not revive the timer when stopped mid-poll', async function () {
    vi.useFakeTimers();
    let resolveFetch: (value: {appId: string}) => void = function () {};
    let fetches = 0;
    const h = makeHarness({
      getForegroundApp: function () {
        fetches += 1;
        return new Promise(function (resolve) { resolveFetch = resolve; });
      }
    });

    h.watcher.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetches).toBe(1);

    h.watcher.stop();
    resolveFetch({appId: SELF});
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetches).toBe(1);
  });

  it('leaves a launch that painted alone', async function () {
    vi.useFakeTimers();
    const h = makeHarness();

    h.watcher.start();
    h.watcher.poke();
    // The app took the foreground: our surface was hidden, so it painted.
    h.watcher.noteHidden();
    h.setForeground('netflix');

    await vi.advanceTimersByTimeAsync(4000);
    expect(h.calls.launchViaRoot).toEqual([]);
    expect(h.calls.close).toEqual([]);
  });

  it('re-asserts a native streaming app that never painted', async function () {
    vi.useFakeTimers();
    const h = makeHarness();

    h.watcher.start();
    h.watcher.poke();
    h.setForeground('netflix');

    await vi.advanceTimersByTimeAsync(3300);
    expect(h.calls.launchViaRoot).toContain('netflix');
    expect(h.calls.close).toEqual([]);
  });

  it('closes an ordinary app that never painted and reclaims input', async function () {
    vi.useFakeTimers();
    const h = makeHarness();

    h.watcher.start();
    h.watcher.poke();
    h.setForeground('com.example.viewer');

    await vi.advanceTimersByTimeAsync(3300);
    expect(h.calls.close).toEqual(['com.example.viewer']);
    expect(h.calls.launch).toContain(SELF);
    expect(h.calls.reclaim).toBe(1);
    expect(h.calls.closes).toBe(1);
  });

  it('pauses ambient music when Ember is left during a launch', async function () {
    vi.useFakeTimers();
    const h = makeHarness();

    h.watcher.start();
    h.watcher.poke();
    h.setForeground('netflix');

    await vi.advanceTimersByTimeAsync(800);
    expect(h.calls.pause).toBe(1);
  });

  it('brings Ember back when stock Home comes up, then rate-limits', async function () {
    vi.useFakeTimers();
    const h = makeHarness();

    h.setIntercept(true);
    h.watcher.start();
    h.watcher.poke();
    h.setForeground('com.webos.app.home');

    await vi.advanceTimersByTimeAsync(800);
    expect(h.calls.launch).toContain(SELF);
    expect(h.calls.returns).toBe(1);

    await vi.advanceTimersByTimeAsync(800);
    expect(h.calls.returns).toBe(1);
  });

  it('does not poll while backgrounded unless Home may be intercepted', async function () {
    vi.useFakeTimers();
    const h = makeHarness();

    h.watcher.start();
    h.setVisible(false);
    await vi.advanceTimersByTimeAsync(3000);
    expect(h.calls.seen).toEqual([]);

    h.setIntercept(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(h.calls.seen.length).toBeGreaterThan(0);
  });

  it('reclaims with bursts when Ember returns to the foreground', async function () {
    vi.useFakeTimers();
    const h = makeHarness();

    h.watcher.start();
    h.setForeground('netflix');
    await vi.advanceTimersByTimeAsync(3000);

    h.setForeground(SELF);
    await vi.advanceTimersByTimeAsync(3000);
    expect(h.calls.bursts).toBe(1);
  });

  it('tracks a pending launch and clears it on resume', async function () {
    vi.useFakeTimers();
    const h = makeHarness();

    h.watcher.start();
    expect(h.watcher.isPending()).toBe(false);

    h.watcher.poke();
    expect(h.watcher.isPending()).toBe(true);

    h.watcher.noteResume();
    expect(h.watcher.isPending()).toBe(false);
  });

  it('does not poll when the platform cannot be polled', async function () {
    vi.useFakeTimers();
    const h = makeHarness({isAvailable: function () { return false; }});

    h.watcher.start();
    await vi.advanceTimersByTimeAsync(10000);
    expect(h.calls.seen).toEqual([]);
  });
});
