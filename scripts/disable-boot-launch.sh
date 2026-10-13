#!/bin/sh
# Disable Ember boot-on-start (run as root via hbchannel exec).

. "$(dirname "$0")/brand.sh"

INITD="$INITD_DIR/$HOOK_BOOT"

rm -f "$INITD"
echo disabled
exit 0
