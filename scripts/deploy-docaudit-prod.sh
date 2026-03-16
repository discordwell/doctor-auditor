#!/usr/bin/env bash
set -euo pipefail

HOST_ALIAS="${HOST_ALIAS:-ovh2}"
REMOTE_ROOT="${REMOTE_ROOT:-/opt/doctor-auditor-api}"
BRANCH="${BRANCH:-main}"
PUBLIC_URL="${PUBLIC_URL:-https://docaudit.discordwell.com}"

echo "Deploying ${BRANCH} to ${HOST_ALIAS}:${REMOTE_ROOT}"
ssh -o BatchMode=yes "$HOST_ALIAS" "
  set -euo pipefail
  cd '$REMOTE_ROOT'

  if [ ! -d .git ]; then
    echo 'Remote root is not a git checkout. Run scripts/bootstrap-docaudit-prod-git.sh first.' >&2
    exit 1
  fi

  current_branch=\$(git branch --show-current || true)
  if [ -n \"\$current_branch\" ] && [ \"\$current_branch\" != '$BRANCH' ]; then
    git checkout '$BRANCH'
  fi

  git fetch origin '$BRANCH'
  git pull --ff-only origin '$BRANCH'
  npm ci
  npm run build --workspace=dashboard
  docker compose --env-file .env -f ops/ovh2/compose.yml up -d --build server
"

echo "Health check"
curl -fsS "$PUBLIC_URL/api/health"
echo

echo "Current dashboard assets"
curl -fsS "$PUBLIC_URL/" | grep -Eo '/assets/[^\" ]+' | sort -u
