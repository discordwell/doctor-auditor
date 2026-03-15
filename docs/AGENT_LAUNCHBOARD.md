# Agent Launchboard

## How to use this

This is the repo's ready-to-run launchboard for parallel Codex agents.

Run agents in waves, not ad hoc. Within a wave, packets are designed to avoid file overlap. Do not start the next wave until the gate for the current wave is green.

For named launch prompts, use [NAMED_AGENTS.md](/Users/discordwell/Projects/doctor-auditor/docs/NAMED_AGENTS.md).

This is a live repo, not a blank scaffold exercise. Every agent should inspect the current implementation in its lane before editing and should preserve working code unless the packet explicitly says to replace it.

## Current repo reality

The merged repo already has:

- `desktop/` with Electron, React, local SQLite persistence, import flow, session history, and review UI
- an embedded Python review worker under `desktop/electron/` instead of a top-level `worker/` service
- `server/` with FastAPI routes for auth, approved exports, ops events, demo seed, and assist gateway only
- `dashboard/` with approved-export and ops-boundary views
- `shared/` with review-centric TypeScript contracts
- npm workspaces at the repo root, not `pnpm`

The first wave below is a setup reset. Do not launch feature agents until it is merged.

## Live repo workflow

Recommended operator pattern:

1. fetch the latest `origin/main`
2. create one worktree per named agent branch
3. launch the agent inside that worktree
4. run the lane check in that worktree
5. merge in wave order

If two agents share one checkout, you are manufacturing conflicts for no gain.

## Global gates

### Gate A: setup stable

Required:

- `Surveyor` merged
- `Foundry` merged
- `npm run check:all`
- `docker compose build dashboard server`

### Gate B: feature lanes stable

Required:

- `Miner`, `Pulse`, `Relay`, and `Harbor` merged
- `npm run check:all`

### Gate C: integration stable

Required:

- `Stitch` merged
- `npm run check:all`

Do not merge a wave just because each branch "mostly works" in isolation.

## Wave 0

This wave is serialized. Launch `Surveyor` first, then `Foundry`.

### Packet C0: repo docs and board reset

Branch:

- `codex/contracts-rebaseline-board`

Lane:

- `contracts`

Goal:

- rewrite repo docs to current reality and publish the new wave layout

Allowed files:

- `AGENTS.md`
- `docs/**`
- `PLAN.md`
- `ARCHITECTURE.md`

Forbidden files:

- feature code outside the files above

Required checks:

- `npm run check:all`

Acceptance:

- repo docs describe npm workspaces instead of `pnpm`
- docs describe the embedded Python worker under `desktop/electron/`
- docs describe that desktop import/history/review UI already exists
- docs describe that server owns approved exports, ops events, auth, demo seed, and assist gateway only
- docs make explicit that review-first contracts stay, insurer scoring is downstream, and the server ingests approved exports plus insurer-safe derived features instead of raw session bundles
- the launchboard and named-agent prompts below replace the old wave packets

Prompt:

```text
Lane: contracts
Branch: codex/contracts-rebaseline-board
Goal: Rewrite repo docs to current reality, replace the launchboard, and publish the new parallel work packets.
Allowed files: AGENTS.md, docs/**, PLAN.md, ARCHITECTURE.md
Forbidden files: desktop/**, server/**, dashboard/**, shared/**, package.json, package-lock.json, docker-compose.yml
Required checks: npm run check:all
Acceptance: docs describe npm workspaces, the embedded Python worker, the existing desktop/server/dashboard surfaces, and the new Surveyor/Foundry/Miner/Pulse/Relay/Harbor/Stitch board. Make the architectural decision explicit that review-first contracts stay, insurer scoring is a separate downstream layer, and the cloud server ingests approved exports plus insurer-safe derived features instead of raw session bundles.
Handoff: summarize docs changed, checks run, and any repo facts that still need code changes to match the new board.
```

### Packet C1: build and validation reset

Branch:

- `codex/contracts-build-gates-reset`

Lane:

- `contracts`

Goal:

- repair workspace packaging, server validation gates, and container assumptions so later agents build against the right root contract

Allowed files:

- `package.json`
- `package-lock.json`
- `desktop/package.json`
- `dashboard/package.json`
- `docker-compose.yml`
- `dashboard/Dockerfile`
- `dashboard/nginx.conf`

Forbidden files:

- `desktop/**`
- `server/**`
- `dashboard/src/**`
- `shared/**`
- docs outside comments or tiny build clarifications

Required checks:

- `npm run check:all`
- `docker compose build dashboard server`

Acceptance:

- `desktop/package.json` and `dashboard/package.json` declare `@doctor-auditor/shared`
- dashboard Docker build works from a repo-root-aware context
- `check:server` runs compile plus pytest, not compile-only
- root package metadata uses review-first language
- dead dashboard env/config assumptions are removed from compose/build wiring

Prompt:

```text
Lane: contracts
Branch: codex/contracts-build-gates-reset
Goal: Reset packaging and validation gates so workspace builds, dashboard container builds, and server checks match the current repo architecture.
Allowed files: package.json, package-lock.json, desktop/package.json, dashboard/package.json, docker-compose.yml, dashboard/Dockerfile, dashboard/nginx.conf
Forbidden files: desktop/**, server/**, dashboard/src/**, shared/**, PLAN.md, ARCHITECTURE.md, docs/**
Required checks: npm run check:all && docker compose build dashboard server
Acceptance: shared workspace dependencies are explicit, check:server includes pytest, dashboard builds from a repo-root-aware Docker context, and stale env assumptions are removed.
Handoff: summarize files changed, checks run, and any remaining packaging/build risks.
```

## Wave 1

Start Wave 1 only after Gate A is green.

These four can run in parallel.

### Packet D3: desktop local analysis pipeline

Branch:

- `codex/desktop-local-analysis-pipeline`

Lane:

- `desktop`

Goal:

- add a distinct local transcript-analysis step after transcription and persist findings before review/export can proceed

Allowed files:

- `desktop/electron/**`

Forbidden files:

- `desktop/electron/audio-capture.*`
- `desktop/src/**`
- `server/**`
- `dashboard/**`
- `shared/**`
- `package.json`

Required checks:

- `npm run check:desktop`

Acceptance:

- `transcribe-file` stays focused on transcript segments
- a second local analysis request returns persisted findings backed by the existing shared review contract
- import and live-capture flows persist transcript first and findings second
- session updates fire when findings land
- review/export stays unavailable until findings are persisted
- tests cover import or capture completion through findings persistence and export gating

Prompt:

```text
Lane: desktop
Branch: codex/desktop-local-analysis-pipeline
Goal: Add a distinct local transcript-analysis step after transcription, persist findings after transcript segments land, and keep review/export gated on persisted findings.
Allowed files: desktop/electron/**
Forbidden files: desktop/electron/audio-capture.*, desktop/src/**, server/**, dashboard/**, shared/**, package.json
Required checks: npm run check:desktop
Acceptance: transcribe-file returns transcript segments only, a second local analysis request returns findings, findings are persisted after transcript completion, session updates fire when findings land, and tests cover the gating path.
Handoff: summarize files changed, checks run, and any gaps in the existing shared review contract.
```

### Packet D4: desktop live-capture bounds

Branch:

- `codex/desktop-live-capture-bounds`

Lane:

- `desktop`

Goal:

- make live-capture status, failure handling, and stop behavior deterministic without expanding the feature beyond what the backend supports

Allowed files:

- `desktop/electron/audio-capture.*`
- `desktop/electron/preload.*`
- `desktop/src/views/RecordingView.tsx`
- `desktop/src/views/SettingsView.tsx`
- `desktop/src/types/electron.d.ts`

Forbidden files:

- `desktop/electron/main.*`
- `desktop/electron/database.*`
- `server/**`
- `dashboard/**`
- `shared/**`
- `package.json`

Required checks:

- `npm run check:desktop`

Acceptance:

- live-capture status is deterministic
- failed capture always finalizes local session state cleanly
- import remains the recommended path unless capture is truly stable
- no half-built device-selection UI is added
- tests cover start/stop or failure behavior where practical

Prompt:

```text
Lane: desktop
Branch: codex/desktop-live-capture-bounds
Goal: Make live-capture status, start/stop behavior, and failure handling deterministic while keeping import as the recommended path.
Allowed files: desktop/electron/audio-capture.*, desktop/electron/preload.*, desktop/src/views/RecordingView.tsx, desktop/src/views/SettingsView.tsx, desktop/src/types/electron.d.ts
Forbidden files: desktop/electron/main.*, desktop/electron/database.*, server/**, dashboard/**, shared/**, package.json
Required checks: npm run check:desktop
Acceptance: live capture fails cleanly, start/stop behavior is deterministic, import remains the recommended path unless stability materially improves, and no unsupported device-selection UX is introduced.
Handoff: summarize files changed, checks run, what improved, and what still remains experimental.
```

### Packet S1: server boundary hardening

Branch:

- `codex/server-boundary-hardening`

Lane:

- `server`

Goal:

- harden the approved-export, ops-event, auth, demo-seed, and assist-gateway surfaces against current desktop and dashboard usage

Allowed files:

- `server/**`

Forbidden files:

- `desktop/**`
- `dashboard/**`
- `shared/**`
- `package.json`

Required checks:

- `cd server && pytest -q`
- `npm run check:server`

Acceptance:

- pytest coverage expands around export ingestion, summary math, demo seed idempotence, auth bootstrap, and assist gateway edge cases
- stale generated artifacts are removed or ignored
- raw transcript or audio upload remains rejected
- `sessions` and `findings` routes are not reintroduced
- the cloud boundary remains limited to approved exports plus insurer-safe derived features instead of raw session bundles

Prompt:

```text
Lane: server
Branch: codex/server-boundary-hardening
Goal: Harden the current FastAPI boundary around approved exports, ops events, auth, demo seed, and assist gateway without reopening raw transcript or session APIs.
Allowed files: server/**
Forbidden files: desktop/**, dashboard/**, shared/**, package.json
Required checks: cd server && pytest -q && npm run check:server
Acceptance: server tests cover current desktop/dashboard usage, stale generated artifacts are cleaned up, raw transcript/audio upload remains rejected, removed sessions/findings routes stay removed, and the cloud boundary is limited to approved exports plus insurer-safe derived features instead of raw session bundles.
Handoff: summarize files changed, checks run, boundary behaviors verified, and any remaining server-side risks.
```

### Packet DB1: dashboard ops-boundary polish

Branch:

- `codex/dashboard-ops-boundary-polish`

Lane:

- `dashboard`

Goal:

- remove residual score/risk framing and make dashboard bootstrap failures visible while preserving the cloud-boundary contract

Allowed files:

- `dashboard/**`

Forbidden files:

- `server/**`
- `desktop/**`
- `shared/**`
- `package.json`

Required checks:

- `npm run check:dashboard`

Acceptance:

- residual score/risk framing is removed from dashboard copy and styles
- dead score-centric CSS or status names are deleted or renamed
- demo-auth/bootstrap failures are visible in the UI
- dashboard continues to import only `@doctor-auditor/shared/cloud`
- views stay focused on approved exports, Remote assist ops, redaction blocks, and delivery follow-up

Prompt:

```text
Lane: dashboard
Branch: codex/dashboard-ops-boundary-polish
Goal: Remove residual score/risk framing from the dashboard, surface bootstrap/auth failures clearly, and keep the UI focused on approved exports and safe ops only.
Allowed files: dashboard/**
Forbidden files: server/**, desktop/**, shared/**, package.json
Required checks: npm run check:dashboard
Acceptance: dashboard copy and styling are ops-boundary-first, demo bootstrap failures are visible, dead score-centric names are removed, and the codebase still imports only @doctor-auditor/shared/cloud.
Handoff: summarize files changed, checks run, and any remaining dashboard contract assumptions.
```

## Wave 2

Launch `Stitch` only after Gate B is green.

### Packet I1: integration rebaseline stitch

Branch:

- `codex/integration-rebaseline-stitch`

Lane:

- `contracts`

Goal:

- merge the landed packets, normalize terminology drift, clean remaining generated artifacts, and make the repo coherent again

Allowed files:

- `desktop/**`
- `server/**`
- `dashboard/**`
- `shared/**`
- `AGENTS.md`
- `docs/**`
- `PLAN.md`
- `ARCHITECTURE.md`
- root config files touched by prior packets

Forbidden files:

- `package-lock.json` unless a dependency change is required by the merged work

Required checks:

- `npm run check:all`

Acceptance:

- remaining terminology drift across desktop/server/dashboard/docs is normalized
- the preferred user-facing term is `Remote assist`
- generated artifacts left in tracked paths are cleaned up
- the final launchboard matches what actually landed
- the cloud server remains limited to approved exports plus insurer-safe derived features instead of raw session bundles

Prompt:

```text
Lane: contracts
Branch: codex/integration-rebaseline-stitch
Goal: Merge the landed packets, normalize remaining terminology drift, clean tracked generated artifacts, and make the repo coherent after the rebaseline.
Allowed files: desktop/**, server/**, dashboard/**, shared/**, AGENTS.md, docs/**, PLAN.md, ARCHITECTURE.md, root config files touched by prior packets
Forbidden files: package-lock.json unless a dependency change is required
Required checks: npm run check:all
Acceptance: remaining terminology drift is normalized, Remote assist is the preferred user-facing term, tracked generated artifacts are cleaned up, the final launchboard matches the landed implementation, and the cloud server remains limited to approved exports plus insurer-safe derived features instead of raw session bundles.
Handoff: summarize cross-lane fixes, checks run, and any follow-up packets still needed.
```

## Suggested concurrency

Good parallel set:

- Wave 0: 1 active agent at a time
- Wave 1: 4 active agents
- Wave 2: 1 active agent

That gives you up to 4 active feature agents at once without heavy overlap.

## Stop conditions

Pause the board if any of these happen:

- more than one active branch needs shared contract changes
- a feature agent starts editing repo docs or root build files before Gate A is green
- the two desktop packets start reaching into each other's owned files
- dashboard code starts importing `@doctor-auditor/shared/local-review`
- `npm run check:all` passes locally but `docker compose build dashboard server` fails

## Recommended merge order

Use this order unless there is a strong reason not to:

1. `Surveyor`
2. `Foundry`
3. `Relay`
4. `Miner`
5. `Pulse`
6. `Harbor`
7. `Stitch`

If a later packet needs root-contract changes, stop and spawn a new setup packet instead of folding the change into a feature lane.
