#!/bin/sh
# Turn off Launch Home's voice assistant (run as root via hbchannel exec).
# Stops the daemon, removes the boot hook and the voice card, and gives the
# voice button back to LG. Settings and the SuperGrok sign-in are kept.
# Another voice assistant (VoxRelay) is never stopped or changed.

. "$(dirname "$0")/brand.sh"

APPDIR="${LH_APPDIR:-$APP_DIR}"
RUN="$APPDIR/voice-run.sh"
CARD_ID="$VOICE_APP_ID"
CARD_DIR="$VOICE_CARD_DIR"
INITD="$INITD_DIR/$HOOK_VOICE"

rm -f "$INITD"

if [ -f "$RUN" ]; then
  sh "$RUN" stop >/dev/null 2>&1
else
  # Launch Home files already gone: stop by pidfile.
  for pf in $TMP_PREFIX-voice-run.pid $TMP_PREFIX-voice.pid; do
    p=$(cat "$pf" 2>/dev/null)
    if [ -n "$p" ]; then
      kill -TERM -"$p" 2>/dev/null || kill -TERM "$p" 2>/dev/null
    fi
  done
  rm -f $TMP_PREFIX-voice-run.pid $TMP_PREFIX-voice.pid $TMP_PREFIX-voice.ver
fi

luna-send -n 1 -w 3000 -f luna://com.webos.applicationManager/closeByAppId \
  "{\"id\":\"$CARD_ID\"}" >/dev/null 2>&1 </dev/null
if [ -d "$CARD_DIR" ]; then
  luna-send -n 6 -w 30000 -f luna://com.webos.appInstallService/dev/remove \
    "{\"id\":\"$CARD_ID\",\"subscribe\":true}" >/dev/null 2>&1 </dev/null &
  remover=$!
  i=0
  while [ "$i" -lt 40 ] && [ -d "$CARD_DIR" ]; do
    sleep 0.5
    i=$((i + 1))
  done
  kill "$remover" 2>/dev/null
fi

# The daemon blocked LG's own voice trigger and may have stopped LG's voice
# services. Undo that, unless another voice assistant still relies on it.
if ! pgrep -f "[v]oxrelay_daemon.py" >/dev/null 2>&1 &&
   ! grep -q ':21E5 00000000:0000 0A' /proc/net/tcp 2>/dev/null; then
  rm -f /tmp/voiceinput_disable_set_input_event
  if command -v systemctl >/dev/null 2>&1; then
    for svc in voiceinput.service voiceconductor.service; do
      if ! systemctl is-active "$svc" >/dev/null 2>&1; then
        systemctl start "$svc" >/dev/null 2>&1 </dev/null &
      fi
    done
  fi
fi

echo disabled
exit 0
