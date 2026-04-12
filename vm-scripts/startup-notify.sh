#!/usr/bin/env bash
# ============================================================================
#  startup-notify.sh
#  Runs ONCE on boot on the TARGET VM (AI server) (via systemd).
#  POSTs to the bot VM's /notify/started endpoint.
#
#  Waits for the bot VM's Express server to be reachable before sending,
#  with exponential back-off — so transient network hiccups on boot don't
#  cause a missed notification.
# ============================================================================

set -euo pipefail

BOT_URL="${BOT_URL:-http://naic-bot.chocorot.net}"

log() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"; }

MAX_ATTEMPTS=10
WAIT=5

log "🚀  VM is up — sending startup notification to bot…"

for attempt in $(seq 1 "${MAX_ATTEMPTS}"); do
  if curl --silent --fail --max-time 10 \
      -X POST "${BOT_URL}/notify/started" \
      -H "Content-Type: application/json" \
      -d '{}'; then
    log "✅  /notify/started sent successfully (attempt ${attempt})."
    exit 0
  fi

  log "⚠   Attempt ${attempt}/${MAX_ATTEMPTS} failed — retrying in ${WAIT}s…"
  sleep "${WAIT}"
  WAIT=$((WAIT * 2))   # back-off: 5 → 10 → 20 → 40 … (capped by MAX_ATTEMPTS)
done

log "❌  Could not reach bot after ${MAX_ATTEMPTS} attempts. Giving up."
exit 1
