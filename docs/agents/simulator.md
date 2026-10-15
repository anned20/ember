# Testing on the Simulator

LG's webOS TV Simulator is the desktop stand-in for a TV. The app runs in a real
webOS web runtime with the `webOS`/`PalmServiceBridge` API present, and the
on-screen remote sends the same key codes as the real one, so a layout or focus
change does not need a build-and-sideload to the OLED.

LG retired the Emulator at webOS 6.0. That release reports sdk 6 and would fail
Ember's own floor ([ADR-0001](../adr/0001-webos-22-floor.md)), which is why the
Simulator, shipped from webOS 22 up, is the one to use.

## Install

```sh
npm run sim:setup           # webOS 25, the version the project's TV runs
npm run sim:setup -- 22     # any version LG offers, e.g. 22 for the floor
```

`scripts/simulator.ts` reads LG's download page, fetches the package for your OS
and CPU, and unpacks it into `$LG_WEBOS_TV_SDK_HOME/Simulator`, or
`~/webOS_SDK/Simulator` when that variable is unset. That is the layout the
`ares` CLI looks in. Nothing happens if the version is already installed. `-- 22`
installs the floor release from ADR-0001 instead of the version the TV runs.

## Launch

```sh
npm run sim                 # builds, then launches dist/ on the Simulator
npm run sim -- 22           # a second installed version
```

The Simulator can also launch an app itself: **File → Launch App**, then pick
`dist/`. It needs the directory that holds `appinfo.json`, not an `.ipk`. The
app does not land in `/Applications`, so `npm run sim` is the usual way to start
it, and running `sim:setup` again prints where the install lives.

While the Simulator is running, auto-reload is on and `npm run build` alone
reloads the app; `npm run sim` again only reopens it. The Web Inspector opens
with the app.

## What it covers

Layout and the focus router (arrow keys, OK and Back on the on-screen remote),
the Settings panel, backgrounds, music, weather and the screensaver all work, as
does anything else reading the `webOS` bridge.

Anything needing root or the TV's own services does not: the Home-button
watcher, boot on start, TV volume, the Launch Home import, the real app list and
channels. Those want the real TV. `npm run deploy` and `ARES_DEVICE` are for TVs
too, since the Simulator serves no SSH; use `npm run sim` here instead.
