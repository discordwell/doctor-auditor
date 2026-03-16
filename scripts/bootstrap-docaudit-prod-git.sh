#!/usr/bin/env bash
set -euo pipefail

HOST_ALIAS="${HOST_ALIAS:-ovh2}"
REMOTE_ROOT="${REMOTE_ROOT:-/opt/doctor-auditor-api}"
BRANCH="${BRANCH:-main}"
ORIGIN_URL="${ORIGIN_URL:-git@github.com:discordwell/doctor-auditor.git}"

echo "Bootstrapping ${HOST_ALIAS}:${REMOTE_ROOT} as a git checkout"
ssh -o BatchMode=yes "$HOST_ALIAS" "
  set -euo pipefail

  if [ -d '$REMOTE_ROOT/.git' ]; then
    echo '$REMOTE_ROOT is already a git checkout'
    exit 0
  fi

  ts=\$(date -u +%Y%m%dT%H%M%SZ)
  backup='${REMOTE_ROOT}-manual-'\$ts
  tmp_checkout=\$(mktemp -d /tmp/doctor-auditor-api-bootstrap-XXXXXX)
  owner=\$(id -un):\$(id -gn)

  git clone --branch '$BRANCH' '$ORIGIN_URL' \"\$tmp_checkout\"
  cp '$REMOTE_ROOT/.env' \"\$tmp_checkout/.env\"
  sudo mv '$REMOTE_ROOT' \"\$backup\"
  sudo mv \"\$tmp_checkout\" '$REMOTE_ROOT'
  sudo chown -R \"\$owner\" '$REMOTE_ROOT'

  echo \"Previous manual deploy preserved at \$backup\"
"
