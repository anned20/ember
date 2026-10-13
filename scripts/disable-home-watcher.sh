#!/bin/sh
# Disable Launch Home button watcher (run as root via hbchannel exec).

. "$(dirname "$0")/brand.sh"

WATCH="$APP_DIR/home-watcher.sh"
PIDF="$TMP_PREFIX-watcher.pid"
OLD_PIDFS=""
for p in $LEGACY_TMP_PREFIXES; do
  OLD_PIDFS="$OLD_PIDFS $p-watcher.pid"
done
INITD="$INITD_DIR/$HOOK_HOME_WATCHER"

for pf in "$PIDF" $OLD_PIDFS; do
  if [ -f "$pf" ]; then
    old=$(cat "$pf" 2>/dev/null)
    if [ -n "$old" ]; then
      kill "$old" 2>/dev/null || true
    fi
  fi
done
killall home-watcher.sh 2>/dev/null || true
# Whole command line only: a bare `pkill -f home-watcher.sh` also matched this
# script (disable-home-watcher.sh), so it died before removing the boot hook.
pkill -f "^sh $WATCH\$" 2>/dev/null || true
pkill -f "^/bin/sh $WATCH\$" 2>/dev/null || true
rm -f "$PIDF" $OLD_PIDFS "$INITD"
echo disabled
exit 0
