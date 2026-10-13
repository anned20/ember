#!/bin/sh
# Enable Ember boot-on-start via Homebrew init.d (run as root via hbchannel exec).

. "$(dirname "$0")/brand.sh"

LAUNCH="$APP_DIR/boot-launch.sh"
LOG="$TMP_PREFIX-boot.log"
INITD="$INITD_DIR/$HOOK_BOOT"

if [ ! -f "$LAUNCH" ]; then
  echo missing_boot_script
  exit 1
fi

chmod 755 "$LAUNCH"
mkdir -p "$INITD_DIR"
# Drop the stale hooks left by the Launch Home and older Lounge identities.
for h in $LEGACY_HOOKS; do
  rm -f "$INITD_DIR/$h"
done

cat >"$INITD" <<EOF
#!/bin/sh
LOG="$LOG"
LAUNCH="$LAUNCH"
setsid "\$LAUNCH" >>"\$LOG" 2>&1 </dev/null &
exit 0
EOF
chmod 755 "$INITD"

echo enabled boot=$INITD
exit 0
