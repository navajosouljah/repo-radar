#!/usr/bin/env bash
# ship.sh - the only way Repo Radar goes live: sync with GitHub, build, verify, push.
# The push to GitHub triggers the Vercel deploy. Never run `vercel deploy` from a laptop:
# the next GitHub deploy silently overwrites it (that is how the Aug 28 security purge was undone).
set -euo pipefail
cd "$(dirname "$0")/.."
msg="${1:?usage: scripts/ship.sh \"commit message\"}"
branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" = "main" ] || { echo "ship.sh ships main only (on $branch)"; exit 1; }
git fetch -q origin
git pull -q --rebase --autostash origin main
if [ -f scripts/build.mjs ]; then node scripts/build.mjs --hub; fi
node --test scripts/*.test.mjs >/tmp/rr-ship-tests.log 2>&1 || { tail -30 /tmp/rr-ship-tests.log; echo "ship.sh: tests failed, nothing pushed"; exit 1; }
node scripts/verify.mjs
git add -A
if git diff --cached --quiet; then echo "nothing to ship"; exit 0; fi
git commit -q -m "$msg"
git push -q origin main
echo "pushed $(git rev-parse --short HEAD); Vercel deploys from GitHub in about a minute"
