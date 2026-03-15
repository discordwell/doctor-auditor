# Named Agents

## Purpose

This file gives you named Codex agents with exact launch prompts.

Use it with [AGENT_LAUNCHBOARD.md](/Users/discordwell/Projects/doctor-auditor/docs/AGENT_LAUNCHBOARD.md). The launchboard defines the work packets. This file gives those packets stable names you can use when spawning agents.

## How to launch

Copy one prompt block below into a new Codex agent and send it as the first message.

Use the agent's name exactly. That makes it easier to track handoffs and merge order.

This is a live repo with an existing implementation. Each agent prompt below tells the agent to inspect current code first and avoid rebuilding from scratch.

## Live repo setup

Recommended workflow before you launch agents:

1. update `main` from `origin/main`
2. create one worktree per named agent branch
3. launch each agent inside its own worktree

Example pattern:

```bash
git fetch origin
mkdir -p ../doctor-auditor-worktrees
git worktree add ../doctor-auditor-worktrees/surveyor -b codex/contracts-rebaseline-board origin/main
git worktree add ../doctor-auditor-worktrees/foundry -b codex/contracts-build-gates-reset origin/main
git worktree add ../doctor-auditor-worktrees/miner -b codex/desktop-local-analysis-pipeline origin/main
```

Adjust branch names by wave. Do not stack multiple active agents in the same checkout.

## Wave 0

Launch `Surveyor` first. Launch `Foundry` only after `Surveyor` merges.

### Surveyor

Role:

- contracts agent

Owns:

- repo docs and board reset

Branch:

- `codex/contracts-rebaseline-board`

Launch prompt:

```text
You are the "Surveyor" agent. Go.

This is a live repo with existing code. Inspect the merged implementation first. Do not rebuild the scaffold from scratch.

Lane: contracts
Branch: codex/contracts-rebaseline-board
Goal: Rewrite repo docs to current reality, replace the launchboard, and publish the new parallel work packets.
Allowed files: AGENTS.md, docs/**, PLAN.md, ARCHITECTURE.md
Forbidden files: desktop/**, server/**, dashboard/**, shared/**, package.json, package-lock.json, docker-compose.yml
Required checks: npm run check:all
Acceptance: docs describe npm workspaces, the embedded Python worker, the existing desktop/server/dashboard surfaces, and the new Surveyor/Foundry/Miner/Pulse/Relay/Harbor/Stitch board. Make the architectural decision explicit that review-first contracts stay, insurer scoring is a separate downstream layer, and the cloud server ingests approved exports plus insurer-safe derived features instead of raw session bundles.
Handoff: summarize docs changed, checks run, and any repo facts that still need code changes to match the new board.

Read these first:
- /Users/discordwell/Projects/doctor-auditor/AGENTS.md
- /Users/discordwell/Projects/doctor-auditor/docs/MULTI_AGENT_WORKFLOW.md
- /Users/discordwell/Projects/doctor-auditor/docs/AGENT_LAUNCHBOARD.md
```

### Foundry

Role:

- contracts agent

Owns:

- build and validation reset

Branch:

- `codex/contracts-build-gates-reset`

Launch prompt:

```text
You are the "Foundry" agent. Go.

This is a live repo with existing code. Inspect the merged implementation first. Do not rebuild the scaffold from scratch.

Lane: contracts
Branch: codex/contracts-build-gates-reset
Goal: Reset packaging and validation gates so workspace builds, dashboard container builds, and server checks match the current repo architecture.
Allowed files: package.json, package-lock.json, desktop/package.json, dashboard/package.json, docker-compose.yml, dashboard/Dockerfile, dashboard/nginx.conf
Forbidden files: desktop/**, server/**, dashboard/src/**, shared/**, PLAN.md, ARCHITECTURE.md, docs/**
Required checks: npm run check:all && docker compose build dashboard server
Acceptance: shared workspace dependencies are explicit, check:server includes pytest, dashboard builds from a repo-root-aware Docker context, and stale env assumptions are removed.
Handoff: summarize files changed, checks run, and any remaining packaging/build risks.

Read these first:
- /Users/discordwell/Projects/doctor-auditor/AGENTS.md
- /Users/discordwell/Projects/doctor-auditor/docs/MULTI_AGENT_WORKFLOW.md
- /Users/discordwell/Projects/doctor-auditor/docs/AGENT_LAUNCHBOARD.md
```

## Wave 1

Launch these only after Gate A is green.

These four can run in parallel.

### Miner

Role:

- desktop agent

Owns:

- local transcript-analysis pipeline

Branch:

- `codex/desktop-local-analysis-pipeline`

Launch prompt:

```text
You are the "Miner" agent. Go.

This is a live repo with existing code. Inspect the current desktop implementation first. Do not rebuild the scaffold from scratch.

Lane: desktop
Branch: codex/desktop-local-analysis-pipeline
Goal: Add a distinct local transcript-analysis step after transcription, persist findings after transcript segments land, and keep review/export gated on persisted findings.
Allowed files: desktop/electron/**
Forbidden files: desktop/electron/audio-capture.*, desktop/src/**, server/**, dashboard/**, shared/**, package.json
Required checks: npm run check:desktop
Acceptance: transcribe-file returns transcript segments only, a second local analysis request returns findings, findings are persisted after transcript completion, session updates fire when findings land, and tests cover the gating path.
Handoff: summarize files changed, checks run, and any gaps in the existing shared review contract.

Read these first:
- /Users/discordwell/Projects/doctor-auditor/AGENTS.md
- /Users/discordwell/Projects/doctor-auditor/docs/MULTI_AGENT_WORKFLOW.md
- /Users/discordwell/Projects/doctor-auditor/docs/AGENT_LAUNCHBOARD.md
```

### Pulse

Role:

- desktop agent

Owns:

- live-capture bounds

Branch:

- `codex/desktop-live-capture-bounds`

Launch prompt:

```text
You are the "Pulse" agent. Go.

This is a live repo with existing code. Inspect the current desktop implementation first. Do not rebuild the scaffold from scratch.

Lane: desktop
Branch: codex/desktop-live-capture-bounds
Goal: Make live-capture status, start/stop behavior, and failure handling deterministic while keeping import as the recommended path.
Allowed files: desktop/electron/audio-capture.*, desktop/electron/preload.*, desktop/src/views/RecordingView.tsx, desktop/src/views/SettingsView.tsx, desktop/src/types/electron.d.ts
Forbidden files: desktop/electron/main.*, desktop/electron/database.*, server/**, dashboard/**, shared/**, package.json
Required checks: npm run check:desktop
Acceptance: live capture fails cleanly, start/stop behavior is deterministic, import remains the recommended path unless stability materially improves, and no unsupported device-selection UX is introduced.
Handoff: summarize files changed, checks run, what improved, and what still remains experimental.

Read these first:
- /Users/discordwell/Projects/doctor-auditor/AGENTS.md
- /Users/discordwell/Projects/doctor-auditor/docs/MULTI_AGENT_WORKFLOW.md
- /Users/discordwell/Projects/doctor-auditor/docs/AGENT_LAUNCHBOARD.md
```

### Relay

Role:

- server agent

Owns:

- server boundary hardening

Branch:

- `codex/server-boundary-hardening`

Launch prompt:

```text
You are the "Relay" agent. Go.

This is a live repo with existing code. Inspect the current server implementation first. Do not rebuild the scaffold from scratch.

Lane: server
Branch: codex/server-boundary-hardening
Goal: Harden the current FastAPI boundary around approved exports, ops events, auth, demo seed, and assist gateway without reopening raw transcript or session APIs.
Allowed files: server/**
Forbidden files: desktop/**, dashboard/**, shared/**, package.json
Required checks: cd server && pytest -q && npm run check:server
Acceptance: server tests cover current desktop/dashboard usage, stale generated artifacts are cleaned up, raw transcript/audio upload remains rejected, removed sessions/findings routes stay removed, and the cloud boundary is limited to approved exports plus insurer-safe derived features instead of raw session bundles.
Handoff: summarize files changed, checks run, boundary behaviors verified, and any remaining server-side risks.

Read these first:
- /Users/discordwell/Projects/doctor-auditor/AGENTS.md
- /Users/discordwell/Projects/doctor-auditor/docs/MULTI_AGENT_WORKFLOW.md
- /Users/discordwell/Projects/doctor-auditor/docs/AGENT_LAUNCHBOARD.md
```

### Harbor

Role:

- dashboard agent

Owns:

- ops-boundary polish

Branch:

- `codex/dashboard-ops-boundary-polish`

Launch prompt:

```text
You are the "Harbor" agent. Go.

This is a live repo with existing code. Inspect the current dashboard implementation first. Do not rebuild the scaffold from scratch.

Lane: dashboard
Branch: codex/dashboard-ops-boundary-polish
Goal: Remove residual score/risk framing from the dashboard, surface bootstrap/auth failures clearly, and keep the UI focused on approved exports and safe ops only.
Allowed files: dashboard/**
Forbidden files: server/**, desktop/**, shared/**, package.json
Required checks: npm run check:dashboard
Acceptance: dashboard copy and styling are ops-boundary-first, demo bootstrap failures are visible, dead score-centric names are removed, and the codebase still imports only @doctor-auditor/shared/cloud.
Handoff: summarize files changed, checks run, and any remaining dashboard contract assumptions.

Read these first:
- /Users/discordwell/Projects/doctor-auditor/AGENTS.md
- /Users/discordwell/Projects/doctor-auditor/docs/MULTI_AGENT_WORKFLOW.md
- /Users/discordwell/Projects/doctor-auditor/docs/AGENT_LAUNCHBOARD.md
```

## Wave 2

Launch `Stitch` only after Gate B is green.

### Stitch

Role:

- integration agent

Owns:

- cross-lane integration cleanup and coherence

Branch:

- `codex/integration-rebaseline-stitch`

Launch prompt:

```text
You are the "Stitch" agent. Go.

This is a live repo with existing code. Inspect the merged implementation first. Do not rebuild the scaffold from scratch.

Lane: contracts
Branch: codex/integration-rebaseline-stitch
Goal: Merge the landed packets, normalize remaining terminology drift, clean tracked generated artifacts, and make the repo coherent after the rebaseline.
Allowed files: desktop/**, server/**, dashboard/**, shared/**, AGENTS.md, docs/**, PLAN.md, ARCHITECTURE.md, root config files touched by prior packets
Forbidden files: package-lock.json unless a dependency change is required
Required checks: npm run check:all
Acceptance: remaining terminology drift is normalized, Remote assist is the preferred user-facing term, tracked generated artifacts are cleaned up, the final launchboard matches the landed implementation, and the cloud server remains limited to approved exports plus insurer-safe derived features instead of raw session bundles.
Handoff: summarize cross-lane fixes, checks run, and any follow-up packets still needed.

Read these first:
- /Users/discordwell/Projects/doctor-auditor/AGENTS.md
- /Users/discordwell/Projects/doctor-auditor/docs/MULTI_AGENT_WORKFLOW.md
- /Users/discordwell/Projects/doctor-auditor/docs/AGENT_LAUNCHBOARD.md
```

## Short name list

Use these names when launching or tracking branches:

- `Surveyor`
- `Foundry`
- `Miner`
- `Pulse`
- `Relay`
- `Harbor`
- `Stitch`

## Safe launch sets

Start here:

- Wave 0: `Surveyor`

Then:

- Wave 0: `Foundry`

Then:

- Wave 1: `Miner`, `Pulse`, `Relay`, `Harbor`

Finish with:

- Wave 2: `Stitch`
