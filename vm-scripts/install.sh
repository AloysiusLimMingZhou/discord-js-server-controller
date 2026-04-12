#!/usr/bin/env bash
# ============================================================================
#  install.sh — Deploy VM notification scripts onto the TARGET VM (AI server)
# ============================================================================
#  Run this script ONCE on the target VM (AI server) (as root or with sudo):
#
#    sudo bash install.sh --bot-url http://naic-bot.chocorot.net
#
#  What it does:
#   1. Copies the shell scripts to /opt/vm-scripts/
#   2. Installs two systemd services:
#        • startup-notify.service    — fires /notify/started on every boot
#        • shutdown-notify.service   — fires /notify/stopping on every shutdown
#        • preemption-watcher.service — watches for GCP preemption and fires
#                                       /notify/stopping ONLY on spot eviction
#   3. Enables and starts both services.
#
#  After installation you can check status with:
#    sudo systemctl status preemption-watcher
#    sudo systemctl status startup-notify
#    sudo systemctl status shutdown-notify
#    sudo journalctl -u preemption-watcher -f
# ============================================================================

set -euo pipefail

# ─── Colour helpers ──────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; NC='\033[0m'
info()  { echo -e "${BLUE}ℹ  $*${NC}"; }
ok()    { echo -e "${GREEN}✅  $*${NC}"; }
warn()  { echo -e "${YELLOW}⚠  $*${NC}"; }
err()   { echo -e "${RED}❌  $*${NC}" >&2; }

# ─── Defaults ────────────────────────────────────────────────────────────────
BOT_URL=""
INSTALL_DIR="/opt/vm-scripts"
SERVICE_DIR="/etc/systemd/system"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ─── Argument parsing ────────────────────────────────────────────────────────
show_help() {
  cat <<EOF
install.sh — Deploy VM notification scripts onto the target VM (AI server)

Usage:
  sudo bash install.sh --bot-url http://naic-bot.chocorot.net  [--install-dir DIR]

Options:
  --bot-url     URL of the bot VM's Express server (required)
  --install-dir Directory to install scripts on the target VM (default: /opt/vm-scripts)
  --help        Show this message
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bot-url)      BOT_URL="$2";       shift 2 ;;
    --install-dir)  INSTALL_DIR="$2";   shift 2 ;;
    --help|-h)      show_help; exit 0 ;;
    *) err "Unknown option: $1"; show_help; exit 1 ;;
  esac
done

# ─── Validation ──────────────────────────────────────────────────────────────
if [[ -z "$BOT_URL" ]]; then
  err "--bot-url is required."
  echo ""
  show_help
  exit 1
fi

if [[ "$EUID" -ne 0 ]]; then
  err "This script must be run as root (use sudo)."
  exit 1
fi

# ─── Install ─────────────────────────────────────────────────────────────────
info "Installing VM notification scripts on target VM (AI server)…"
info "  Bot VM URL  : ${BOT_URL}"
info "  Install dir : ${INSTALL_DIR} (on target VM)"
echo ""

# 1. Create install directory and copy scripts
mkdir -p "${INSTALL_DIR}"

for script in preemption-watcher.sh startup-notify.sh shutdown-notify.sh; do
  if [[ ! -f "${SCRIPT_DIR}/${script}" ]]; then
    err "Required script not found: ${SCRIPT_DIR}/${script}"
    exit 1
  fi
  cp "${SCRIPT_DIR}/${script}" "${INSTALL_DIR}/${script}"
  chmod +x "${INSTALL_DIR}/${script}"
  ok "Installed ${script} → ${INSTALL_DIR}/${script}"
done

# 2. Install systemd service files (with BOT_URL substituted in)
for svc in preemption-watcher.service startup-notify.service shutdown-notify.service; do
  if [[ ! -f "${SCRIPT_DIR}/${svc}" ]]; then
    err "Required service file not found: ${SCRIPT_DIR}/${svc}"
    exit 1
  fi

  # Replace the placeholder BOT_URL with the real value
  sed "s|Environment=\"BOT_URL=.*\"|Environment=\"BOT_URL=${BOT_URL}\"|g" \
    "${SCRIPT_DIR}/${svc}" > "${SERVICE_DIR}/${svc}"

  ok "Installed ${svc} → ${SERVICE_DIR}/${svc}"
done

# 3. Reload systemd and enable / start services
info "Reloading systemd daemon…"
systemctl daemon-reload

for svc in startup-notify shutdown-notify preemption-watcher; do
  systemctl enable "${svc}.service"
  systemctl restart "${svc}.service"
  ok "Enabled and (re)started ${svc}.service"
done

# startup-notify is a oneshot service — it already ran on this boot.
# It will fire automatically on the next reboot.
warn "startup-notify.service will fire automatically on the NEXT reboot."
warn "To test it now, run:  sudo systemctl start startup-notify.service"

echo ""
ok "Installation complete!"
echo ""
echo "  Check watcher status  : sudo systemctl status preemption-watcher"
echo "  Follow watcher logs   : sudo journalctl -u preemption-watcher -f"
echo "  Check startup status  : sudo systemctl status startup-notify"
echo "  Check shutdown status : sudo systemctl status shutdown-notify"
