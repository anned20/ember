# 0002 — the voice assistant's upgrade path

- **Status:** Accepted
- **Date:** 2026-10-15
- **Issue:** [#65](https://github.com/anned20/ember/issues/65)

## Context

The voice assistant is being extracted from Ember into a standalone app
(`ember-voice`, app ids `com.ember.voice` and `com.ember.voice.card`). The
extraction is a removal on Ember's side, but not only a removal: an earlier
Ember could have installed a root daemon, a boot hook, `/tmp` pidfiles and a
hidden answer card on the TV, and stopped LG's own voice services to borrow the
Voice button. Dropping the feature without dealing with that leaves a daemon
running with no UI, a stale hook, and a Voice button that answers nothing.

Five facts decide the shape of the fix.

- **Ember has no install-time hook.** Root work in this app is done at startup
  through Homebrew Channel (`execRoot`); that is also how the before-update
  settings backup works. There is no moment during an IPK replace when Ember
  runs a script as root.
- **The old boot hook is self-neutralising.** `enable-voice.sh` writes
  `if [ -f "$RUN" ]; then sh "$RUN" start; fi`, and `$RUN` is the voice run
  script inside Ember's app directory. The new IPK does not ship it, so after
  the update the hook starts nothing.
- **The daemon registers no Luna service.** The "service name" is a string
  echoed in its websocket hello reply, and that string is `ember-voice` in both
  the old Ember daemon and the new app's daemon. A new host that verifies only
  the service name will happily attach to the stale old daemon.
- **The config directory is user data.** `/home/root/.config/ember-voice` holds
  the provider keys and the Grok sign-in, and the disabled-assistant script
  deliberately keeps it.
- **The card's id is the new host's id.** The old hidden card is
  `com.ember.voice`; the new standalone app is `com.ember.voice` too, so
  installing it replaces the card in place.

The wire protocol (`ws://127.0.0.1:8678`, hello service `ember-voice`, role
`launcher`) is fixed by the extraction spec and does not change here.

## Decision

**Teardown belongs to Ember, setup belongs to `ember-voice`, and the two are
never live on port 8678 at the same time.**

- **Ember tears down at its first launch after the update**, not at install
  time. The trigger is the last-run-version check that already decides whether
  to write the before-update settings backup, so the teardown runs once per
  installed version with no new state. It is one root exec through Homebrew
  Channel, first in the idle pass beside the other root work, so nothing
  optional can be allowed to delay it.
- **The teardown is idempotent and gated on the work remaining.** It exits
  without side effects only when the boot hook, the pidfiles and any
  Ember-owned daemon are all gone. It stops the daemon first and removes the
  boot hook last, so an interrupted run retries at the next launch. No "already
  cleaned" flag is written, so a run that could not reach root is not lost.
- **It restores LG's voice services only if it stopped a daemon**, and only
  when nothing is listening on the assistant port afterwards. The existing
  check for the other voice assistant is not sufficient on its own: the new
  app can already own the Voice button in the opposite ordering, and restoring
  LG's services would break it.
- **It never removes the user's config or the answer card.** The config
  directory is the user's keys and sign-in, and it is the new app's config
  directory. The card is not uninstalled by id, because that id belongs to the
  new host.
- **Ember keeps exactly two voice artefacts**: the cleaning script, shipped in
  the IPK, and the boot hook name in the brand, because the script removes that
  hook by name. Everything else voice-shaped leaves the brand.
- **The daemon's hello reply gains the daemon's slug**, and the host accepts a
  daemon only when the slug is its own. The field is additive, so the reply a
  client sees keeps its existing shape. This turns a silent mis-attach onto the
  stale daemon into a refusal.
- **`ember-voice` adopts `/home/root/.config/ember-voice`** as its config
  directory, so a user's keys and sign-in carry over with no action from them.
- **`ember-voice`'s boot hook name must not be `45-ember-voice`.** Its enable
  script evicts a stale Ember daemon before it claims the port, using its own
  pidfiles and slug to tell the two apart.
- **The teardown is removable.** It is expected to be deleted in a later
  release, once nearly every TV has updated across the boundary.

## Consequences

- A TV that never enabled the assistant is untouched: the teardown finds no
  hook, no pidfile and no daemon, and exits before it can restart LG's voice
  services.
- A TV that did enable it gets its Voice button back at the first launch of the
  new Ember, and can then install `ember-voice` and keep its keys and sign-in.
- Ember's cold start gains one root exec per update, which exits immediately
  once the TV is clean. It never gains per-boot voice work; the daemon and its
  hook are gone.
- The window between the IPK replace and that first launch is benign but not
  empty: the stale hook cannot start anything, but a daemon that survived the
  replace still holds the port and the Voice button until Ember runs. A TV that
  is updated and never relaunched keeps a borrowed Voice button, so the
  teardown must not be deferred behind optional startup work.
- A TV with both the old hook and the standalone app installed is the one place
  the two orderings meet. The teardown is gated on Ember's own hook and
  pidfiles and the new app uses its own names, so only the old daemon should be
  stopped; this is the case worth a hardware check.
- The two projects must keep agreeing on the slug field and on the
  `ember-voice` service name. A mismatch is a refused connection rather than a
  silent one.

## Alternatives considered

- **A bridge release that turns voice off before the removal ships.** Costs a
  release and does not help anyone who skips it; the teardown has to exist
  anyway.
- **Let `ember-voice`'s enable script do all the cleaning.** Leaves a user who
  wanted Ember *without* voice with a dead Voice button and a stray daemon until
  they install an app they did not ask for.
- **An install-time pre/post-install hook.** Ember has no reliable root hook at
  install time on its install paths, so this would be a new mechanism that only
  works for some installs.
- **A "cleaned" flag.** Either it is written before the work (a no-root attempt
  marks the TV cleaned and the cleanup never runs again) or it duplicates the
  existence check that already describes the remaining work.
- **Deleting the answer card by id.** The id is the new host's; the update could
  uninstall the new app if it is already installed.
- **Discriminating the daemon by a new or changed service name.** The wire
  protocol is fixed and a rename breaks every existing client handshake; the
  additive slug field gets the same safety for no protocol change.
- **Keeping `enable-voice.sh` to stop the daemon on the next launch.** Keeps a
  whole install path alive for the sake of one `stop`, and its "safe to run
  again" behaviour is exactly what must not keep happening.
