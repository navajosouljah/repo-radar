#!/bin/bash
# Radar Lookup runner - polled by launchd every 2 minutes.
# If the queue has pending rows, spawns a headless Claude Code session that drains it.
set -u
SITE_DIR="$HOME/Projects/repo-radar"
LOG="$HOME/Library/Logs/repo-lookup-runner.log"
LOCK="/tmp/repo-lookup-runner.lock"

# Single source of truth for the endpoint: the QUEUE_ENDPOINT const in lookup.js
ENDPOINT=$(sed -n "s/^export const QUEUE_ENDPOINT = '\(.*\)';.*/\1/p" "$SITE_DIR/lookup.js")
[ -z "$ENDPOINT" ] && exit 0   # queue backend not configured yet - nothing to do

# One run at a time (briefings take minutes; poll fires every 2)
if ! mkdir "$LOCK" 2>/dev/null; then exit 0; fi
trap 'rmdir "$LOCK"' EXIT

PENDING=$(curl -s --max-time 20 -L "$ENDPOINT" | /usr/bin/python3 -c "
import json,sys
try: rows=json.load(sys.stdin)
except Exception: rows=[]
print(sum(1 for r in rows if r.get('status')=='pending'))")

[ "${PENDING:-0}" = "0" ] && exit 0

echo "[$(date '+%Y-%m-%d %H:%M:%S')] $PENDING pending - launching drain" >> "$LOG"
cd "$SITE_DIR" && claude -p \
  "Use the repo-lookup skill to drain the Radar Lookup queue now. For each row you process: mark it 'running' via the queue endpoint doPost update action when you start, and 'done' (with detail = the published page path) or 'failed' (with detail = one-line reason) when finished. Publish pages, rebuild the library, commit, deploy to production, and verify live URLs." \
  --dangerously-skip-permissions >> "$LOG" 2>&1
echo "[$(date '+%Y-%m-%d %H:%M:%S')] drain finished (exit $?)" >> "$LOG"
