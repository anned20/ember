# Repository layout

Where things live, so an agent can find the right file without exploring the
whole tree. Read this after `AGENTS.md`.

## Top level

| Path | What it is |
| --- | --- |
| `src/` | The app itself: `index.html`, `styles/main.css`, and the TypeScript in `src/ts/`. |
| `test/` | Vitest tests, mirroring the module layout under `src/ts/`. |
| `scripts/` | Build, packaging, deploy and root/TV helper scripts (TypeScript and shell). |
| `voice/` | The optional voice assistant: Python daemon (`daemon/`) and the hidden overlay app (`overlay/`). |
| `assets/` | Shipped resources: app icons, wallpapers, ambient music, TV icons. |
| `docs/` | Human docs (`background-sources.md`), screenshots, and the agent docs in `docs/agents/`. |
| `dist/` | The generated build output. Never edit or commit it (git-ignored). |
| `appinfo.json`, `version.md` | App manifest and version, kept in sync by `npm run version`. |

## `src/ts/`, the application modules

`boot.ts` is the entry point. `scripts/build.ts` bundles it to `dist/main.js`,
and it just calls `main.ts`, which composes the whole home screen. Modules are
grouped by domain:

| Directory | Alias | Holds |
| --- | --- | --- |
| `apps/` | `@apps` | App discovery, icons, the app grid and the All-apps overlay, LG-home import. |
| `background/` | `@background` | Background sources (built-in, USB, online), aerial clips, the in-app screensaver. |
| `music/` | `@music` | The ambient music player and its built-in track manifest. |
| `voice/` | `@voice` | Voice-assistant websocket client, launch resolution and the mic indicator. |
| `settings/` | `@settings` | The Settings panel (the composition root in `settings.ts`), the panel's key/wheel navigation (`navigation.ts`), backup/restore, field bindings, the text-field gate (`text-gate.ts`) and the pane seam (`pane.ts`). UI components live in `settings/components/`, category panes in `settings/panes/`. |
| `focus/` | `@focus` | Focus manager and the row model it moves over. |
| `home/` | `@home` | Home-screen rows and panels: TV inputs, channels, weather. |
| `config/` | `@config` | The config tree: load, save, normalize, and profiles. |
| `luna/` | `@luna` | The webOS Luna service transport and platform/device helpers. |
| `lib/` | `@lib` | Shared vocabulary and utilities: `types.ts`, `compat.ts`, `version.ts`, `usb.ts`, `remote.ts`, and other cross-cutting helpers. |
| `settings/components/` | | Small settings UI building blocks (`toggle`, `text-field`, `gallery`, and so on), imported by `@settings/settings.js` via `./components`. Same-directory imports stay relative. |
| `settings/panes/` | | Category panes (`weather`, and the rest as they move), each a `PaneHandle` built by the composition root through a `SettingsContext` (`@settings/pane.js`). Same-directory imports stay relative. |

### Import aliases

Cross-module imports use `@<dir>/<file>.js`, for example `@luna/luna.js` or
`@lib/types.js`. The `.js` extension is deliberate even though the sources are
`.ts`, because esbuild, tsc and Vite all resolve it to the `.ts` file. The
aliases are defined in three places that must stay in sync:

- `tsconfig.json` under `compilerOptions.paths`
- `scripts/build.ts`, the `tsAliases` map passed to esbuild
- `vitest.config.mjs` under `resolve.alias`

Add a new alias in all three. `boot.ts` and `main.ts` sit at the `src/ts/` root
and have no alias, so refer to them relatively.

## Brand

The app's identity — display names, tagline, vendor, app ids, storage keys, TV
paths and root-hook names — lives in one place: `src/ts/lib/brand.ts`. The
TypeScript modules import it; `scripts/build.ts` stamps the app manifests, the
`index.html` titles and the voice card from it; and `scripts/generate-brand.ts`
(`npm run brand`) renders it into `scripts/brand.sh` and `voice/daemon/brand.py`
for the shipped shell scripts and the Python daemon. Those two files are
generated and committed: never edit them by hand, run `npm run brand` after
changing `brand.ts`, and `test/brand.test.ts` fails if they drift.

## `test/`

Vitest with the jsdom environment (`vitest.config.mjs`). Tests mirror `src/ts/`:
`test/settings/components/toggle.test.ts` covers
`src/ts/settings/components/toggle.ts`. Use the same `@` aliases the source uses.

## `scripts/`

- `build.ts` bundles `src/ts/boot.ts`, copies HTML, CSS, assets and `voice/`
  into `dist/`, cache-busts asset URLs, and with `--pack` builds the IPK.
- `deploy.sh` and `install2tvfrommacos.sh` install to the TV.
- The `*.sh` root helpers (`home-watcher.sh`, `boot-launch.sh`, `voice-run.sh`
  and the rest) ship inside the IPK and run on the TV.
- `generate-aerials.ts` regenerates `src/ts/background/aerials.ts`. The output is
  committed and the script is run by hand. `generate-icons.py` regenerates the
  app icons.

## `voice/`

- `daemon/` is the Python 3 voice daemon. It runs as root on the TV and is
  copied to `dist/`.
- `overlay/` is the hidden `org.webosbrew.lounge.voice` app, built into
  `dist/voice/card.pkg` by `npm run pack`.

## `assets/`

`app-icons/` holds the bundled launcher icons, `backgrounds/` the wallpapers and
`manifest.json`, and `music/` the ambient tracks and `manifest.json`. The
`1920/` performance wallpaper set is downloaded on demand and excluded from the
IPK. The `*-v4` to `*-v7` icon generations are packaging exclusions, so only the
current `-v8` set ships.

## Commands

- `npm run typecheck` runs `tsc --noEmit` for the app and for `scripts/`.
- `npm run brand` re-renders `scripts/brand.sh` and `voice/daemon/brand.py` from
  `src/ts/lib/brand.ts`.
- `npm test` runs Vitest.
- `npm run build` bundles to `dist/`. `npm run pack` also produces the IPK.
- `npm run deploy` builds and installs on the TV.
- `npm run version` bumps the version and stages `version.md` plus the two
  `appinfo.json` files.
