#!/bin/sh
# Point git at the committed hooks, without clobbering a hooksPath set by hand.
git rev-parse --git-dir >/dev/null 2>&1 || exit 0
if [ -n "$(git config --get core.hooksPath || true)" ]; then
  exit 0
fi
git config core.hooksPath .githooks
