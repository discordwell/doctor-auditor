#!/usr/bin/env bash
set -euo pipefail

HOST_ALIAS="${HOST_ALIAS:-ovh2}"
REMOTE_ROOT="${REMOTE_ROOT:-/opt/doctor-auditor-api}"

echo "Building dashboard bundle"
npm run build --workspace=dashboard

echo "Creating remote backup"
ssh -o BatchMode=yes "$HOST_ALIAS" '
  set -eu
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  backup="'"$REMOTE_ROOT"'/backups/$ts"
  mkdir -p "$backup/server/app/api" "$backup/server/app/models" "$backup/server/app/services" "$backup/dashboard"
  cp "'"$REMOTE_ROOT"'/server/app/api/cloud_models.py" "$backup/server/app/api/cloud_models.py"
  cp "'"$REMOTE_ROOT"'/server/app/models/schemas.py" "$backup/server/app/models/schemas.py"
  cp "'"$REMOTE_ROOT"'/server/app/services/cloud_repository.py" "$backup/server/app/services/cloud_repository.py"
  tar -C "'"$REMOTE_ROOT"'/dashboard" -czf "$backup/dashboard/dist.tgz" dist
  printf "Backup: %s\n" "$backup"
'

echo "Syncing server runtime files"
rsync -av server/app/api/cloud_models.py "$HOST_ALIAS:$REMOTE_ROOT/server/app/api/cloud_models.py"
rsync -av server/app/models/schemas.py "$HOST_ALIAS:$REMOTE_ROOT/server/app/models/schemas.py"
rsync -av server/app/services/cloud_repository.py "$HOST_ALIAS:$REMOTE_ROOT/server/app/services/cloud_repository.py"

echo "Syncing dashboard dist"
rsync -av --delete dashboard/dist/ "$HOST_ALIAS:$REMOTE_ROOT/dashboard/dist/"

echo "Adding assessment column for existing databases"
ssh -o BatchMode=yes "$HOST_ALIAS" \
  "docker exec doctor-auditor-api-db-1 psql -U doctor_auditor -d doctor_auditor -c 'ALTER TABLE IF EXISTS ops_events ADD COLUMN IF NOT EXISTS assessment_payload JSON;'"

echo "Rebuilding and restarting API"
ssh -o BatchMode=yes "$HOST_ALIAS" \
  "cd '$REMOTE_ROOT' && docker compose -f compose.yml up -d --build server"

echo "Health check"
curl -fsS https://docaudit.discordwell.com/api/health
echo

echo "Current dashboard assets"
curl -fsS https://docaudit.discordwell.com/ | grep -Eo '/assets/[^\" ]+' | sort -u
