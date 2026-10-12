# Architecture

How the app is put together, so a change lands in the right module. Module
locations are in `docs/agents/layout.md` and terms in `CONTEXT.md`.

## Entry and composition root

`boot.ts` calls `createApp().start()`. Everything else is composed inside
`createApp()` in `main.ts`. There is no framework, no router and no DI
container. `main.ts` is the composition root: it reads DOM elements, creates
each module with the collaborators it needs, and connects them through
callbacks.

`createApp()` composes in dependency order:

1. Leaf modules that need only config and the DOM: `voiceIndicator`, `weather`,
   `background`, `music`.
2. Rows and surfaces: `channelStrip`, `inputs`, `customScreensaver`, `settings`,
   `apps`, `focus`, `allApps`.

A few edges are genuinely cyclic: focus with settings and apps, and settings
with the screensaver. They are broken with forward-declared handles
(`let focus: FocusManager;` and so on) that `main.ts` assigns before any
callback can run. Keep that pattern if you add a cyclic edge. Do not reach
across modules directly.

### The config seam

`main.ts` owns two config views:

- `getBaseConfig()` returns the raw config as stored.
- `getConfig()` returns `applyActiveProfile(baseConfig)`, the effective config
  every consumer reads, with the active profile merged over the base.

Modules receive `getConfig` as a function rather than a snapshot, so they always
read current values. Writes go through `setConfig()` and `saveConfig()`, and the
Settings `onSave` handler re-applies everything: `refreshAll()`,
`applyHomeVolume()`, `applyScreensaverSetting()`,
`customScreensaver.applyConfig()` and `syncRootHooks()`.

## Module shapes

Most modules are factories that return a handle: `createX(..., options)` returns
an object with methods plus the config accessor `applyConfig()`. The composition
root calls those methods. Modules never call each other except through injected
callbacks. Examples include `BackgroundController`, `MusicPlayer`, `AppGrid`,
`FocusManager`, `SettingsPanelHandle`, `CustomScreensaver`,
`WeatherPanelHandle`, `InputRowHandle`, `ChannelStripHandle` and `AllApps`.

Cross-cutting callbacks are passed in, such as `onToast`, `focusControl` and
`onBeforeLaunch`. If a module needs to do something the host owns, add a
callback to its options instead of importing the host.

### The Settings pane seam

`settings.ts` is the Settings composition root. It owns the panel state, the
category nav, the header, Save and the focus helpers. Each category pane is a
module under `settings/panes/` that returns a `PaneHandle` (`build`, an optional
`load`, an optional `onSave`), built with a `SettingsContext`
(`settings/pane.ts`) carrying the config, the host options, whether the panel is
open, the binder, the pane containers and the root's focus helpers. The root
builds the moved panes in category order and drives each pane's `load` under a
deadline; a pane's own async work (the USB scan) checks `isVisible` before it
writes. Panes never import each other or reach into the root's state; a coupling
between two panes goes through a handle method (the Profile → Background note is
one: the Background pane extends `PaneHandle` with `setProfile`, and whoever
builds the profile picker calls it).

## Focus

`createFocusManager` in `focus.ts` is the single key router. Rows are declared
in `focus-row.ts` (`RowId`, `ROW_DEFS`). Each row knows its index scheme and
which row a directional move hands off to, so the focus manager routes a key to
a row instead of naming each tile.

For key handling, `focus.ts` calls the callbacks `main.ts` passes: `onNumber`,
`onBack`, `onRed`/`onGreen`/`onBlue`, `onVolume*` and `onChannel*`. Those
callbacks decide what an open surface should swallow. For example, `onBack`
unwinds All apps, then the channels strip, then Settings. Add a key by extending
the manager's options and wiring it in `main.ts`, not by adding a document
listener.

## Lifecycle

- `start()` calls `init()`, guarded so it runs once.
- `init()` paints fast and defers slow work:
  1. USB overrides, clock, volumes, screensaver setting.
  2. `apps.renderShell()` and `focus.focusHomeDock()`, so the dock is
     interactive immediately. A cold boot replaces stock Home, so speed beats
     completeness.
  3. `await refreshAll()` fills in tiles, background, inputs, channels and music.
  4. `customScreensaver.start()`, the voice indicator and listener, the
     document and window listeners, and `foregroundWatcher.start()`.
  5. `whenIdle(...)` runs the before-update backup, terminal auto-pin, weather,
     root hook re-assert and voice sync. These do root or network work and must
     not compete with the first paint.
- `stop()` clears every timer, stops the watcher and modules, and runs the
  `removers` (listeners registered through the local `on()` helper). Register
  all listeners and timers through `on()` and `laterTracked()` so `stop()`
  leaves the document clean.

`refreshAll({resume})` is the "re-paint from config" pass. With `resume: true`,
meaning returning from an app, the background, music and app grid reuse what is
already painted when their settings have not changed (`reuse`), and focus stays
where it was.

## The foreground watcher

`createForegroundWatcher` in `lib/foreground-watcher.ts` polls the system
foreground app id and drives three things:

1. Music. It pauses ambient audio when Launch Home actually left the foreground
   while a launch is pending (`launchState.shouldPauseForLaunch`).
2. Launch recovery. It hands the observation to `launch-state.ts` and acts on
   the result: `reassert` brings the native card forward, `close` kills the
   stuck app and calls the injected `reclaimInput()`.
3. Home intercept and return, through `maybeReturnToLounge` and the reclaim
   bursts.

It owns the poll loop, its state (`lastForegroundAppId`, `returningToLounge`,
the rate-limit) and the fast/idle cadence. Every side effect is an injected
callback — `main.ts` constructs it with the foreground reader, the launch /
close / reassert actions, the `isVisible` predicate, the music hook and the
activity sink, then calls `start`, `stop`, `poke`, `noteResume` and
`noteHidden`. The poll runs fast while a launch is pending and idle otherwise,
and only one poll runs at a time so slow root calls cannot pile up. Do not add
work to the poll that could block it.

## Platform compatibility

`lib/compat.ts` is the only module that patches built-in prototypes, and
`main.ts` imports it once at the top. Luna calls go through
`luna/luna-transport.ts`, which walks the ladder of fallbacks for each request.
Treat the `any` and casts in these two files as deliberate, and do not weaken
checks elsewhere to work around an old TV.
