#!/usr/bin/env bash
# Install a Mon–Fri cron job that runs the tracking report (incident + camera one cycle → email).
# Default: 07:00 Africa/Johannesburg, Monday–Friday only.
#
# Usage on the VPS:
#   cd /opt/clickbot-ops && ./scripts/install-tracking-report-cron.sh
# Optional:
#   CRON_EXPR='0 7 * * 1-5' ./scripts/install-tracking-report-cron.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CRON_EXPR="${CRON_EXPR:-0 7 * * 1-5}"
LOG_FILE="${LOG_FILE:-/var/log/clickbot-tracking-report.log}"
MARKER="# clickbot-tracking-report"

mkdir -p "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"

CMD="cd ${ROOT} && /usr/bin/env TZ=Africa/Johannesburg /usr/bin/node src/index.js tracking-report --config config/local.json >> ${LOG_FILE} 2>&1"
LINE="${CRON_EXPR} ${CMD} ${MARKER}"

EXISTING="$(crontab -l 2>/dev/null || true)"
FILTERED="$(printf '%s\n' "$EXISTING" | grep -v "${MARKER}" || true)"
printf '%s\n%s\n' "$FILTERED" "$LINE" | crontab -

echo "Installed cron:"
echo "  ${LINE}"
echo "Logs: ${LOG_FILE}"
echo "Make sure REPORT_EMAIL_TO / SMTP_* are set in ${ROOT}/.env"
