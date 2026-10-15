# Development

New here? [README.md](README.md) is the overview, [CONTEXT.md](CONTEXT.md) is
the glossary, and [docs/agents/architecture.md](docs/agents/architecture.md)
covers how the modules fit together.

Ember is plain TypeScript bundled by esbuild into `dist/`, and `npm run pack`
wraps that up as the `.ipk` a TV installs. There is no framework and no dev
server: the app is loaded as the directory holding `appinfo.json`.

## Setup

Node 24, the version CI uses, then `npm install`. Scripts run straight through
node (`node scripts/build.ts`), which strips the TypeScript types as it loads
them.

## Commands

| Command | What it does |
| --- | --- |
| `npm run build` | Bundles `src/` into `dist/`. |
| `npm run pack` | Builds, then writes the installable `.ipk` to `dist/`. |
| `npm run repo` | Writes `dist/repo/`, the Homebrew Channel repository, from the packed IPK. |
| `npm run sim` | Builds, then runs `dist/` on LG's webOS TV Simulator. |
| `npm run sim:setup` | Installs that Simulator (once). |
| `npm run deploy` | Packs, copies the IPK over SSH, installs and launches it on the TV. |
| `npm test` | Vitest, jsdom. |
| `npm run typecheck` | `tsc --noEmit` for the app and for `scripts/`. |
| `npm run brand` | Re-renders `scripts/brand.sh` from `src/ts/lib/brand.ts`. |
| `npm run verify-ipk` | Checks a built IPK. `npm run pack` runs this for you. |

The remaining scripts, the TV-side shell helpers among them, are in
[docs/agents/layout.md](docs/agents/layout.md), which also maps out every
directory.

## Running it on a Simulator

There is no webOS 22+ Emulator, so the desktop target is LG's webOS TV
Simulator. LG retired the Emulator at webOS 6.0, and that release reports sdk 6,
below the floor Ember enforces
([ADR-0001](docs/adr/0001-webos-22-floor.md)).

```sh
npm run sim:setup     # once: installs the webOS 25 Simulator (~110 MB)
npm run sim           # builds, then launches dist/ on it
```

Both take a version: `npm run sim:setup -- 22` installs the floor release
instead of the 25 your TV runs, and `npm run sim -- 22` launches it. The install
goes to `$LG_WEBOS_TV_SDK_HOME/Simulator`, or `~/webOS_SDK/Simulator` when that
variable is unset, which is where the `ares` CLI looks for it. That CLI is
already a devDependency.

Inside the Simulator the app has the `webOS`/`PalmServiceBridge` API, which a
browser cannot give it, and an on-screen remote that sends the TV's key codes.
Layout, focus, Settings, backgrounds, music, weather and the screensaver all work
there, and `npm run build` alone reloads the running app. The Web Inspector opens
with the app.

What it cannot do is anything needing root or the TV's own services: the
Home-button watcher, boot on start, TV volume, the Launch Home import, the real
app list and channels. Those want the real TV. Full detail in
[docs/agents/simulator.md](docs/agents/simulator.md).

## On the TV

`npm run deploy` packs, copies the IPK over SSH, installs it with `appinstalld`
and launches it. The target comes from your ares devices (`ares-setup-device
--list`; `ARES_DEVICE=<name>` picks one that is not the default), and the SSH
key is the one that device records, or `~/.ssh/webos_deploy` if it has none. The
TV needs SSH reachable, and Ember's root-only features need root on it.
[README.md](README.md) covers that setup and `install2tvfrommacos.sh`.

## Before you push

`npm run typecheck` and `npm test` both need to pass. The same two run on every
push and pull request (`.github/workflows/test.yml`), and a `v*` tag builds the
IPK and attaches it to a GitHub release
(`.github/workflows/release.yml`). That same tag deploys `dist/repo/` to GitHub
Pages, the repository a TV adds in Homebrew Channel. Pages fills the deploy step
in only once it is switched to the **GitHub Actions** source under Settings →
Pages; the release and its IPK are published either way. The repository's
address is fixed — renaming the repo or moving Pages breaks every TV that saved
it.

Commits follow the Conventional Commits format in [AGENTS.md](AGENTS.md):
`<type>(<scope>): <summary>`. Brand values (names, app ids, TV paths) live only
in `src/ts/lib/brand.ts`, so run `npm run brand` after touching them, or
`test/brand.test.ts` will fail while `scripts/brand.sh` is stale. A new setting
has an end-to-end path to follow in
[docs/agents/adding-a-setting.md](docs/agents/adding-a-setting.md), and
[docs/agents/config-and-backups.md](docs/agents/config-and-backups.md) covers
settings and backups.
