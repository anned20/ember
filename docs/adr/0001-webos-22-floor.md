# 0001 — webOS 22 is the supported platform floor

- **Status:** Accepted
- **Date:** 2026-10-13
- **Issue:** [#56](https://github.com/anned20/ember/issues/56)

## Context

Ember carried compatibility code for webOS 3/4/5/6 TVs: ES2015 prototype
polyfills, an XHR `fetch` shim, `file://`-vs-relative URL dances for packaged
assets, an old-engine `play()` branch, `com.palm.*` app ids, `PalmSystem`
launch params, an `es2015` build target, and defensive polling/retry fallbacks
in the root Home watcher and boot-on-start scripts.

None of it can be tested: the only hardware the project owns is a webOS 25
OLED. The branches therefore drift, hide real failures on the TVs people
actually run, and cost background load (a 1 Hz `luna-send` poll) and cold-boot
time (an unconditional settle-and-retry loop).

The original goal, "minimum webOS 10 (25)", is narrower than necessary: webOS
22/23/24 already have every API the compatibility layers exist for (`fetch`,
`Array.find`, `Object.assign`, `String.endsWith/padStart`, `rVFC`,
`webOSSystem`, the modern `com.webos.*` app ids). Requiring exactly 25 would
remove the same code while dropping four release years of users.

## Decision

**Ember supports webOS 22 or later.** The floor is expressed as
`sdkVersion >= 7` in `src/ts/luna/platform.ts` (`MIN_WEBOS_SDK`).

- **Enforcement is a runtime gate.** At startup, before any module is built,
  the composition root reads the TV's `sdkVersion`. When it is below the floor
  it renders a full-screen "This TV is too old" surface and returns, so no home
  screen, Luna ladder, root hook or foreground watcher is ever set up.
- **The gate keys on the real requirement, Chromium 87.** When `sdkVersion` is
  known, it is judged on the sdk. When the TV does not answer (0/empty), the
  gate accepts only a user agent reporting Chromium >= 87. This keeps the
  desktop preview alive and handles a TV whose Luna call failed.
- **The sdk-to-year mapping** assumed here is `6 = webOS 6`, `7 = 22`, `8 = 23`,
  `9 = 24`, `10 = 25`. **Verify on the target OLED before relying on it:** an
  off-by-one would admit webOS 6 or reject webOS 22.
- **Legacy *settings* handling is kept, legacy *platform* handling is dropped.**
  The screensaver `5→3` / `15→10` coercion and the `returnOnAppExit` setting are
  backup-compatibility concerns, not old-TV branches, and remain.
- **Backup compatibility is unchanged.** No schema or migration change.
  `configFromBackup` / `fitSettings` tolerate ids and values this version no
  longer uses.

The removals ship in the same release as the gate, after it. Removing the
compatibility code without the gate would let an unsupported TV update into a
hard crash.

## Consequences

- All webOS 3/4/5/6 compatibility code is removed: the polyfills and XHR fetch
  shim, the multi-form built-in image URL list, the old-engine `play()` branch,
  PalmSystem, and the `luna-send`/poll/settle fallbacks in the root shell
  scripts. The `com.palm.app.settings` id stays: it is LG's Settings app on
  every supported release, not old-TV compatibility.
- The build target is `es2020`, so esbuild and `tsc` stop downleveling optional
  chaining, nullish coalescing and async.
- The Home watcher relies on a durable foreground subscription instead of
  polling every second, and boot-on-start launches without a settle delay.
- `getSdkVersion` / `isSupportedPlatform` in `platform.ts` are the one place
  the supported-platform contract is decided and enforced.
- The background/music packaged-asset paths use a single URL form per image.

## Alternatives considered

- **Require exactly webOS 25.** Removes the same compatibility code but drops
  four release years of users for no API benefit.
- **Advisory minimum, no gate.** A warning-only floor leaves an unsupported TV
  running degraded and misbehaving (dead dock, stuck launches) instead of
  failing closed and visibly.
- **A manifest minimum-version.** `appinfo.json` has no minimum-version field
  for a sideloaded IPK, so the gate is necessarily runtime.
