# Config and backups

The settings tree, how it is stored and migrated, and how backups survive
version changes. The code is in `config/config.ts`, `config/profiles.ts`,
`settings/settings-backup.ts` and `luna/luna.ts`. Terms are in `CONTEXT.md`.

## The config tree

`Config` in `lib/types.ts` is the whole settings tree: `version`, `profile`,
`profiles`, and the sections `background`, `music`, `weather` and `launcher`.
`DEFAULT_CONFIG` in `config.ts` is the canonical shape, and every setting has a
default there.

- Storage: `localStorage` under `ember.config.v1`, JSON-encoded.
- Loading: `loadConfig()` does `deepMerge(DEFAULT_CONFIG, stored)`, then runs
  `normalizeBackgroundConfig` and `normalizeMusicConfig`, then `migrateConfig`.
  If a migration changed anything it writes back. A corrupt entry falls back to
  defaults.
- Effective vs base: consumers read `applyActiveProfile(config)`, the active
  profile merged over the base. `main.ts` exposes this as `getConfig()`.

## Schema version and migrations

`CONFIG_SCHEMA_VERSION` in `config.ts` is the layout version of the settings.
Bump it whenever a setting's meaning, type or name changes, and add a matching
entry to `CONFIG_MIGRATIONS` keyed by the new version.

The rules, enforced by `test/config.test.ts`:

- `CONFIG_MIGRATIONS` has an entry for every version from `2` to
  `CONFIG_SCHEMA_VERSION`, with no gaps.
- `migrateConfig` runs the entries above the stored version in ascending order,
  and each step may assume the earlier ones ran.
- A step brings old data forward: set a new field's default, rename or drop a
  dead one. Keep it small and isolated, since the test drives one step at a
  time.
- `CONFIG_REPAIRS` are fix-ups that run on every load, even at the current
  version. Use them for values that can drift, such as the TV's allowed
  screensaver wait.

Stored settings from an older version run through migrations on load. A backup
from an older version runs through the same steps in `configFromBackup`.

## Profiles

`config/profiles.ts` holds `PROFILE_PRESETS` (`night` and `cinema`) as
`DeepPartial<Config>` overlays. `getProfileOverrides` merges the preset with
`config.profiles[id]`, and `applyActiveProfile` merges that over the base. A
profile never edits the base config. It only changes the effective view.

## Backups

A backup file (`settings-backup.ts`) is JSON with two independent versions:

- `format` (`BACKUP_FORMAT`) is the layout of the file wrapper. Bump it only
  when the wrapper changes, and keep reading older formats in `parseBackup`.
- `schema` is the settings layout (`config.version`), the `Config` schema above.

It also records `app`, `kind`, `appVersion`, `updatedTo`, `reason` (`manual`,
`before-restore` or `before-update`) and `savedAt`. `settingsBackupText` emits
ASCII only, with non-ASCII as `\u` escapes, because the text goes to the TV
through a shell in chunks (`rootWriteCommands`). `parseBackup` accepts the
`app` id from Ember or the old Launch Home app, so old backups still list and restore.

### Fitting a backup to this version

`configFromBackup(data, current)` returns `{config, skipped, schema, newer,
older}`, or `null` if `data` is not Ember settings. It:

1. Deep-merges the backup over `DEFAULT_CONFIG` and, unless the backup is
   newer, runs `migrateConfig`.
2. Runs `fitSettings`, which walks the current `DEFAULT_CONFIG` shape:
   - A key of the wrong kind becomes a skip of `{why: 'type'}`. The TV's current
     value is kept when it fits, otherwise the default.
   - A key this version does not have, from a newer backup, becomes a skip of
     `{why: 'newer'}`. It is kept but unused.
   - A key the backup is missing is filled from defaults.
3. Restores this TV's own device settings (`DEVICE_SETTINGS`) from `current`.
   They belong to the TV rather than the person, for example `terminalChecked`.

The `skipped` list drives the restore status line (`restoreReport`).

### Where backups live

All three are written as root:

- TV copy: `/home/root/.config/ember/settings-backup.json`. It survives a
  reinstall.
- Automatic copies: `/home/root/.config/ember/auto/`, holding one
  `before-restore.json` and the newest three `before-update-to-<version>.json`
  files (`writeAutoBackup`). `keepSettingsFromBeforeUpdate` in `main.ts` writes
  the before-update copy on the first start after an update.
- USB: `<drive>/ember/ember-settings.json`.

`readSettingsBackups` reads those, and also the Launch Home copies — the TV
`/home/root/.config/launch-home/settings-backup.json`, its `auto/` directory,
and `<drive>/lounge/launch-home-settings.json` on every mounted drive — so a
Launch Home backup shows up in the restore list.

### Importing Launch Home settings on first run

On the first start with no stored config, `importLegacySettings` in
`settings-backup.ts` imports the newest readable backup whose settings fit
through `configFromBackup` (so migrations apply), saves it as Ember's config and
shows a brief toast. With no backup, or one that doesn't fit, Ember starts on
defaults with no toast. `main.ts` calls it before `buildModules()`, passing the
backup reader (`readSettingsBackups`) in, so the decision is testable without the
TV filesystem.

## Checklist: add, remove or rename a setting

1. Type. Add or change the field in the right interface in `lib/types.ts`
   (`LauncherConfig`, `BackgroundConfig`, and so on).
2. Default. Set it in `DEFAULT_CONFIG` in `config/config.ts`.
3. Migration. Bump `CONFIG_SCHEMA_VERSION` and add a
   `CONFIG_MIGRATIONS[newVersion]` step that backfills or drops the field. If
   only the value can drift, add a `CONFIG_REPAIRS` entry instead.
4. UI. Add the control to the right pane in `settings/settings.ts` and
   `binder.bind(...)` it. See `docs/agents/adding-a-setting.md`.
5. Apply. If the setting changes the home screen, make the
   `SettingsPanelHandle.onSave` path in `main.ts` re-apply it, usually through
   `refreshAll()` or the owning module's `applyConfig()`.
6. Test. Extend `test/config.test.ts` for the migration and, for behaviour, the
   module test or `test/settings-panel.test.ts`.

Backups need no extra work. `fitSettings` handles a wrong-kind or unknown value
on its own, which is why the rules above matter.
