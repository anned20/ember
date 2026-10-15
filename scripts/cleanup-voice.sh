#!/bin/sh
# One-shot teardown of the voice assistant an earlier Ember installed (run as
# root via hbchannel exec). Ember has no voice assistant any more, but a TV
# that turned it on still holds a root daemon, a boot hook and /tmp pidfiles
# that this Ember put there. Stopping them is Ember's job; installing the
# standalone replacement is not.
#
# Idempotent and gated on the work remaining: it does nothing until Ember's own
# boot hook, a pidfile or its daemon is there, and it removes the hook *last*,
# so an interrupted or unprivileged run is retried at the next start. No "done"
# flag is written for that reason.
#
# Kept deliberately: the config directory (the provider keys and the SuperGrok
# sign-in — the standalone app reads the same directory) and the answer card
# (its app id is the standalone app's, so removing it by id could uninstall
# that app). Ember never touches any other voice assistant on the TV.
#
# Prints "clean" (nothing of Ember's left; nothing touched) or "cleaned".
# Remove this script with the last Ember that can still have voice enabled.

. "$(dirname "$0")/brand.sh"

APPDIR="${EMBER_APPDIR:-$APP_DIR}"
RUN="$APPDIR/voice-run.sh"
INITD="$INITD_DIR/$HOOK_VOICE"
RUNPID=$TMP_PREFIX-voice-run.pid
PIDF=$TMP_PREFIX-voice.pid
VER=$TMP_PREFIX-voice.ver
# 8678 (this assistant) and 8677 (VoxRelay) in /proc/net/tcp notation, listening.
PORT_OURS=':21E6 00000000:0000 0A'
PORT_OTHER=':21E5 00000000:0000 0A'

# Ember's daemon, whether or not its pidfile survived (/tmp is cleared by some
# reboots). The path carries Ember's old /voice/ subfolder, which the standalone
# replacement does not use, so this never matches that app's daemon or any other
# assistant's.
daemon_running() {
  pgrep -f '^python3 .*/voice/daemon/voice_daemon\.py' >/dev/null 2>&1
}

# Nothing of Ember's is here: leave the TV alone. In particular, do not restart
# LG's voice services — they may be off because the standalone voice app or
# another assistant owns the Voice button now.
if [ ! -e "$INITD" ] && [ ! -e "$RUNPID" ] && [ ! -e "$PIDF" ] && ! daemon_running; then
  echo clean
  exit 0
fi

stopped=""
if [ -f "$RUN" ]; then
  sh "$RUN" stop >/dev/null 2>&1 && stopped=1
else
  # The update dropped Ember's scripts, so the run loop and the daemon are only
  # reachable through the pidfiles they left.
  for pf in "$RUNPID" "$PIDF"; do
    p=$(cat "$pf" 2>/dev/null)
    if [ -n "$p" ]; then
      kill -TERM -"$p" 2>/dev/null || kill -TERM "$p" 2>/dev/null
      stopped=1
    fi
  done
fi
if daemon_running; then
  pkill -TERM -f '^python3 .*/voice/daemon/voice_daemon\.py' 2>/dev/null
  stopped=1
fi
rm -f "$RUNPID" "$PIDF" "$VER"

# The daemon may have stopped LG's own voice services to take the Voice button.
# Give them back, but only if this run stopped something and nothing owns the
# button now: the standalone voice app answers on the same port, and starting
# LG's services underneath it would break it. Another assistant is never touched.
if [ -n "$stopped" ] &&
   ! pgrep -f "[v]oxrelay_daemon.py" >/dev/null 2>&1 &&
   ! grep -q "$PORT_OTHER" /proc/net/tcp 2>/dev/null &&
   ! grep -q "$PORT_OURS" /proc/net/tcp 2>/dev/null; then
  rm -f /tmp/voiceinput_disable_set_input_event
  if command -v systemctl >/dev/null 2>&1; then
    for svc in voiceinput.service voiceconductor.service; do
      if ! systemctl is-active "$svc" >/dev/null 2>&1; then
        systemctl start "$svc" >/dev/null 2>&1 </dev/null &
      fi
    done
  fi
fi

# Last: an interrupted run must find the hook still here and retry.
rm -f "$INITD"

echo cleaned
exit 0
