#!/usr/bin/env bash
# Deploy clickbot to the VPS and restart the dashboard.
# Usage (from repo root, on a machine with SSH access):
#   VPS_SSH_PASSWORD='your-root-password' ./scripts/deploy-to-vps.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VPS_HOST="${VPS_HOST:-169.239.181.217}"
VPS_USER="${VPS_USER:-root}"
APP_DIR="${APP_DIR:-/opt/clickbot-ops}"
PASSWORD="${VPS_SSH_PASSWORD:-${SSHPASS:-}}"

if [[ -z "$PASSWORD" ]]; then
  echo "Set VPS_SSH_PASSWORD (root SSH password) and run again." >&2
  exit 1
fi

export SSHPASS="$PASSWORD"
command -v sshpass >/dev/null || { echo "Install sshpass first." >&2; exit 1; }

echo "Packaging…"
tar czf /tmp/clickbot-deploy.tgz \
  -C "$ROOT" \
  --exclude=node_modules \
  --exclude=.git \
  --exclude=data/runtime \
  --exclude=.env \
  src config package.json package-lock.json scripts README.md .env.example

echo "Uploading to ${VPS_USER}@${VPS_HOST}:${APP_DIR}…"
sshpass -e scp -o StrictHostKeyChecking=no /tmp/clickbot-deploy.tgz \
  "${VPS_USER}@${VPS_HOST}:/tmp/clickbot-deploy.tgz"

echo "Installing…"
sshpass -e ssh -o StrictHostKeyChecking=no "${VPS_USER}@${VPS_HOST}" bash -s <<REMOTE
set -euo pipefail
cd "${APP_DIR}"
tar xzf /tmp/clickbot-deploy.tgz

# Wake Trucks Lytx credentials (change after testing)
touch .env
upsert() {
  local k="\$1" v="\$2"
  if grep -q "^\${k}=" .env 2>/dev/null; then
    sed -i "s|^\${k}=.*|\${k}=\${v}|" .env
  else
    echo "\${k}=\${v}" >> .env
  fi
}
upsert LYTX_VEHICLES_USERNAME "chrisa@hfr.co.za"
upsert LYTX_VEHICLES_PASSWORD "Vianda1963"

pm2 restart clickbot-ops
sleep 2
curl -sS http://127.0.0.1:8787/api/tasks | python3 -c 'import sys,json; print([t["id"] for t in json.load(sys.stdin)["tasks"]])'
REMOTE

echo "Done. Open http://${VPS_HOST}:8790/ and hard-refresh (Ctrl+Shift+R)."
