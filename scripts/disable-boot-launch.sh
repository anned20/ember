#!/bin/sh
# Disable Launch Home boot-on-start (run as root via hbchannel exec).

. "$(dirname "$0")/brand.sh"

INITD="$INITD_DIR/$HOOK_BOOT"
OLD_INITD="$INITD_DIR/$LEGACY_HOOK_BOOT"

rm -f "$INITD" "$OLD_INITD"
echo disabled
exit 0
