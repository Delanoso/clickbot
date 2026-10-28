#!/usr/bin/env bash
# Install Mon–Fri Incident depot alerts every 30 minutes (07:00–16:00 Africa/Johannesburg).
# Runs one incidents-monitor cycle and emails when Incident-list trucks are in depot.
#
# Usage on the VPS:
#   cd /opt/clickbot-ops && ./scripts/install-incidents-depot-alert-cron.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# 07:00, 07:30 … 15:30, then a final 16:00 run (no 16:30).
CRON_EXPR_MAIN="${CRON_EXPR_MAIN:-0,30 7-15 * * 1-5}"
CRON_EXPR_END="${CRON_EXPR_END:-0 16 * * 1-5}"
LOG_FILE="${LOG_FILE:-/var/log/clickbot-incidents-depot-alert.log}"
MARKER="# clickbot-incidents-depot-alert"

mkdir -p "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"

CMD="cd ${ROOT} && /usr/bin/env TZ=Africa/Johannesburg /usr/bin/node src/index.js incidents-depot-alert --config config/local.json >> ${LOG_FILE} 2>&1"
LINE_MAIN="${CRON_EXPR_MAIN} ${CMD} ${MARKER}"
LINE_END="${CRON_EXPR_END} ${CMD} ${MARKER}"

EXISTING="$(crontab -l 2>/dev/null || true)"
FILTERED="$(printf '%s\n' "$EXISTING" | grep -v "${MARKER}" || true)"
printf '%s\n%s\n%s\n' "$FILTERED" "$LINE_MAIN" "$LINE_END" | crontab -

echo "Installed cron:"
echo "  ${LINE_MAIN}"
echo "  ${LINE_END}"
echo "Logs: ${LOG_FILE}"
echo "Emails use REPORT_EMAIL_TO / SMTP_* from ${ROOT}/.env"
