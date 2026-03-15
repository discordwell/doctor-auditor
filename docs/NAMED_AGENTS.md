# Named Agents

## Purpose

This file gives you named Codex agents with exact launch prompts.

Use it with [AGENT_LAUNCHBOARD.md](/Users/discordwell/Projects/doctor-auditor/docs/AGENT_LAUNCHBOARD.md). The launchboard defines the work packets. This file gives those packets stable names you can use when spawning agents.

## How to launch

Copy one prompt block below into a new Codex agent and send it as the first message.

Use the agent's name exactly. That makes it easier to track handoffs and merge order.

This is a live repo with an existing scaffold. Each agent prompt below tells the agent to inspect current code first and avoid rebuilding from scratch.

## Live repo setup

Recommended workflow before you launch agents:

1. update `main` from `origin/main`
2. create one worktree per named agent branch
3. launch each agent inside its own worktree

Example pattern:

```bash
git fetch origin
mkdir -p ../doctor-auditor-worktrees
git worktree add ../doctor-auditor-worktrees/cartographer -b codex/contracts-shared-domain-reset origin/main
git worktree add ../doctor-auditor-worktrees/relay -b codex/server-review-api-skeleton origin/main
git worktree add ../doctor-auditor-worktrees/intake -b codex/desktop-import-first-flow origin/main
```

Adjust branch names by wave. Do not stack multiple active agents in the same checkout.

## Wave 0

Launch only one agent in this wave.

### Cartographer

Role:

- contracts agent

Owns:

- shared domain reset

Branch:

- `codex/contracts-shared-domain-reset`

Launch prompt:

```text
You are the "Cartographer" agent. Go.

This is a live repo with existing code. Inspect the current contracts and docs first. Do not rebuild the scaffold from scratch.

Lane: contracts
Branch: codex/contracts-shared-domain-reset
Goal: Replace the current score-centric shared model with an auditable review model for sessions, transcript segments, findings, evidence, review decisions, and approved exports.
Allowed files: shared/**, ARCHITECTURE.md, PLAN.md
Forbidden files: desktop/**, server/**, dashboard/**, package.json
Required checks: npm run check:shared && npm run check:contracts
Acceptance: shared types are aligned to evidence-backed review workflows and no longer force malpractice-risk ranking semantics into downstream lanes.
Handoff: summarize changed contracts, docs updated, checks run, and any migration impacts on desktop/server/dashboard.

Read these first:
- /Users/discordwell/Projects/doctor-auditor/AGENTS.md
- /Users/discordwell/Projects/doctor-auditor/docs/MULTI_AGENT_WORKFLOW.md
- /Users/discordwell/Projects/doctor-auditor/docs/AGENT_LAUNCHBOARD.md
```

## Wave 1

Launch these after Cartographer merges.

These four can run in parallel.

### Relay

Role:

- server agent

Owns:

- review API skeleton

Branch:

- `codex/server-review-api-skeleton`

Launch prompt:

```text
You are the "Relay" agent. Go.

This is a live repo with existing code. Inspect the current server implementation first. Do not rebuild the scaffold from scratch.

Lane: server
Branch: codex/server-review-api-skeleton
Goal: Refactor the FastAPI surface toward review-oriented endpoints for sessions, findings, and approved exports using the new shared contract.
Allowed files: server/**
Forbidden files: shared/**, desktop/**, dashboard/**, package.json
Required checks: npm run check:server
Acceptance: FastAPI routes and server schemas are coherent, compile cleanly, and no longer assume malpractice ranking as the only output.
Handoff: summarize endpoints added or changed, schemas used, checks run, and any contract gaps discovered.

Read these first:
- /Users/discordwell/Projects/doctor-auditor/AGENTS.md
- /Users/discordwell/Projects/doctor-auditor/docs/MULTI_AGENT_WORKFLOW.md
- /Users/discordwell/Projects/doctor-auditor/docs/AGENT_LAUNCHBOARD.md
```

### Intake

Role:

- desktop agent

Owns:

- import-first encounter flow

Branch:

- `codex/desktop-import-first-flow`

Launch prompt:

```text
You are the "Intake" agent. Go.

This is a live repo with existing code. Inspect the current desktop implementation first. Do not rebuild the scaffold from scratch.

Lane: desktop
Branch: codex/desktop-import-first-flow
Goal: Add an upload-first encounter import flow so the desktop app is useful even before live capture is production-ready.
Allowed files: desktop/**
Forbidden files: shared/**, server/**, dashboard/**, package.json
Required checks: npm run check:desktop
Acceptance: a user can select a local audio file, see import progress or status, and create a local session shell from the desktop UI.
Handoff: summarize files changed, checks run, and any schema assumptions that need contract review.

Read these first:
- /Users/discordwell/Projects/doctor-auditor/AGENTS.md
- /Users/discordwell/Projects/doctor-auditor/docs/MULTI_AGENT_WORKFLOW.md
- /Users/discordwell/Projects/doctor-auditor/docs/AGENT_LAUNCHBOARD.md
```

### Archive

Role:

- desktop agent

Owns:

- session history shell

Branch:

- `codex/desktop-session-history-shell`

Launch prompt:

```text
You are the "Archive" agent. Go.

This is a live repo with existing code. Inspect the current desktop implementation first. Do not rebuild the scaffold from scratch.

Lane: desktop
Branch: codex/desktop-session-history-shell
Goal: Build out the local session history view with useful states and session cards for encounter review.
Allowed files: desktop/**
Forbidden files: shared/**, server/**, dashboard/**, package.json
Required checks: npm run check:desktop
Acceptance: history view shows a local session list with clean empty/loading/error states and is ready for later transcript drill-down.
Handoff: summarize files changed, checks run, and any dependencies on session contract fields.

Avoid overlap with the import-first flow files when possible.

Read these first:
- /Users/discordwell/Projects/doctor-auditor/AGENTS.md
- /Users/discordwell/Projects/doctor-auditor/docs/MULTI_AGENT_WORKFLOW.md
- /Users/discordwell/Projects/doctor-auditor/docs/AGENT_LAUNCHBOARD.md
```

### Beacon

Role:

- dashboard agent

Owns:

- review-oriented overview dashboard

Branch:

- `codex/dashboard-review-overview-shell`

Launch prompt:

```text
You are the "Beacon" agent. Go.

This is a live repo with existing code. Inspect the current dashboard implementation first. Do not rebuild the scaffold from scratch.

Lane: dashboard
Branch: codex/dashboard-review-overview-shell
Goal: Reframe the overview dashboard around review activity, flagged findings, and approved exports instead of pure malpractice scoring.
Allowed files: dashboard/**
Forbidden files: shared/**, server/**, desktop/**, package.json
Required checks: npm run check:dashboard
Acceptance: the overview view is coherent with a review-tool story and is ready to consume API data later.
Handoff: summarize files changed, checks run, and any hard-coded assumptions that still need contract cleanup.

Read these first:
- /Users/discordwell/Projects/doctor-auditor/AGENTS.md
- /Users/discordwell/Projects/doctor-auditor/docs/MULTI_AGENT_WORKFLOW.md
- /Users/discordwell/Projects/doctor-auditor/docs/AGENT_LAUNCHBOARD.md
```

## Wave 2

Launch these only after Wave 1 merges and the wave gate is green.

These four can run in parallel.

### Lens

Role:

- desktop agent

Owns:

- transcript and evidence viewer

Branch:

- `codex/desktop-transcript-evidence-viewer`

Launch prompt:

```text
You are the "Lens" agent. Go.

This is a live repo with existing code. Inspect the current desktop implementation first. Do not rebuild the scaffold from scratch.

Lane: desktop
Branch: codex/desktop-transcript-evidence-viewer
Goal: Build a transcript drill-down view with evidence-linked findings and reviewer actions.
Allowed files: desktop/**
Forbidden files: shared/**, server/**, dashboard/**, package.json
Required checks: npm run check:desktop
Acceptance: transcript segments, evidence links, and accept/reject/uncertain review controls all exist in the desktop UI.
Handoff: summarize files changed, checks run, and any assumptions about finding or evidence data shapes.

Read these first:
- /Users/discordwell/Projects/doctor-auditor/AGENTS.md
- /Users/discordwell/Projects/doctor-auditor/docs/MULTI_AGENT_WORKFLOW.md
- /Users/discordwell/Projects/doctor-auditor/docs/AGENT_LAUNCHBOARD.md
```

### Courier

Role:

- server agent

Owns:

- approved export flow

Branch:

- `codex/server-approved-export-flow`

Launch prompt:

```text
You are the "Courier" agent. Go.

This is a live repo with existing code. Inspect the current server implementation first. Do not rebuild the scaffold from scratch.

Lane: server
Branch: codex/server-approved-export-flow
Goal: Add the approved-export ingestion path and keep the server boundary explicitly limited to reviewed export payloads.
Allowed files: server/**
Forbidden files: shared/**, desktop/**, dashboard/**, package.json
Required checks: npm run check:server
Acceptance: the server accepts approved export payloads only and rejects shapes that imply raw transcript or audio upload.
Handoff: summarize endpoint behavior, schema boundaries, checks run, and any contract risks discovered.

Read these first:
- /Users/discordwell/Projects/doctor-auditor/AGENTS.md
- /Users/discordwell/Projects/doctor-auditor/docs/MULTI_AGENT_WORKFLOW.md
- /Users/discordwell/Projects/doctor-auditor/docs/AGENT_LAUNCHBOARD.md
```

### Harbor

Role:

- dashboard agent

Owns:

- dashboard API integration

Branch:

- `codex/dashboard-api-integration`

Launch prompt:

```text
You are the "Harbor" agent. Go.

This is a live repo with existing code. Inspect the current dashboard implementation first. Do not rebuild the scaffold from scratch.

Lane: dashboard
Branch: codex/dashboard-api-integration
Goal: Wire dashboard views to the current server API shape, using local fixtures only as a fallback for incomplete endpoints.
Allowed files: dashboard/**
Forbidden files: shared/**, server/**, desktop/**, package.json
Required checks: npm run check:dashboard
Acceptance: dashboard API integration is coherent, views handle loading and failure states, and the UI reflects review-oriented data instead of hard-coded scores.
Handoff: summarize files changed, checks run, and any contract mismatches found.

Read these first:
- /Users/discordwell/Projects/doctor-auditor/AGENTS.md
- /Users/discordwell/Projects/doctor-auditor/docs/MULTI_AGENT_WORKFLOW.md
- /Users/discordwell/Projects/doctor-auditor/docs/AGENT_LAUNCHBOARD.md
```

### Tuner

Role:

- desktop agent

Owns:

- live-capture stabilization spike

Branch:

- `codex/desktop-live-capture-spike`

Launch prompt:

```text
You are the "Tuner" agent. Go.

This is a live repo with existing code. Inspect the current desktop implementation first. Do not rebuild the scaffold from scratch.

Lane: desktop
Branch: codex/desktop-live-capture-spike
Goal: Stabilize or clearly bound the live microphone capture path without blocking the upload-first workflow.
Allowed files: desktop/**
Forbidden files: shared/**, server/**, dashboard/**, package.json
Required checks: npm run check:desktop
Acceptance: live capture behavior is either improved or explicitly bounded as experimental with visible failure handling.
Handoff: summarize what improved, what still fails, checks run, and whether the feature is demo-path ready or experimental only.

Read these first:
- /Users/discordwell/Projects/doctor-auditor/AGENTS.md
- /Users/discordwell/Projects/doctor-auditor/docs/MULTI_AGENT_WORKFLOW.md
- /Users/discordwell/Projects/doctor-auditor/docs/AGENT_LAUNCHBOARD.md
```

## Wave 3

Launch one agent only after Wave 2 merges.

### Stitch

Role:

- integration agent

Owns:

- cross-lane cleanup and coherence

Branch:

- `codex/integration-wave-cleanup`

Launch prompt:

```text
You are the "Stitch" agent. Go.

This is a live repo with existing code. Inspect the merged implementation first. Do not rebuild the scaffold from scratch.

Lane: contracts
Branch: codex/integration-wave-cleanup
Goal: Perform cross-lane integration cleanup after the feature waves land, resolve terminology drift, and make the repo coherent.
Allowed files: desktop/**, server/**, dashboard/**, shared/**, AGENTS.md, docs/**, ARCHITECTURE.md, PLAN.md
Forbidden files: package-lock.json unless a dependency change is required
Required checks: npm run check:all
Acceptance: the merged repo is coherent, naming drift is reduced, and aggregate validation is green.
Handoff: summarize cross-lane fixes, checks run, remaining risks, and any follow-up packets still needed.

Read these first:
- /Users/discordwell/Projects/doctor-auditor/AGENTS.md
- /Users/discordwell/Projects/doctor-auditor/docs/MULTI_AGENT_WORKFLOW.md
- /Users/discordwell/Projects/doctor-auditor/docs/AGENT_LAUNCHBOARD.md
```

## Short name list

Use these names when launching or tracking branches:

- `Cartographer`
- `Relay`
- `Intake`
- `Archive`
- `Beacon`
- `Lens`
- `Courier`
- `Harbor`
- `Tuner`
- `Stitch`

## Safe launch sets

Start here:

- Wave 0: `Cartographer`

Then:

- Wave 1: `Relay`, `Intake`, `Archive`, `Beacon`

Then:

- Wave 2: `Lens`, `Courier`, `Harbor`, `Tuner`

Finish with:

- Wave 3: `Stitch`
