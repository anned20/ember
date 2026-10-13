#!/bin/sh
# Enable Launch Home button watcher (run as root via hbchannel exec).
# Packaged next to home-watcher.sh in the app directory.
# Requires setsid on the supported floor (webOS 22+).

WATCH="/media/developer/apps/usr/palm/applications/org.webosbrew.lounge.launcher/home-watcher.sh"
PIDF="/tmp/launch-home-watcher.pid"
LOG="/tmp/launch-home-watcher.log"
INITD="/var/lib/webosbrew/init.d/40-launch-home-watcher"
# Legacy names from "Lounge Launcher" branding.
OLD_INITD="/var/lib/webosbrew/init.d/40-lounge-home"
OLD_PIDF="/tmp/lounge-home-watcher.pid"
OLD_LOG="/tmp/lounge-home-watcher.log"

if [ ! -f "$WATCH" ]; then
  echo missing_watcher
  exit 1
fi

chmod 755 "$WATCH"
mkdir -p /var/lib/webosbrew/init.d
rm -f "$OLD_INITD"

# Boot hook — detach with setsid. Wait for applicationManager so the watcher
# does not start before LS2 answers on a cold boot.
cat >"$INITD" <<EOF
#!/bin/sh
LOG="$LOG"
WATCH="$WATCH"
i=0
while [ "\$i" -lt 60 ]; do
  if luna-send -i -n 1 -f 'luna://com.webos.applicationManager/getForegroundAppInfo' '{"subscribe":true}' >/dev/null 2>&1; then
    break
  fi
  i=\$((i + 1))
  sleep 2
done
setsid "\$WATCH" >>"\$LOG" 2>&1 </dev/null &
exit 0
EOF
chmod 755 "$INITD"

# Stop prior instances (new + legacy pidfiles).
for pf in "$PIDF" "$OLD_PIDF"; do
  if [ -f "$pf" ]; then
    old=$(cat "$pf" 2>/dev/null)
    if [ -n "$old" ]; then
      kill "$old" 2>/dev/null || true
    fi
  fi
done
killall home-watcher.sh 2>/dev/null || true
# Also stop a watcher run as `sh .../home-watcher.sh` (killall only sees the
# script name). Match its whole command line: a bare
# `pkill -f home-watcher.sh` also matched this script (enable-home-watcher.sh)
# and the shell that ran it, so it killed itself before starting the watcher.
pkill -f "^sh $WATCH\$" 2>/dev/null || true
pkill -f "^/bin/sh $WATCH\$" 2>/dev/null || true
rm -f "$PIDF" "$OLD_PIDF"
sleep 1

start_watcher() {
  setsid "$WATCH" >>"$LOG" 2>&1 </dev/null &
}

start_watcher
sleep 1

i=0
while [ "$i" -lt 8 ]; do
  if [ -f "$PIDF" ]; then
    pid=$(cat "$PIDF" 2>/dev/null)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo enabled pid=$pid
      exit 0
    fi
  fi
  if [ "$i" -eq 3 ]; then
    start_watcher
  fi
  i=$((i + 1))
  sleep 1
done

echo start_failed
echo ---log---
tail -20 "$LOG" 2>/dev/null || true
tail -20 "$OLD_LOG" 2>/dev/null || true
exit 1
