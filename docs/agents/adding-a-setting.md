# Adding a setting

The end-to-end path for a new setting. Read `docs/agents/config-and-backups.md`
first, because most of those steps (schema bump, migration, backup fit) are part
of this one. The code is in `lib/types.ts`, `config/config.ts`,
`settings/settings.ts`, `settings/settings-binding.ts`, `settings/components/`
and `main.ts`.

## 1. Put the value in the config tree

Add the field to the right interface in `lib/types.ts` (`LauncherConfig` for
home-screen look and behaviour, `BackgroundConfig`, `MusicConfig`, and so on),
then give it a default in `DEFAULT_CONFIG` in `config/config.ts`.

## 2. Version it

Bump `CONFIG_SCHEMA_VERSION` and add a `CONFIG_MIGRATIONS[newVersion]` step that
backfills the field and drops anything you removed or renamed. The checklist in
`docs/agents/config-and-backups.md` covers the details. Keep the migration small
and isolated, since `test/config.test.ts` drives one step at a time.

## 3. Add the control to a pane (`settings/settings.ts`)

`createSettingsPanel` builds the panel from a `binder` over the effective config.
Every plain control is declared once as a `ConfigField`, which pairs the
control's config path with its `read()` and `write()`, and then passed to
`binder.bind()`. `render()` pushes config into the controls, and on Save
`binder.collect(config)` reads them all back. There is no per-control save line
to write by hand.

Controls come from the kit in `settings/components/` and local helpers. The two
common shapes:

```ts
// A checkbox. createToggle wires focus and change; pass `path` to get its field.
const showClockField = createToggle({
  label: 'Show clock',
  focusIndex: '1000',
  path: 'launcher.showClock'
});
binder.bind(showClockField.field!);
launcherSection.appendChild(showClockField.row);

// An option stepper (enum). The codec maps the control's string to the value.
const clockFormatSelect = createOptionStepper('', 1090, [
  {value: '24', label: '24-hour (18:30)'},
  {value: '12', label: '12-hour (6:30 PM)'}
], undefined);
binder.bind(stepperField(clockFormatSelect, 'launcher.clockFormat', {
  parse: function (raw) { return raw === '12' ? '12' : '24'; }
}));
launcherSection.appendChild(labeledControl('Clock format', clockFormatSelect));
```

A few things to keep in mind:

- Add the section to the right category pane, which is the `CATEGORIES` array
  near the top of `createSettingsPanel`. Sections are appended to their pane.
- `focusIndex` is the D-pad order key and must be unique within the settings
  body. Sections use numeric ranges (look around 1000, background around 900,
  AI Voice around 1960 and up), so pick a free value inside the range of the
  pane you extend.
- Text fields use `createTextField(...)` with `textField(...)`. A one-off
  control uses `field(path, {read, write})`.

### Derived or asynchronous fields

Anything that is not a direct value stays out of the field table and registers a
hook instead. That covers galleries, playlists, the USB scan, the weather place
and the AI keys. Save runs the hooks after the plain fields are collected:

```ts
binder.hook(function (cfg) {
  cfg.background.urls = collectSelectedUrls();
});
```

## 4. Apply it when saved

Save calls `binder.collect(config)`, then `saveConfig(config)`, then
`options.onSave(config)`. That `onSave` handler is in `main.ts`, in the
`createSettingsPanel(..., {onSave: ...})` call, and it has to re-apply the
setting:

- A home-screen change: `refreshAll()` already re-reads most modules
  (`updateClock`, `applyGlassTint`, `applyPerfMode`, `music.applyConfig`,
  `background.refresh`, and so on). Add a call there, or to the owning module's
  `applyConfig()`, if your setting is not covered.
- A root or TV-side change: `syncRootHooks(config)` or the specific helper
  (`applyHomeVolume`, `applyScreensaverSetting`, `setSystemVolume`, and so on).

If a module reads config lazily through `getConfig()`, it may need nothing more.
Check the module's own `applyConfig()` or `refresh()` before adding a new wire.

## 5. Test it

- Migration: extend `test/config.test.ts`.
- Behaviour: the module's test, or `test/settings-panel.test.ts` for a control
  that round-trips into the config on Save.

`npm run typecheck && npm test` must pass.
