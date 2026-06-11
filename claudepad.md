# Claudepad

## Session Summaries

### 2026-06-10 ~19:20 UTC — Auth hardening for assist gateway + JWT rotation + sync client resilience

Maintenance pass (automated). Closed the one unauthenticated API surface and fixed adjacent issues found during review:

- `POST /api/assist-gateway/seriousness-assessments` (spends server's `OPENAI_API_KEY`) now requires a bearer token; per-requester rate limit keys on the verified `org:sub` identity instead of the caller-supplied `requestedBy`. Requester limiter is acquired before the global one so an over-limit identity cannot starve other orgs.
- All data routers (`demo`, `approved-exports`, `ops-events`, `assist-gateway`) now carry router-level `Depends(verify_token)` so new routes are authenticated by default.
- `JWT_SECRET_FALLBACKS` was dead config — `verify_token` now tries rotation fallbacks (docs added to `server/DEPLOYMENT.md`).
- Desktop `CloudSyncClient`: assist calls authenticated; on 401 re-auths once and retries (tokens expire after 60 min, sessions run longer); single-flight login for concurrent calls; rejects auth responses without a token; rate-limiter stale-bucket pruning server-side.
- Test isolation fix: `server/tests/conftest.py` now sets `DATABASE_URL` before any app import. Previously, alphabetical collection order could freeze the engine onto `server/.env`'s sqlite file — full-suite runs were silently resetting the local dev DB.
- Suite grew 22→30 server tests, 37→43 desktop tests. `npm run check:all` green.

Compat note: already-installed desktop builds (e.g. the packaged DMG) send unauthenticated assist requests and will get 401/403 after the server side deploys; they degrade into the existing failed-receipt path rather than crashing. Updated clients re-auth automatically.

## Key Findings

- **FastAPI version skew**: `server/requirements.txt` pins `fastapi==0.115.0` (HTTPBearer → 403 on missing auth header) but the local venv (`~/.green2blue`) runs 0.135.2 (→ 401). Tests assert `in (401, 403)` for missing-header cases to pass under both. Beware of other pin-vs-venv drift.
- **Open registration is intentional**: `/api/auth/register` is self-serve with arbitrary role/org to keep the demo bootstrap (desktop auto-register, dashboard demo session) working. Documented in ARCHITECTURE.md as a known limitation — auth is an audit/abuse-tracking layer, not a tenant wall. Gating registration would break demo flows; treat as a deliberate future decision.
- **Test DB env trap**: any server test module that imports `app.*` triggers `Settings()` instantiation at collection time; `DATABASE_URL` must be set before that. `tests/conftest.py` handles it now — don't move env setup back into individual test files.
- **Desktop JS is generated**: `desktop/electron/*.js` is gitignored build output of the `.ts` sources (`tsc -p electron/tsconfig.json` at dev/build time). Only edit `.ts`.
- `server/doctor-auditor.db` is a gitignored local artifact created by `.env`-driven runs (and historically by test runs before the conftest fix).
