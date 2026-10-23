# Ember context

A single-context repo. This file is the ubiquitous language: the terms the code,
tests, settings and issues all use. Use these words in code, comments, tests and
issue titles instead of inventing synonyms. Architecture decisions are recorded
in `docs/adr/` (added as decisions are made).

Ember is a fullscreen home screen for a rooted LG webOS TV. It replaces
the stock Home surface with a dock of app tiles, an inputs row, and ambient
backgrounds and music, all on top of the webOS Luna service bus.

## The screen

- **Dock** (also home row): the row of app tiles the remote moves along
  (`focus.focusHomeDock`). Its rows are `apps`, `inputs` and `channels`.
- **Tile**: one focusable card in the dock. It can be a pinned or custom app, an
  input, a channel, or the All-apps tile.
- **App grid**: the dock's row of app tiles (`apps.ts`, `createAppGrid`).
- **All apps**: the full-screen overlay listing every installed app
  (`all-apps.ts`), opened by the All-apps tile.
- **Long press**: holding Select (OK) on an All-apps tile for 1.5 s opens that
  app's **context menu** (Pin/Unpin, Restart, Delete). The focus router owns the
  gesture (a `data-long-press` marker plus the `onLongPress` handler); a tap
  still opens the app. Delete asks first and is offered only for removable apps.
- **Inputs row**: the HDMI and TV input tiles (`inputs.ts`).
- **Channels**: Live TV channels. The Channels chip opens the channel strip
  above the inputs row (`channels.ts`). The setting is `favourites`, `all` or
  `off`.
- **Weather panel**: the home-screen card or inline weather line (`weather.ts`).
  The inline line also appears in the screensaver clock block.
- **Settings panel**: the category list and pane UI (`settings.ts`).
- **Screensaver**: two different things. The system screensaver is LG's gallery
  saver (`screensaverMinutes`). The in-app screensaver is Ember's own
  slideshow and clock shown while idle (`customScreensaver*`).

## Look

- **Background source**: where the wallpaper comes from. One of `builtin`
  (packaged photos), `preset` (gradient), `url` (online catalogue and custom
  URLs), `usb`, or `aerial`.
- **Aerial**: an Apple aerial clip played as video, streamed from Apple's CDN.
  Nothing is packaged (`aerials.ts`).
- **Glass**: the frosted tile material. Glass colour (`glassTint`), glass border
  (`glassBorder`) and focus colour (`focusColour`) recolour it. The base look is
  light glass with a white border.
- **Profile**: a named overlay on the base config: `default`, `night` or
  `cinema` (`profiles.ts`). A preset merged with `config.profiles[id]`.
- **Performance mode** (`perfMode`): drops blur and animation for weaker TVs.
- **Pinned app**: an app tile chosen by app id (`pinnedApps`). A **custom app**
  is a tile added by hand (`customApps`), possibly with its own icon.

## Lifecycle and the foreground

- **Foreground check** (foreground watcher): the poll of the system foreground
  app id (`createForegroundWatcher` in `lib/foreground-watcher.ts`). It also
  drives launch recovery. It polls every 800 ms while a launch is being watched,
  and every 3 s otherwise.
- **Launch state**: the ghost-focus state machine (`launch-state.ts`). A pending
  launch that never paints is a **stuck app**.
- **Recovery**: what the launch state asks for. `reassert` brings the app's
  native card forward once; `close` closes the stuck app and reclaims.
- **Reclaim**: re-asserting keyboard and pointer focus plus a dock tile after
  webOS routed input to stock Home or another surface (`reclaimInput`).
- **Home watcher**: the root init.d script that relaunches Ember when
  stock Home appears (`launchOnHome`). **Boot on start** (`bootOnStart`) does
  the same at power-on.
- **Homebrew Channel** (root): app scanning, the Home watcher and boot-on-start
  all need the elevated Luna service.
- **Activity**: counters of what happened in the background (relaunches,
  returns, closes, reclaims, foreground ids), shown under Settings → Tools →
  TV check (`activity.ts`).

## Platform

- **Supported platform floor**: webOS 22 (Chromium 87), expressed as
  `sdkVersion >= 7` (`MIN_WEBOS_SDK`) in `luna/platform.ts`. The composition
  root enforces it at startup; below the floor it shows the **unsupported
  surface** and starts nothing. See `docs/adr/0001-webos-22-floor.md`.
- **sdkVersion**: the TV's platform number. `6` = webOS 6, `7` = 22, `8` = 23,
  `9` = 24, `10` = 25.

## Luna

- **Luna**: the webOS service bus. A **Luna request** is a call to a service
  (`luna.ts`, `luna-transport.ts`). **Root exec** runs a shell command through
  Homebrew Channel (`execRoot`).
- **Ladder**: the ordered fallback strategies a Luna request tries
  (`luna-transport.ts`, `LadderRung`), for services that differ across webOS
  versions.

## Settings, config and backups

- **Config**: the whole settings tree (`Config` in `lib/types.ts`): `version`,
  `profile`, `profiles`, `background`, `music`, `weather`, `launcher`.
- **Schema version** (`CONFIG_SCHEMA_VERSION`): the layout version of the
  settings. A **migration** brings an older config up one version
  (`CONFIG_MIGRATIONS`). A **repair** is a fix that runs on every load
  (`CONFIG_REPAIRS`).
- **Backup**: a settings file with a **format** (wrapper layout) and a
  **schema** (settings layout). Its **reason** is `manual`, `before-restore` or
  `before-update`.
- **Fit**: reshaping a backup's settings to this version (`configFromBackup`). A
  setting of the wrong kind is a **skip** (`why: 'type'`) and keeps the TV's
  current value. One from a newer version is `why: 'newer'`, kept but unused.
- **Device settings**: settings that belong to the TV rather than the person
  (`DEVICE_SETTINGS`), kept as-is across a restore (for example
  `terminalChecked`). An old config's `voiceEnabled` key is ignored, not
  migrated: Ember has no voice assistant any more.
- **Language**: the interface language, the `launcher.language` setting: `auto`,
  `en`, `nl`, `de` or `fr`. **Automatic** follows the TV: a preferred language
  starting with `nl`, `de` or `fr` is Dutch, German or French, anything else
  English. **Translation** goes through `t()` / `tn()` (`lib/i18n.ts`), whose keys
  and English strings live in `lib/i18n-en.ts` (source of truth) and whose
  translations live in `lib/i18n-nl.ts`, `lib/i18n-de.ts` and `lib/i18n-fr.ts`.
  Only viewer-facing text is translated: never console logs, config values,
  storage keys or user data.
- **Launch Home import** (first-run import): on the first start with no stored
  config, Ember imports the newest Launch Home backup it can find, so an upgrade
  keeps its setup (`importLegacySettings`). Launch Home backups also stay
  restorable through the normal **fit** path.

## Voice

- **Voice teardown**: the one-shot removal of the voice assistant an earlier
  Ember installed (`scripts/cleanup-voice.sh`). Ember has no voice assistant any
  more; on its first start after the update it stops the old daemon, removes the
  boot hook (`hooks.voice`) and gives LG's voice services back. The config
  directory with the provider keys and the sign-in is left for the standalone
  **Ember Voice** app, which also reuses the old card's app id. See
  `docs/adr/0002-voice-upgrade-path.md`.

See `docs/agents/` for how each of these is wired and extended.
