/**
 * The English dictionary: the source of truth for every translated string.
 *
 * Keys are flat and prefixed by area, so a key names the surface it belongs to
 * (`settings.*` the Settings panel shell, `settings.category.*` its category
 * list, `system.*` the System pane, and so on). `nl.ts` is typed as a complete
 * record of these keys, so a forgotten translation fails the typecheck.
 *
 * `{name}` placeholders are filled in by `t()`; a counted string uses a
 * `…​.one` / `…​.other` pair (see `tn`). Keep the values as they read today: the
 * English interface must not change when a string moves in here.
 */
export const en = {
  // ── The Settings panel shell (settings.ts) ────────────────────────────────
  'settings.tagline': 'Warm, bright, yours.',
  'settings.version': 'Settings · Version {version}',
  'settings.close': 'Close',
  'settings.save': 'Save',
  'settings.loading': 'Loading settings…',
  'settings.loadFailed': 'Could not load settings. Press Close and try again.',
  'settings.loadUnfinished': 'Settings did not finish loading. Close and open again.',
  'settings.runUser.checking': 'Running as: checking…',
  'settings.runUser.slow': 'Running as: no answer from Homebrew Channel (root)',
  'settings.runUser.unrooted': 'Running as: unknown (not rooted / no Homebrew Channel)',
  'settings.runUser.root': 'Running as: {user} — app scanning available',
  'settings.runUser.limited': 'Running as: {user} — not root, app scanning may be limited',
  'settings.runUser.unknown': 'Running as: unknown',

  // ── The category list, in list order ──────────────────────────────────────
  'settings.category.look': 'Look',
  'settings.category.look.sub': 'Profile, wallpaper, clock, icons',
  'settings.category.music': 'Music',
  'settings.category.music.sub': 'Ambient music and its volume',
  'settings.category.screensaver': 'Screensaver',
  'settings.category.screensaver.sub': '{brand} and TV screensavers',
  'settings.category.apps': 'Apps',
  'settings.category.apps.sub': 'Pinned apps, add or import apps',
  'settings.category.inputs': 'Inputs & channels',
  'settings.category.inputs.sub': 'HDMI inputs, Live TV channels',
  'settings.category.weather': 'Weather',
  'settings.category.weather.sub': 'Forecast and location',
  'settings.category.system': 'System',
  'settings.category.system.sub': 'Volume levels, Home button, boot, performance',
  'settings.category.tools': 'Tools',
  'settings.category.tools.sub': 'Backup & restore, TV check, updates',

  // ── The System pane (panes/system.ts) ─────────────────────────────────────
  'system.language': 'Language',
  'system.language.auto': 'Automatic',
  'system.language.en': 'English',
  'system.language.nl': 'Nederlands',
  'system.volumeAtHome': 'Volume in {brand}',
  'system.volumeOnLaunch': 'Volume when apps launch',
  'system.volume.dontChange': 'Don’t change',
  'system.volumeHint': 'TV system volume (0–100). “Don’t change” keeps whatever you set with the remote. Otherwise {brand} switches to the first level when you return home, and the second when Netflix / HDMI / other apps launch.',
  'system.perfMode': 'Performance mode (low-spec TVs)',
  'system.perfModeHint': 'Turns off the frosted glass and uses 1920px wallpapers. With Slow zoom on (Look), the glass is already off while the wallpaper moves.',
  'system.launchOnHome': 'Launch on Home button',
  'system.launchOnHomeHint': 'When enabled, a root service opens {brand} whenever stock Home appears. A brief flash of the LG home screen is normal (the TV opens Home first; we cannot block the key without a separate input-hook app). Requires rooted TV + Homebrew Channel. Toggle off/on and Save after updates if it stops working.',
  'system.bootOnStart': 'Boot on TV start',
  'system.bootOnStartHint': 'When enabled, a root init.d script launches {brand} after the TV powers on. Requires rooted TV + Homebrew Channel (same as Home button). A short delay on boot is normal while webOS starts. With Quick Start+ on, the TV only wakes from standby and this doesn’t run; turn it off under General → Devices → TV Management.',

  // ── Counted strings ───────────────────────────────────────────────────────
  // The USB music scan (panes/music.ts).
  'music.usbScan.found.one': '{count} track found — tick the ones to play.',
  'music.usbScan.found.other': '{count} tracks found — tick the ones to play.'
} as const;

/** Every key the English dictionary defines. */
export type TranslationKey = keyof typeof en;
