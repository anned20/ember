#!/usr/bin/env bash
#
# screenshot.sh — Capture what the TV is showing and save it as a PNG.
#
# Usage:
#   npm run shot                 # writes ./ember-shot.png
#   npm run shot -- out.png
#   ARES_DEVICE=other npm run shot
#
# Asks LG's capture service over SSH, so the TV needs root SSH like deploy.sh.
# It captures the whole panel, video included: put Ember on screen first.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${1:-ember-shot.png}"
REMOTE="/tmp/ember-shot.png"

fields="$(ARES_DEVICE="${ARES_DEVICE:-}" node "$SCRIPT_DIR/ares-default-device.ts")" \
	|| { echo "error: could not resolve the ares device. Add one with ares-setup-device." >&2; exit 1; }
IFS=$'\t' read -r DEV_NAME DEV_HOST DEV_PORT DEV_USER DEV_KEY _ <<<"$fields"
[[ -n "$DEV_HOST" ]] || { echo "error: ares device \"$DEV_NAME\" has no host." >&2; exit 1; }

TARGET="${DEV_USER:-root}@${DEV_HOST}"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o LogLevel=ERROR -i "$HOME/.ssh/${DEV_KEY:-webos_deploy}")

# </dev/null: over SSH luna-send prints nothing unless stdin is closed.
reply="$(ssh "${SSH_OPTS[@]}" -p "${DEV_PORT:-22}" "$TARGET" \
	"luna-send -n 1 -f luna://com.webos.service.capture/executeOneShot '{\"path\":\"$REMOTE\",\"method\":\"DISPLAY\",\"format\":\"PNG\",\"width\":1920,\"height\":1080}' </dev/null")"
grep -q '"returnValue": *true' <<<"$reply" || { echo "error: the TV refused the capture: $reply" >&2; exit 1; }

scp "${SSH_OPTS[@]}" -P "${DEV_PORT:-22}" "$TARGET:$REMOTE" "$OUT" >/dev/null
ssh "${SSH_OPTS[@]}" -p "${DEV_PORT:-22}" "$TARGET" "rm -f $REMOTE" || true
echo "$OUT"
