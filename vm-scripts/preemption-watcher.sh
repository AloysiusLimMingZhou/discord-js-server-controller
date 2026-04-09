#!/usr/bin/env bash
# ============================================================================
#  preemption-watcher.sh
#  Runs as a background daemon on the TARGET VM (AI server).
#
#  HOW IT WORKS
#  ─────────────────────────────────────────────────────────────────────────
#  GCP exposes a metadata endpoint that reflects VM lifecycle events:
#
#    http://metadata.google.internal/computeMetadata/v1/instance/maintenance-event
#
#  Normally it returns "NONE".  When GCP is about to preempt (kill) a Spot
#  VM it changes to "TERMINATE" and the target VM (AI server) gets ~25 seconds
#  before forced power-off.  Importantly, THIS DOES NOT HAPPEN on manual
#  shutdowns (gcloud compute instances stop / sudo shutdown / GCP Console).
#
#  We use the metadata server's long-poll support (?wait_for_change=true)
#  so the curl blocks until the value changes — zero CPU overhead.
#
#  On detecting "TERMINATE" we immediately POST to the bot VM's
#  /notify/stopping endpoint so a Discord alert fires before the VM dies.
#
#  USAGE (managed by systemd — see preemption-watcher.service)
#    You should not need to call this script directly.
# ============================================================================

set -euo pipefail

# ─── Configuration ───────────────────────────────────────────────────────────
# URL of the bot VM's Express server.
# Override with the BOT_URL environment variable or set it via install.sh.
BOT_URL="${BOT_URL:-http://BOT_VM_IP:3000}"

METADATA_BASE="http://metadata.google.internal/computeMetadata/v1"
METADATA_HEADER="Metadata-Flavor: Google"

# How long (seconds) to wait for a metadata change before re-polling.
# GCP's recommended value is 60–300 s.  Use 60 so we reconnect frequently
# enough to survive transient network hiccups inside the metadata server.
POLL_TIMEOUT=60

# How many seconds to wait between retries when curl itself fails.
RETRY_DELAY=5

# ─── Helpers ─────────────────────────────────────────────────────────────────
log() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"; }

notify_stopping() {
  log "⚡  GCP preemption detected — sending /notify/stopping to bot…"
  curl --silent --fail --max-time 10 \
    -X POST "${BOT_URL}/notify/stopping" \
    -H "Content-Type: application/json" \
    -d '{}' \
    && log "✅  /notify/stopping sent successfully." \
    || log "⚠   Failed to reach bot endpoint (VM may already be cut off)."
}

# ─── Main watch loop ─────────────────────────────────────────────────────────
log "🔍  Preemption watcher started. Polling GCP metadata server…"
log "    Bot URL : ${BOT_URL}"

last_etag=""

while true; do
  # Build URL — include last etag so the server only responds when the value
  # actually changes (long-poll).
  url="${METADATA_BASE}/instance/maintenance-event?wait_for_change=true&timeout_sec=${POLL_TIMEOUT}"
  if [[ -n "$last_etag" ]]; then
    url="${url}&last_etag=${last_etag}"
  fi

  # Capture both the response body and the response headers (for the etag).
  # We write headers to a temp file so we can parse them without a pipe.
  HEADER_FILE="$(mktemp)"

  event=""
  if ! event=$(curl --silent --fail --max-time $((POLL_TIMEOUT + 10)) \
        -H "${METADATA_HEADER}" \
        -D "${HEADER_FILE}" \
        "${url}" 2>/dev/null); then
    log "⚠   curl failed reaching metadata server — retrying in ${RETRY_DELAY}s…"
    rm -f "${HEADER_FILE}"
    sleep "${RETRY_DELAY}"
    continue
  fi

  # Extract the new etag so next poll only fires on a real change.
  new_etag=$(grep -i '^etag:' "${HEADER_FILE}" | awk '{print $2}' | tr -d '\r')
  rm -f "${HEADER_FILE}"
  [[ -n "$new_etag" ]] && last_etag="$new_etag"

  log "   maintenance-event = '${event}'"

  case "$event" in
    TERMINATE)
      notify_stopping
      # Wait briefly so the message reaches the bot before network is cut.
      sleep 5
      # Exit — the VM is about to die anyway; systemd will clean us up.
      exit 0
      ;;
    NONE|"")
      # Normal state — keep polling.
      ;;
    *)
      log "   Unknown event '${event}' — ignoring."
      ;;
  esac
done
