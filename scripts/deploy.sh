#!/usr/bin/env bash
#
# deploy.sh — Deploy Launch Home to the default ares device.
#
# Usage:
#   npm run deploy
#   ARES_DEVICE=emulator npm run deploy
#
# Resolves the ares device (default, or ARES_DEVICE) and hands off to the
# installer, which builds the IPK and installs it over SSH (appinstalld).
# ares-install is never used: its exec channel fails against the TV's dropbear
# ("Unable to exec") after uploading the package.
#
# Environment:
#   ARES_DEVICE  ares device name (default: the ares default device)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ARES_DEVICE="${ARES_DEVICE:-}"

c_grn() { printf '\033[32m%s\033[0m' "$*"; }
c_red() { printf '\033[31m%s\033[0m' "$*"; }
section() { printf "\n\033[1;36m━━ %s ━━\033[0m\n" "$*"; }
die() { printf "%s\n" "$(c_red "error: $*")" >&2; exit 1; }

section "Resolving ares device"
fields="$(ARES_DEVICE="$ARES_DEVICE" node "$SCRIPT_DIR/ares-default-device.js")" \
	|| die "Could not resolve the ares device."
IFS=$'\t' read -r DEV_NAME DEV_HOST DEV_PORT DEV_USER DEV_KEY DEV_PASSWORD <<<"$fields"

[[ -n "$DEV_HOST" ]] || die "Resolved ares device \"$DEV_NAME\" has no host."
printf "  Device: %s (%s@%s:%s)\n" "$(c_grn "$DEV_NAME")" "$DEV_USER" "$DEV_HOST" "$DEV_PORT"

section "Deploying to TV"
# Reuse the proven installer: it builds the IPK and installs over SSH (via
# appinstalld). SETUP_DEVICE=0 so it does not clobber the ares device we
# just resolved.
exec env \
	TV_IP="$DEV_HOST" \
	DEVICE="$DEV_NAME" \
	SSH_KEY="${DEV_KEY:-webos_deploy}" \
	ROOT_PASSWORD="${DEV_PASSWORD:-alpine}" \
	SETUP_DEVICE=0 \
	"$ROOT_DIR/install2tvfrommacos.sh"
