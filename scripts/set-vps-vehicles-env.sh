#!/usr/bin/env bash
# Add Wake Trucks Lytx credentials on the VPS .env (run from a machine with SSH access).
set -euo pipefail

VPS_HOST="${VPS_HOST:-169.239.181.217}"
VPS_USER="${VPS_USER:-root}"
APP_DIR="${APP_DIR:-/opt/clickbot-ops}"
ENV_FILE="${APP_DIR}/.env"

USERNAME="${LYTX_VEHICLES_USERNAME:?Set LYTX_VEHICLES_USERNAME}"
PASSWORD="${LYTX_VEHICLES_PASSWORD:?Set LYTX_VEHICLES_PASSWORD}"

upsert_env() {
  local key="$1"
  local value="$2"
  ssh "${VPS_USER}@${VPS_HOST}" "bash -s" -- "$key" "$value" "$ENV_FILE" <<'REMOTE'
set -euo pipefail
key="$1"
value="$2"
file="$3"
touch "$file"
if grep -q "^${key}=" "$file" 2>/dev/null; then
  sed -i "s|^${key}=.*|${key}=${value}|" "$file"
else
  printf '%s=%s\n' "$key" "$value" >> "$file"
fi
REMOTE
}

upsert_env "LYTX_VEHICLES_USERNAME" "$USERNAME"
upsert_env "LYTX_VEHICLES_PASSWORD" "$PASSWORD"

ssh "${VPS_USER}@${VPS_HOST}" "cd ${APP_DIR} && pm2 restart clickbot-ops"
echo "Updated ${ENV_FILE} on ${VPS_HOST} and restarted clickbot-ops."
