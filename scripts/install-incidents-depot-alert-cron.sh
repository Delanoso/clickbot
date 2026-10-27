#!/usr/bin/env bash
# Install hourly Mon–Fri Incident depot alerts (07:00–16:00 Africa/Johannesburg).
# Runs one incidents-monitor cycle and emails when Incident-list trucks are in depot.
#
# Usage on the VPS:
#   cd /opt/clickbot-ops && ./scripts/install-incidents-depot-alert-cron.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CRON_EXPR="${CRON_EXPR:-0 7-16 * * 1-5}"
LOG_FILE="${LOG_FILE:-/var/log/clickbot-incidents-depot-alert.log}"
MARKER="# clickbot-incidents-depot-alert"

mkdir -p "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"

CMD="cd ${ROOT} && /usr/bin/env TZ=Africa/Johannesburg /usr/bin/node src/index.js incidents-depot-alert --config config/local.json >> ${LOG_FILE} 2>&1"
LINE="${CRON_EXPR} ${CMD} ${MARKER}"

EXISTING="$(crontab -l 2>/dev/null || true)"
FILTERED="$(printf '%s\n' "$EXISTING" | grep -v "${MARKER}" || true)"
printf '%s\n%s\n' "$FILTERED" "$LINE" | crontab -

echo "Installed cron:"
echo "  ${LINE}"
echo "Logs: ${LOG_FILE}"
echo "Emails use REPORT_EMAIL_TO / SMTP_* from ${ROOT}/.env"
