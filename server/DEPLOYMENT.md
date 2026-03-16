# Deployment

## Current production shape

Doctor Auditor runs as a normal hosted web stack:

- `https://docaudit.discordwell.com/` serves the dashboard build
- `https://docaudit.discordwell.com/api/...` serves the FastAPI boundary
- PostgreSQL stays private behind the app tier
- raw audio, full transcripts, and local review state do not cross the cloud boundary

In production, a TLS reverse proxy such as Caddy should terminate HTTPS and keep the browser on the same origin for both dashboard and API traffic.

## Public routing

The intended public contract is:

- `/` -> static dashboard build
- `/api/*` -> FastAPI upstream
- `/api/health` or `/health` -> server health check, depending on the edge rewrite

This is the normal shape for the browser dashboard. The dashboard code already uses relative `/api` paths, so it should not be pointed at a desktop-local host.

## Desktop boundary

The desktop app is local-first, but its cloud sync boundary is remote:

- approved exports post to the hosted `/api/approved-exports/...` surface
- ops events post to the hosted `/api/ops-events/...` surface
- Remote assist posts minimized packets to the hosted `/api/assist-gateway/...` surface

The desktop default boundary is:

```text
https://docaudit.discordwell.com/api
```

Set `DOCTOR_AUDITOR_API_URL` only when you intentionally want the desktop app to target a different hosted boundary.

## Server surface

Keep the hosted FastAPI boundary narrow:

- auth
- approved exports
- ops events
- demo seed
- Remote assist gateway

Do not add raw transcript upload, raw audio upload, or a browser-facing route that tries to reach back into the local workstation.

## DNS and hostnames

No additional DNS is needed for the current architecture as long as `docaudit.discordwell.com` continues to serve both the dashboard and `/api`.

You only need new DNS when you intentionally split the deployment, for example:

- `api.discordwell.com` for a separate public API origin
- a separate internal or public hostname for a distinct inference service

## Local repo notes

The root `docker-compose.yml` and `dashboard/nginx.conf` are local container/dev wiring. Production hosting should preserve the same public contract even if the exact reverse proxy or container layout differs:

- dashboard at `/`
- FastAPI at `/api`
- PostgreSQL private
- TLS at the edge

## Production checkout

Production now expects `/opt/doctor-auditor-api` to be a git checkout of this repo.

- keep the production compose file in `ops/ovh2/compose.yml`
- keep the production `.env` untracked in the repo root on the host
- let Caddy serve `dashboard/dist` and proxy `/api` to the compose-managed server port

The one-time host conversion is:

```bash
./scripts/bootstrap-docaudit-prod-git.sh
```

The normal deploy path after that is:

```bash
./scripts/deploy-docaudit-prod.sh
```

That deploy script performs a remote `git pull`, installs workspace dependencies, rebuilds the dashboard, and rebuilds the FastAPI container with `ops/ovh2/compose.yml`.
