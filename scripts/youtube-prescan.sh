#!/usr/bin/env bash
# youtube-prescan.sh - the YouTube discovery source, run from a Mac the night before the Friday edition.
# The cloud routine cannot read YouTube (CAPTCHA), so this scans with yt-dlp here, saves the hits to
# data/candidates/<friday>.youtube.json, and ships that file. The Friday run's candidates.mjs merges
# it in as the youtube source. Scheduled by ~/Library/LaunchAgents/com.jjgilmore.repo-radar-youtube.plist
# (Thursdays 8 PM Mountain). Run by hand any time: scripts/youtube-prescan.sh [YYYY-MM-DD]
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin:$PATH"
export YTDLP="${YTDLP:-$HOME/.agent-reach-venv/bin/yt-dlp}"
[ -x "$YTDLP" ] || { echo "yt-dlp not found at $YTDLP"; exit 1; }
# Next Friday (or today if it is Friday), in local time.
if [ -n "${1:-}" ]; then date="$1"; else
  date="$(python3 -c 'import datetime as d; t=d.date.today(); print((t+d.timedelta(days=(4-t.weekday())%7)).isoformat())')"
fi
git fetch -q origin && git pull -q --no-rebase --no-edit --autostash origin main
node scripts/candidates.mjs "$date" --youtube-only
scripts/ship.sh "YouTube pre-scan for $date"
