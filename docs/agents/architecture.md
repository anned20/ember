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

1. Leaf modules that need only config and the DOM: `weather`, `background`,
   `music`.
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

### The i18n seam

`lib/i18n.ts` is the one place viewer-facing text is resolved. A module imports
`t(key, params?)` — or `tn(key, count, params?)` for a counted string — straight
from `@lib/i18n.js`; there is no i18n framework and nothing is threaded through a
context. The keys and their English strings live in `lib/i18n-en.ts` (the source
of truth); `lib/i18n-nl.ts`, `lib/i18n-de.ts` and `lib/i18n-fr.ts` are typed as
complete records of those keys, so a missing translation fails `tsc`. The active
language is a module singleton, resolved once in `init()` from
`launcher.language` (`'auto'` follows the TV, whose preferred language is read
from `navigator`: `nl*`, `de*` and `fr*` pick those languages, anything else
English) before the platform gate and `buildModules()`, so a lookup cannot
change language mid-render. `setLanguage()` also sets `<html lang>`, and
the labels baked into `index.html` are worded by `applyMarkupLabels()` in
`main.ts`, so even the unsupported-TV surface speaks the resolved language.
Changing the setting in Settings reloads the app rather than re-rendering:
`settings.ts` saves and then restarts when the language differs.
Console logs, Luna names, config enum values, storage keys and user data (app
titles, input names, geocoded place names) are not translated. Neither are
stored values that name one of them: the last-backup note keeps the English
`TV` / `USB drive` / `TV and USB drive`, which `backupWhereLabel()` words at
render time.

Dates and times are formatted with `activeLocale()` (also from `@lib/i18n.js`):
`en-GB` for English, so its output never moved, and `nl-NL` for Dutch. The
12-hour versus 24-hour choice stays the Clock format setting, not the locale;
only the marker (`AM`/`PM`, `a.m.`/`p.m.`) comes from the dictionary.

An option table a pane reads from a config module (`PROFILE_OPTIONS`,
`TIMEZONE_OPTIONS`, `SOURCE_OPTIONS`, `PRESET_OPTIONS`) carries a `labelKey`, not
a label: the pane translates it while the entry's `value` — the stored config
value — stays put.

## Module shapes

Most modules are factories that return a handle: `createX(..., options)` returns
an object with methods plus the config accessor `applyConfig()`. The composition
root calls those methods. Modules never call each other except through injected
callbacks. Examples include `BackgroundController`, `MusicPlayer`, `AppGrid`,
`FocusManager`, `SettingsPanelHandle`, `CustomScreensaver`,
`WeatherPanelHandle`, `NetworkStatusHandle`, `InputRowHandle`,
`ChannelStripHandle`, `HomePaint` and `AllApps`.

Cross-cutting callbacks are passed in, such as `onToast`, `focusControl` and
`onBeforeLaunch`. If a module needs to do something the host owns, add a
callback to its options instead of importing the host.

`createHomePaint` (`home/paint.ts`) is config → DOM only: it applies the home
screen's Look (clock, Glass, Tile style, icon layout and Performance mode) and
owns its clock tick and layout listeners. It stays out of orchestration: the
`refreshAll` pass, the module order and the device settings remain in the
composition root. Its one non-DOM effect, the Performance-mode wallpaper
switch, arrives as the injected `onPerfMode` callback.

One module is not a factory: `dock` (`apps/dock.ts`) is a namespace of pure
functions over a `LauncherConfig`. It owns Dock membership — `entries`,
`contains`, `pin`, `addCustom`, `remove`, `move` — and every caller that changes
which apps are on the home row (the Settings Apps pane's draft, the All apps
menu's pin/unpin, the Launch Home import) goes through it. Each call returns a
new launcher; nothing is saved or painted. `loadConfig` runs a repair with the
same rules, so a restored config cannot leave a dangling `custom:` id or an
exact duplicate pinned id.

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

`createFocusManager` in `focus.ts` is the key router for the home surface. Rows
are declared in `focus-row.ts` (`RowId`, `ROW_DEFS`). Each row knows its index
scheme and which row a directional move hands off to, so the focus manager
routes a key to a row instead of naming each tile.

When the Settings panel is the active surface, the router delegates direction
keys, the wheel and photo-tile Select to `settings/navigation.ts`
(`createSettingsNavigation`). The panel owns its tab bar, header actions,
sequential/row movement, the photo picker and value adjustment; the router lends
it `focusItem`/`isFocusable`/`noteRemoteNav` as a host, so focus painting keeps
one owner. The wheel scrolls `.settings-body` natively (the module drives it
itself when the Magic Remote cursor is not over the pane) and, once it settles,
re-anchors focus to the nearest visible row — without scrolling again — so D-pad
continues from what is on screen. The router imports the standalone
`settings/text-gate.ts`, not the panel, so importing it no longer loads the panel
and its eight panes.

For key handling, `focus.ts` calls the callbacks `main.ts` passes: `onNumber`,
`onBack`, `onRed`/`onGreen`/`onBlue`, `onVolume*` and `onChannel*`. Those
callbacks decide what an open surface should swallow. For example, `onBack`
unwinds All apps, then the channels strip, then Settings. Add a key by extending
the manager's options and wiring it in `main.ts`, not by adding a document
listener.

Tiles marked `data-long-press` get a second gesture: Select keydown starts a
1.5 s timer and the tile clicks on keyup (a tap opens the app), while the timer
firing calls `onLongPress(el)` and swallows the release (All apps opens that
app's context menu). Unmarked controls keep clicking on keydown.

## Lifecycle

- `start()` calls `init()`, guarded so it runs once.
- `init()` paints fast and defers slow work:
  1. USB overrides, clock, volumes, screensaver setting.
  2. `apps.renderShell()` and `focus.focusHomeDock()`, so the dock is
     interactive immediately. A cold boot replaces stock Home, so speed beats
     completeness.
  3. `await refreshAll()` fills in tiles, background, inputs, channels and music.
  4. `customScreensaver.start()`, the document and window listeners, and
     `foregroundWatcher.start()`.
  5. `whenIdle(...)` runs the after-update work (the old voice assistant's
     teardown, the before-update backup), the terminal auto-pin, weather and the
     root hook re-assert. These do root or network work and must not compete with
     the first paint.
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

1. Music. It pauses ambient audio when Ember actually left the foreground
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

Ember supports **webOS 22 or later** ([ADR-0001](../adr/0001-webos-22-floor.md)).
`luna/platform.ts` is the one place the contract is decided: `getSdkVersion`
reads the TV, `isSupportedPlatform` folds in the Chromium-87 user-agent
fallback, and `main.ts`'s `init()` runs the gate as its first step — before
`buildModules()`, so an unsupported TV gets no Luna subscriptions, root hooks or
foreground watcher. `lib/unsupported-surface.ts` renders the full-screen
message.

There are no prototype polyfills: the floor guarantees native `fetch`,
`Array.find`, `Object.assign` and `String.endsWith/padStart`. Luna calls go
through `luna/luna-transport.ts`, which walks the ladder of fallbacks for each
request. Do not reintroduce old-webOS branches; if a platform fact is uncertain,
the ADR's "verify on device" note is the place to record it.
