#!/usr/bin/env bash
# ============================================================================
#  shutdown-notify.sh
#  Runs ONCE during system shutdown on the TARGET VM (AI server) (via systemd).
#  POSTs to the bot VM's /notify/stopping endpoint.
#
#  This catches ALL shutdown types:
#    - Manual stop via GCP Console
#    - gcloud compute instances stop
#    - sudo shutdown / sudo poweroff
#    - GCP Spot preemption (preemption-watcher also fires — that's fine)
#
#  The companion systemd service uses ExecStop= to trigger this script
#  when the system is shutting down.
# ============================================================================

set -euo pipefail

BOT_URL="${BOT_URL:-https://naic-bot.chocorot.net}"

log() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"; }

log "🛑  VM is shutting down — sending shutdown notification to bot…"

# We have limited time during shutdown, so we try a few times quickly.
MAX_ATTEMPTS=3
WAIT=2

for attempt in $(seq 1 "${MAX_ATTEMPTS}"); do
  if curl --silent --fail --max-time 5 \
      -X POST "${BOT_URL}/notify/stopping" \
      -H "Content-Type: application/json" \
      -d '{"source":"shutdown-hook"}'; then
    log "✅  /notify/stopping sent successfully (attempt ${attempt})."
    exit 0
  fi

  log "⚠   Attempt ${attempt}/${MAX_ATTEMPTS} failed — retrying in ${WAIT}s…"
  sleep "${WAIT}"
done

log "❌  Could not reach bot after ${MAX_ATTEMPTS} attempts. Giving up."
exit 1
