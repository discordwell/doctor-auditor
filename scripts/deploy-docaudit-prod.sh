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
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "$PUBLIC_URL/api/health"; then
    echo
    break
  fi
  if [ "$attempt" -eq 10 ]; then
    echo "Public health check failed after ${attempt} attempts" >&2
    exit 1
  fi
  sleep 2
done

echo "Current dashboard assets"
ssh -o BatchMode=yes "$HOST_ALIAS" "
  set -euo pipefail
  cd '$REMOTE_ROOT'
  ls -1 dashboard/dist/assets
"

echo "Dashboard assessment strings"
ssh -o BatchMode=yes "$HOST_ALIAS" "
  set -euo pipefail
  cd '$REMOTE_ROOT'
  grep -R -E -o 'Actual gateway assessments|Assessment spotlight|Latest gateway assessments|Remote assist and delivery activity' dashboard/dist/assets | sort -u
"
