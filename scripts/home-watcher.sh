#!/bin/sh
# Launch Home — intercept stock Home and open Launch Home instead.
#
# webOS always opens stock Home on the Home button first. We react when Home
# is foreground, bring Launch Home forward, close Home, then launch Launch Home AGAIN so
# webOS routes remote INPUT to our surface (launch alone often leaves input on
# Home even though Launch Home is painted on top — dock appears dead).
#
# Start detached only:
#   setsid home-watcher.sh >/tmp/launch-home-watcher.log 2>&1 </dev/null &
#
# Supported floor: webOS 22+. The foreground subscription is durable, so there
# is no poll-and-restart loop; polling is only a last resort when the
# subscription cannot be opened at all.

# The brand values (app id, /tmp prefixes): generated from src/ts/lib/brand.ts
# into brand.sh, shipped next to this script.
. "$(dirname "$0")/brand.sh"

PIDFILE="$TMP_PREFIX-watcher.pid"
LOG="$TMP_PREFIX-watcher.log"
COOLDOWN_SEC=1

log() {
  echo "$(date '+%H:%M:%S' 2>/dev/null) $*" >>"$LOG" 2>/dev/null || true
}

if [ -f "$PIDFILE" ]; then
  oldpid=$(cat "$PIDFILE" 2>/dev/null)
  if [ -n "$oldpid" ] && kill -0 "$oldpid" 2>/dev/null; then
    if [ "$oldpid" != "$$" ]; then
      log "already running pid=$oldpid, exiting"
      exit 0
    fi
  fi
fi
echo $$ >"$PIDFILE"
log "start pid=$$"

trap 'rm -f "$PIDFILE"; log "exit"; exit 0' INT TERM HUP

# The stock-home ids. Kept in sync by hand with HOME_APP_IDS in
# src/ts/lib/remote.ts; interpolating that list into this script at build time
# is intentionally out of scope.
is_home() {
  case "$1" in
    com.webos.app.home|com.webos.app.launcher|com.webos.app.homelauncher|\
    com.webos.app.homeupdater|com.webos.app.dashboard|\
    com.webos.app.gamehome|com.webos.app.seniorhome)
      return 0
      ;;
  esac
  return 1
}

extract_app_id() {
  raw=$(printf '%s' "$1" | tr '\n' ' ')
  printf '%s' "$raw" | sed -n 's/.*"appId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1
}

# The one supported luna-send idiom: interactive, one reply, hard timeout.
luna_once() {
  uri=$1
  payload=$2
  luna-send -i -n 1 -w 3000 -f "$uri" "$payload" 2>/dev/null
}

subscribe_fg() {
  luna-send -i \
    'luna://com.webos.applicationManager/getForegroundAppInfo' \
    '{"subscribe":true}' 2>/dev/null
}

launch_app() {
  log "launch $APP_ID"
  luna_once 'luna://com.webos.applicationManager/launch' "{\"id\":\"${APP_ID}\"}" >>"$LOG" 2>&1 || true
}

close_home() {
  for id in com.webos.app.home com.webos.app.launcher com.webos.app.homelauncher \
            com.webos.app.dashboard; do
    luna_once 'luna://com.webos.applicationManager/closeByAppId' "{\"id\":\"${id}\"}" >/dev/null 2>&1 || true
  done
}

# Bring Launch Home to front AND own input. Order matters on webOS 25:
#   1) launch Launch Home (graphics)
#   2) close stock Home (drop its input surface)
#   3) launch Launch Home again (reclaim input after Home is gone)
activate_app() {
  log "activate Launch Home"
  launch_app
  sleep 0.25
  close_home
  sleep 0.15
  launch_app
}

now_sec() {
  date +%s 2>/dev/null || echo 0
}

last_app=""
last_action=0
primed=0

handle_fg() {
  appId=$1
  [ -n "$appId" ] || return 0

  if [ "$primed" -eq 0 ]; then
    primed=1
    last_app="$appId"
    log "primed fg=$appId"
    return 0
  fi

  if [ "$appId" = "$APP_ID" ]; then
    last_app="$appId"
    return 0
  fi

  if is_home "$appId"; then
    now=$(now_sec)
    elapsed=$((now - last_action))
    if [ "$last_action" -ne 0 ] && [ "$elapsed" -lt "$COOLDOWN_SEC" ]; then
      return 0
    fi
    last_action=$now
    prev="$last_app"
    last_app="$appId"
    log "home after $prev -> activate Launch Home"
    activate_app
    return 0
  fi

  last_app="$appId"
}

run_subscribe() {
  log "subscribe start"
  buf=""
  subscribe_fg | while IFS= read -r line || [ -n "$line" ]; do
    buf="$buf $line"
    case "$buf" in
      *returnValue*)
        appId=$(extract_app_id "$buf")
        buf=""
        if [ -n "$appId" ]; then
          handle_fg "$appId"
        fi
        ;;
    esac
  done
  log "subscribe ended"
}

# A cold boot can start us before LS2 answers; wait (up to ~60s) before opening
# the subscription.
boot_wait=0
while [ "$boot_wait" -lt 60 ]; do
  if luna_once 'luna://com.webos.applicationManager/getForegroundAppInfo' '{"subscribe":true}' >/dev/null 2>&1; then
    log "ls2 ready after ${boot_wait}s"
    break
  fi
  boot_wait=$((boot_wait + 1))
  sleep 1
done

# The subscription cannot be opened at all: fall back to polling.
if ! luna_once 'luna://com.webos.applicationManager/getForegroundAppInfo' '{"subscribe":true}' >/dev/null 2>&1; then
  log "subscribe unavailable — polling fallback"
  while true; do
    raw=$(luna_once 'luna://com.webos.applicationManager/getForegroundAppInfo' '{"subscribe":true}')
    handle_fg "$(extract_app_id "$raw")"
    sleep 1
  done
fi

# Durable subscription: when the bus drops us, reopen it (no polling).
while true; do
  run_subscribe
  sleep 1
done
