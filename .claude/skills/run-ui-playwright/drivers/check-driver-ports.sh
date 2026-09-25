#!/usr/bin/env bash
# Fails if any driver hardcodes the admin or app URL instead of reading
# ADMIN / EXPO from lib.mjs (which honour ADMIN_URL / EXPO_URL).
#
# WHY THIS IS A CI GUARD AND NOT A NOTE. A worktree runs its apps on its own
# ports (docs/WORKTREES.md). A driver with `http://localhost:3000` baked in aims
# at whatever is on the default port — a sibling's build, or nothing — so it
# passes or fails against code it was never pointed at. The BACKLOG item filed
# 2026-09-12 counted three such drivers; the grep that fixed them found EIGHT.
# The rule is mechanical, so a failing build holds it, not a sentence.
#
# lib.mjs is the one place the defaults live. Comments are ignored. Only the
# APP ports are matched (3xxx admin, 80xx Expo, on localhost or 127.0.0.1):
# Supabase's 543xx ports are one stack shared by every worktree, so a driver
# naming them is correct.
#
# Run locally:  .claude/skills/run-ui-playwright/drivers/check-driver-ports.sh

set -euo pipefail
cd "$(dirname "$0")"

hits=$(grep -nE '(localhost|127\.0\.0\.1):(3[0-9]{3}|80[0-9]{2})([^0-9]|$)' -- *.mjs \
  | grep -v '^lib\.mjs:' \
  | grep -vE '^[^:]+:[0-9]+:[[:space:]]*//' || true)

if [[ -n "$hits" ]]; then
  echo "✗ driver(s) hardcode a port:"
  echo "$hits" | sed 's/^/    /'
  cat <<'MSG'

Import the base URL from lib.mjs instead — it reads ADMIN_URL / EXPO_URL, so a
worktree on its own ports drives its OWN build:
  import { ADMIN, EXPO } from "./lib.mjs";
  await page.goto(`${ADMIN}/students`);
MSG
  exit 1
fi

echo "✓ no driver hardcodes a port (all read ADMIN / EXPO from lib.mjs)"
