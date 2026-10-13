#!/bin/sh
# Ember — launch on TV boot (webOS Homebrew init.d).
#
# Waits for applicationManager / LS2 to come up after cold boot, then launches
# Ember and polls briefly until it owns the foreground. On the supported
# floor (webOS 22+) LS2 answers only once the compositor is up, so there is no
# settle delay and no retry loop.
#
# Invoked detached from /var/lib/webosbrew/init.d/50-ember-boot.

. "$(dirname "$0")/brand.sh"

LOG="$TMP_PREFIX-boot.log"

log() {
  echo "$(date '+%H:%M:%S' 2>/dev/null) $*" >>"$LOG" 2>/dev/null || true
}

# Seconds since boot, so the boot log carries real timings (before/after).
uptime_s() {
  awk '{printf "%d", $1}' /proc/uptime 2>/dev/null || echo 0
}

log "boot-launch start (uptime $(uptime_s)s)"

luna_once() {
  uri=$1
  payload=$2
  luna-send -i -n 1 -w 4000 -f "$uri" "$payload" 2>/dev/null
}

# Is Ember the foreground app right now?
is_foreground() {
  fg=$(luna_once 'luna://com.webos.applicationManager/getForegroundAppInfo' '{"subscribe":true}' 2>/dev/null)
  case "$fg" in
    *"$APP_ID"*) return 0 ;;
  esac
  return 1
}

# Wait up to ~3 minutes for the app framework after power-on.
i=0
while [ "$i" -lt 90 ]; do
  if luna_once 'luna://com.webos.applicationManager/getForegroundAppInfo' '{"subscribe":true}' >/dev/null 2>&1; then
    log "ls2 ready after $((i * 2))s (uptime $(uptime_s)s)"
    break
  fi
  i=$((i + 1))
  sleep 2
done

# LS2 answers only once the compositor is up, so launch straight away and poll
# briefly until Ember is foreground.
log "launch (uptime $(uptime_s)s)"
luna_once 'luna://com.webos.applicationManager/launch' "{\"id\":\"${APP_ID}\"}" >>"$LOG" 2>&1 || true
j=0
while [ "$j" -lt 8 ]; do
  sleep 0.5
  if is_foreground; then
    log "Ember is foreground — done (uptime $(uptime_s)s)"
    exit 0
  fi
  j=$((j + 1))
done

log "not foreground after launch (may still be starting under stock home)"
exit 0
