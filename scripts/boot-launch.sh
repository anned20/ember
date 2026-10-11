#!/bin/sh
# Launch Home — launch on TV boot (webOS Homebrew init.d).
#
# Waits for applicationManager / LS2 to come up after cold boot, then launches
# Launch Home. On modern webOS (sdk >= 6) it launches as soon as LS2 answers;
# on webOS 4.x it keeps the settle-then-retry loop (there LS2 is reported ready
# before the compositor is, so an immediate launch often does not stick).
#
# Invoked detached from /var/lib/webosbrew/init.d/50-launch-home-boot.

APP_ID="org.webosbrew.lounge.launcher"
LOG="/tmp/launch-home-boot.log"

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
  out=$(luna-send -i -n 1 -w 4000 -f "$uri" "$payload" 2>/dev/null) && {
    printf '%s' "$out"
    return 0
  }
  out=$(luna-send -i -n 1 -f "$uri" "$payload" 2>/dev/null) && {
    printf '%s' "$out"
    return 0
  }
  out=$(luna-send -n 1 -f "$uri" "$payload" 2>/dev/null) && {
    printf '%s' "$out"
    return 0
  }
  return 1
}

# Is Launch Home the foreground app right now?
is_foreground() {
  fg=$(luna_once 'luna://com.webos.applicationManager/getForegroundAppInfo' '{"subscribe":true}' 2>/dev/null)
  case "$fg" in
    *"$APP_ID"*) return 0 ;;
  esac
  return 1
}

# webOS sdk version (6 = webOS 6, 9/10 = year-branded releases). Empty when the
# TV cannot be asked; callers then take the conservative webOS 4 path.
probe_sdk() {
  info=$(luna_once 'luna://com.webos.service.tv.systemproperty/getSystemInfo' '{"keys":["sdkVersion"]}' 2>/dev/null)
  printf '%s' "$info" | sed -n 's/.*"sdkVersion"[^0-9]*\([0-9][0-9.]*\).*/\1/p' | head -n 1
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

sdk=$(probe_sdk)
log "sdkVersion=${sdk:-unknown}"

# Modern webOS: LS2 answers only once the compositor is up, so launch straight
# away and poll briefly. If it does not stick, fall through to the slow path.
if [ -n "$sdk" ] && awk -v v="$sdk" 'BEGIN{exit !(v + 0 >= 6)}'; then
  log "fast path (sdk $sdk)"
  luna_once 'luna://com.webos.applicationManager/launch' "{\"id\":\"${APP_ID}\"}" >>"$LOG" 2>&1 || true
  j=0
  while [ "$j" -lt 8 ]; do
    sleep 0.5
    if is_foreground; then
      log "Launch Home is foreground — done (uptime $(uptime_s)s)"
      exit 0
    fi
    j=$((j + 1))
  done
  log "fast path did not stick — falling back to settle + retries"
fi

# webOS 4.x settle — LS2 often reports ready before the compositor is.
sleep 8

attempt=1
while [ "$attempt" -le 5 ]; do
  log "launch attempt $attempt (uptime $(uptime_s)s)"
  luna_once 'luna://com.webos.applicationManager/launch' "{\"id\":\"${APP_ID}\"}" >>"$LOG" 2>&1 || true
  sleep 4
  if is_foreground; then
    log "Launch Home is foreground — done (uptime $(uptime_s)s)"
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 3
done

log "finished attempts (may still be launching under stock home)"
exit 0
