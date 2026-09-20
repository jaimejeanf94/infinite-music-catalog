#!/bin/sh
# Waits for a running enrich.mjs to finish, then sweeps up the gaps: albums
# that failed, and albums that matched but carry no genres. Exists so the
# retry pass is not something anyone has to remember.
#
#   nohup sh scripts/after-backfill.sh > data/retry-run.log 2>&1 &
#
# The nightly GitHub workflow does the same thing on a schedule; this is for
# the one-off local backfill.
cd "$(dirname "$0")/.." || exit 1

while pgrep -f "enrich.mjs" | grep -qv "$$"; do
  sleep 60
done

echo "main pass finished $(date '+%Y-%m-%d %H:%M') — sweeping the gaps"
# --retry-after=0 because these were just written; the 14-day cooldown is for
# the nightly job, not for the sweep straight after a backfill.
node scripts/enrich.mjs --retry --retry-after=0
echo "sweep finished $(date '+%Y-%m-%d %H:%M')"
