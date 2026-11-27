#!/bin/sh
# Ember: take LG's Home app's place, so the Home button (and Back out of the last
# app, and waking from standby) opens Ember without stock Home ever showing.
#
# A tiny web app that launches Ember is staged under LG's Home id,
# com.webos.app.home, and bind-mounted over /usr/palm/applications/<id>. sam (the
# app manager) rereads the manifest, LG's running Home is stopped, and every
# route that means "Home" now opens the stub. The mount does not survive a
# reboot, so an init.d hook applies it again at boot.
#
# The approach and the sam reread calls are ported from Glasshouse
# (rorygallagher2024/glasshouse, MIT: server/lib/home-takeover.js, 50-tvweb.sh).
#
# Two modes (kept in $CONFIG_DIR/home-takeover.mode):
#   stub  the default: the staged app is a black page that launches Ember.
#   full  Ember's own app directory is mounted under the Home id, with only its
#         appinfo.json swapped for one naming com.webos.app.home. Home opens
#         Ember itself, with no hop. Experimental: the Home-id copy keeps its own
#         localStorage, so it starts from the newest settings backup.
#
# Run as root via Homebrew Channel:
#   home-takeover.sh enable [stub|full]  install the boot hook and apply  -> "takeover" | "unsupported <why>"
#   home-takeover.sh disable   remove the hook and give LG's Home back -> "disabled"
#   home-takeover.sh boot      what the hook runs

. "$(dirname "$0")/brand.sh"

LG_HOME=com.webos.app.home
HOME_APP=/usr/palm/applications/$LG_HOME
STAGE="$CONFIG_DIR/home-takeover"
MODE_FILE="$CONFIG_DIR/home-takeover.mode"
MODE=$(cat "$MODE_FILE" 2>/dev/null)
[ "$MODE" = full ] || MODE=stub
INITD="$INITD_DIR/$HOOK_HOME_TAKEOVER"
LOG="$TMP_PREFIX-takeover.log"
SELF="$APP_DIR/home-takeover.sh"
# Not an app: blocking it blocks nothing (sam rereads when the list changes).
NUDGE_ID=com.ember.rescan

log() {
  echo "$(date '+%H:%M:%S' 2>/dev/null) $*" >>"$LOG" 2>/dev/null || true
}

luna_once() {
  luna-send -i -n 1 -w 3000 -f "$1" "$2" 2>/dev/null
}

webos_major() {
  m=$(sed -n 's/.*webOS[^0-9]*\([0-9][0-9]*\)\..*/\1/p' /etc/issue 2>/dev/null | head -n 1)
  [ -n "$m" ] ||
    m=$(sed -n 's/.*release[^0-9]*\([0-9][0-9]*\)\..*/\1/p' /etc/starfish-release 2>/dev/null | head -n 1)
  echo "${m:-0}"
}

# The stub: a black page that launches Ember (and again each time Home is
# pressed while the stub is still loaded). Written fresh so an update of Ember
# reaches it at the next enable or boot.
stage_stub() {
  mkdir -p "$STAGE/assets" || return 1
  # The first version of the stub loaded the library; drop that leftover.
  rm -f "$STAGE/webOS.js"
  cp "$APP_DIR"/assets/icon-*-v9.png "$STAGE/assets/" 2>/dev/null
  cat >"$STAGE/appinfo.json" <<EOF
{
  "id": "$LG_HOME",
  "version": "1.0.0",
  "vendor": "$BRAND_VENDOR",
  "type": "web",
  "main": "index.html",
  "title": "$BRAND_NAME Home",
  "icon": "assets/icon-80-v9.png",
  "largeIcon": "assets/icon-130-v9.png",
  "bgColor": "#000000",
  "visible": false,
  "disableBackHistoryAPI": true,
  "appCategory": ["home"]
}
EOF
  cat >"$STAGE/index.html" <<EOF
<!doctype html>
<html><head><meta charset="utf-8"><title>$BRAND_NAME Home</title>
<style>html,body{margin:0;height:100%;background:#000;color:#6b665e;font:2.4vh sans-serif}
#m{position:absolute;top:62vh;width:100%;text-align:center}</style></head>
<body><div id="m"></div>
<script>
(function () {
  var last = 0;
  function go() {
    var now = Date.now();
    // Only folds the events one relaunch stacks (webOSRelaunch + visibility): a
    // longer window swallowed a second Home press and left the stub black.
    if (now - last < 200) return;
    last = now;
    // The bridge directly: no library to load and parse before the first launch.
    var b = new PalmServiceBridge();
    b.onservicecallback = function (msg) {
      var r = {};
      try { r = JSON.parse(msg); } catch (e) { r.returnValue = false; }
      b.cancel();
      if (r.returnValue === false || r.errorCode) {
        document.getElementById('m').textContent = '$BRAND_NAME did not open. Retrying...';
        setTimeout(go, 1500);
      } else {
        document.getElementById('m').textContent = '';
      }
    };
    b.call('luna://com.webos.applicationManager/launch', JSON.stringify({id: '$APP_ID'}));
  }
  document.addEventListener('webOSRelaunch', go);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) go(); });
  go();
})();
</script></body></html>
EOF
}

# Ember's own appinfo.json, renamed to LG's Home id.
stage_full() {
  mkdir -p "$STAGE" || return 1
  python3 - "$APP_DIR/appinfo.json" "$STAGE/appinfo.json" "$LG_HOME" <<'PY' || return 1
import json, sys
d = json.load(open(sys.argv[1]))
d['id'] = sys.argv[3]
d['visible'] = False
d['appCategory'] = ['home']
json.dump(d, open(sys.argv[2], 'w'), indent=2)
PY
}

# A mount at LG's Home path that is Ember's (LG's own app is never mounted
# there; another tool's carries another vendor).
ours() {
  grep -q " $HOME_APP " /proc/mounts 2>/dev/null &&
    grep -q "\"vendor\": *\"$BRAND_VENDOR\"" "$HOME_APP/appinfo.json" 2>/dev/null
}

# Ours, and the mount this mode wants (an update replaces Ember's directory, so
# a full mount of the old one no longer matches).
mounted() {
  ours || return 1
  here=$(stat -c %d:%i "$HOME_APP" 2>/dev/null)
  if [ "$MODE" = full ]; then
    [ "$here" = "$(stat -c %d:%i "$APP_DIR" 2>/dev/null)" ]
  else
    [ "$here" = "$(stat -c %d:%i "$STAGE" 2>/dev/null)" ]
  fi
}

# Whether sam's getAppInfo for LG's Home matches $1, polled up to $2 times
# (default 20, a second apart: at boot sam can still be on its own first scan).
sam_reports() {
  n=${2:-20}
  while [ "$n" -gt 0 ]; do
    luna_once luna://com.webos.applicationManager/getAppInfo "{\"id\":\"$LG_HOME\"}" | grep -q "$1" && return 0
    n=$((n - 1))
    [ "$n" -gt 0 ] && sleep 1
  done
  return 1
}

# webOS 7 to 9: sam rescans when configd's profile.blockedAppList changes. Add an
# id no app has, then put LG's list back exactly as it was.
sam_nudge() {
  list=$(luna_once luna://com.webos.service.config/getConfigs '{"configNames":["profile.blockedAppList"]}' |
    tr -d '\n' | sed -n 's/.*"profile\.blockedAppList": *\(\[[^]]*\]\).*/\1/p')
  # webOS 7: configd holds no value until one is written; sam blocks the
  # country's list meanwhile, so the nudge starts from that.
  if [ -z "$list" ] && [ ! -e /etc/palm/schemas/sam/applicationManager.blockSystemApp.schema ] &&
     grep -q 'profile\.blockedAppList' /usr/sbin/sam 2>/dev/null; then
    set -- /var/preferences/com.webos.applicationManager/blockedAppList/*.json
    [ $# -eq 1 ] && [ -f "$1" ] &&
      list=$(tr -d '\n' < "$1" | sed -n 's/.*"blocked_applist": *\(\[[^]]*\]\).*/\1/p')
  fi
  [ -n "$list" ] || return 1
  lg=$(echo "$list" | sed "s/\"$NUDGE_ID\"//g; s/, *,/,/g; s/\[ *,/[/; s/, *\]/]/")
  inner=$(echo "$lg" | sed 's/^\[ *//; s/ *\]$//')
  if [ -z "$inner" ]; then nudged="[\"$NUDGE_ID\"]"; else nudged="[$inner,\"$NUDGE_ID\"]"; fi
  luna_once luna://com.webos.service.config/setConfigs "{\"configs\":{\"profile.blockedAppList\":$nudged}}" >/dev/null || return 1
  sleep 2
  for _ in 1 2 3; do
    luna_once luna://com.webos.service.config/setConfigs "{\"configs\":{\"profile.blockedAppList\":$lg}}" |
      grep -q '"returnValue": *true' && return 0
    sleep 1
  done
  return 1
}

# webOS 10 and 11 ignore that list: sam rereads one app on blockSystemApp then
# releaseBlockSystemApp. Nothing is blocked where sam has no release (a block it
# cannot undo would keep Home from launching until a reboot).
sam_reread_app() {
  probe=$(luna_once luna://com.webos.applicationManager/releaseBlockSystemApp "{\"id\":\"$LG_HOME\"}")
  case "$probe" in
    ''|*'Unknown method'*) return 1 ;;
  esac
  force=
  grep -q '"forceBlockSystemApp"' /etc/palm/schemas/sam/applicationManager.blockSystemApp.schema 2>/dev/null &&
    force=',"forceBlockSystemApp":false'
  luna_once luna://com.webos.applicationManager/blockSystemApp "{\"id\":\"$LG_HOME\"$force}" |
    grep -q '"returnValue": *true'
  blocked=$?
  for _ in 1 2 3; do
    luna_once luna://com.webos.applicationManager/releaseBlockSystemApp "{\"id\":\"$LG_HOME\"}" |
      grep -q '"returnValue": *true' && return $blocked
    sleep 1
  done
  return 1
}

reread() {
  if [ "$(webos_major)" -ge 10 ]; then sam_reread_app; else sam_nudge; fi
}

# LG's Home: its own executable on webOS 9, "flutter-client -i com.webos.app.home"
# on webOS 10 and 11.
lg_home_pids() {
  pidof "$LG_HOME" 2>/dev/null
  for cmd in /proc/[0-9]*/cmdline; do
    { tr '\0' ' ' < "$cmd"; } 2>/dev/null | grep -q "^/usr/bin/flutter-client .*-i $LG_HOME " || continue
    pid=${cmd#/proc/}
    echo "${pid%/cmdline}"
  done
}

# LG's Home back: unmount, have sam read LG's manifest again, then end the stub
# (sam must not hold a running web page under a native manifest).
release() {
  if ours; then
    umount "$HOME_APP/appinfo.json" 2>/dev/null
    umount "$HOME_APP" 2>/dev/null || umount -l "$HOME_APP" 2>/dev/null
    reread
    luna_once luna://com.palm.webappmanager/killApp "{\"appId\":\"$LG_HOME\"}" >/dev/null
  fi
}

# Prints "takeover" or "unsupported <why>".
apply() {
  [ -f "$APP_DIR/appinfo.json" ] || { echo "unsupported app_not_installed"; return 1; }
  [ "$(webos_major)" -ge 7 ] || { echo "unsupported webos_$(webos_major)"; return 1; }
  before=$(cat "$STAGE/appinfo.json" "$STAGE/index.html" 2>/dev/null | cksum)
  stage_$MODE || { echo "unsupported stage_failed"; return 1; }
  # The staged files changed (an update, or a switch of mode): a loaded page
  # keeps its old code and sam its old manifest, so toggle it off and on.
  if [ "$before" != "$(cat "$STAGE/appinfo.json" "$STAGE/index.html" 2>/dev/null | cksum)" ]; then
    log "stub changed, remounting"
    release
  fi
  # A mount of the other mode, or of Ember's directory from before an update.
  if ours && ! mounted; then
    log "stale mount, remounting"
    release
  fi
  # Already in place (Ember re-asserts its hooks at each start): nothing to redo.
  if mounted && sam_reports '"type": *"web"' 1; then
    echo takeover
    return 0
  fi
  if ! mounted; then
    if [ "$MODE" = full ]; then
      mount --bind "$APP_DIR" "$HOME_APP" 2>/dev/null &&
        mount --bind "$STAGE/appinfo.json" "$HOME_APP/appinfo.json" 2>/dev/null
    else
      mount --bind "$STAGE" "$HOME_APP" 2>/dev/null
    fi || { release; echo "unsupported mount_failed"; return 1; }
  fi
  if reread && sam_reports '"type": *"web"'; then
    for pid in $(lg_home_pids); do kill "$pid" 2>/dev/null; done
    log "Ember is in LG's Home's place"
    echo takeover
    return 0
  fi
  log "sam did not take the stub; LG's Home kept"
  release
  echo "unsupported sam_refused"
  return 1
}

case "$1" in
  enable)
    case "$2" in
      stub|full) MODE=$2; echo "$MODE" >"$MODE_FILE" ;;
    esac
    out=$(apply)
    case "$out" in
      takeover)
        mkdir -p "$INITD_DIR"
        cat >"$INITD" <<EOF
#!/bin/sh
setsid sh "$SELF" boot >>"$LOG" 2>&1 </dev/null &
exit 0
EOF
        chmod 755 "$INITD"
        ;;
    esac
    echo "$out"
    ;;
  disable)
    rm -f "$INITD" "$MODE_FILE"
    release
    echo disabled
    ;;
  boot)
    # LS2 answers once sam is up; apply() then waits for sam's own first scan.
    i=0
    while [ "$i" -lt 120 ]; do
      luna_once luna://com.webos.applicationManager/getForegroundAppInfo '{}' >/dev/null && break
      i=$((i + 1))
      sleep 1
    done
    out=$(apply)
    echo "$out" >>"$LOG"
    # Ember's boot launch would open the Home-id copy's twin before the mount is
    # there, so in full mode this hook opens it, once it is.
    if [ "$out" = takeover ] && [ "$MODE" = full ] && [ -f "$INITD_DIR/$HOOK_BOOT" ]; then
      luna_once luna://com.webos.applicationManager/launch "{\"id\":\"$LG_HOME\"}" >>"$LOG" 2>&1
    fi
    ;;
  *)
    echo "usage: $0 enable|disable|boot" >&2
    exit 2
    ;;
esac
exit 0
