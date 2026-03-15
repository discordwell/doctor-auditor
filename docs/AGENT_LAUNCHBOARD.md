# Agent Launchboard

## How to use this

This is the repo's ready-to-run launchboard for parallel Codex agents.

Run agents in waves, not all-at-once chaos. Within a wave, packets are designed to avoid file overlap. Do not start the next wave until the gate for the current wave is green.

For named launch prompts, use [NAMED_AGENTS.md](/Users/discordwell/Projects/doctor-auditor/docs/NAMED_AGENTS.md).

This is a live repo, not a blank scaffold exercise. Every agent should inspect the current implementation in its lane before editing and should preserve working code unless the packet explicitly says to replace it.

## Current repo reality

The scaffold currently has:

- `desktop/` for Electron + React
- `server/` for FastAPI
- `dashboard/` for React
- `shared/` for shared TypeScript types

It does not yet have a Python worker service or stable evaluation fixtures. The first packets below are shaped around the current scaffold, not the ideal future architecture.

## Live repo workflow

Recommended operator pattern:

1. fetch the latest `origin/main`
2. create one worktree per named agent branch
3. launch the agent inside that worktree
4. run the lane check in that worktree
5. merge in wave order

If two agents share one checkout, you are manufacturing conflicts for no gain.

## Global gates

### Gate A: contracts stable

Required:

- contract packet merged
- `npm run check:shared`
- `npm run check:contracts`

### Gate B: feature lanes stable

Required:

- all active wave packets merged
- `npm run check:desktop`
- `npm run check:dashboard`
- `npm run check:server`

### Gate C: integration stable

Required:

- integration packet merged
- `npm run check:all`

Do not merge a wave just because each branch "mostly works" in isolation.

## Wave 0

This wave is serialized. Only one contracts-oriented agent should run here.

### Packet C0: shared domain reset

Branch:

- `codex/contracts-shared-domain-reset`

Lane:

- `contracts`

Goal:

- replace the current score-heavy shared model with an auditable review model that future desktop, server, and dashboard agents can build against

Allowed files:

- `shared/**`
- `ARCHITECTURE.md`
- `PLAN.md`

Forbidden files:

- `desktop/**`
- `server/**`
- `dashboard/**`
- `package.json`

Required checks:

- `npm run check:shared`
- `npm run check:contracts`

Acceptance:

- shared types support sessions, transcript segments, findings, evidence spans, review decisions, and approved export payloads
- risky terms like malpractice ranking or impairment inference are removed from shared contracts
- docs reflect the new contract surface

Prompt:

```text
Lane: contracts
Goal: Replace the current score-centric shared model with an auditable review model for sessions, transcript segments, findings, evidence, review decisions, and approved exports.
Allowed files: shared/**, ARCHITECTURE.md, PLAN.md
Forbidden files: desktop/**, server/**, dashboard/**, package.json
Required checks: npm run check:shared && npm run check:contracts
Acceptance: shared types are aligned to evidence-backed review workflows and no longer force malpractice-risk ranking semantics into downstream lanes.
Handoff: summarize changed contracts, docs updated, checks run, and any migration impacts on desktop/server/dashboard.
```

## Wave 1

Start Wave 1 only after Wave 0 is merged.

### Packet S1: server review API skeleton

Branch:

- `codex/server-review-api-skeleton`

Lane:

- `server`

Goal:

- replace or supplement the current risk-oriented API with review-oriented endpoints and schemas that match the new shared contract

Allowed files:

- `server/**`

Forbidden files:

- `shared/**`
- `desktop/**`
- `dashboard/**`
- `package.json`

Required checks:

- `npm run check:server`

Acceptance:

- server exposes health plus clear placeholder endpoints for sessions, findings, and approved exports
- Pydantic schemas match the new contract direction
- routes are internally consistent even if persistence is still mocked

Prompt:

```text
Lane: server
Goal: Refactor the FastAPI surface toward review-oriented endpoints for sessions, findings, and approved exports using the new shared contract.
Allowed files: server/**
Forbidden files: shared/**, desktop/**, dashboard/**, package.json
Required checks: npm run check:server
Acceptance: FastAPI routes and server schemas are coherent, compile cleanly, and no longer assume malpractice ranking as the only output.
Handoff: summarize endpoints added or changed, schemas used, checks run, and any contract gaps discovered.
```

### Packet D1: desktop import-first recording flow

Branch:

- `codex/desktop-import-first-flow`

Lane:

- `desktop`

Goal:

- make the desktop app useful without live capture by supporting upload-first encounter ingestion and basic session creation UI

Allowed files:

- `desktop/**`

Forbidden files:

- `shared/**`
- `server/**`
- `dashboard/**`
- `package.json`

Required checks:

- `npm run check:desktop`

Acceptance:

- user can choose a local audio file from the desktop app
- UI shows import status and creates a local session shell
- feature works without any server dependency

Prompt:

```text
Lane: desktop
Goal: Add an upload-first encounter import flow so the desktop app is useful even before live capture is production-ready.
Allowed files: desktop/**
Forbidden files: shared/**, server/**, dashboard/**, package.json
Required checks: npm run check:desktop
Acceptance: a user can select a local audio file, see import progress or status, and create a local session shell from the desktop UI.
Handoff: summarize files changed, checks run, and any schema assumptions that need contract review.
```

### Packet D2: desktop session history shell

Branch:

- `codex/desktop-session-history-shell`

Lane:

- `desktop`

Goal:

- make the history view useful with local session cards, filter state, and a clean empty state

Allowed files:

- `desktop/**`

Forbidden files:

- `shared/**`
- `server/**`
- `dashboard/**`
- `package.json`

Required checks:

- `npm run check:desktop`

Acceptance:

- history view renders a local session list with stable mock or local-db-backed data
- empty/loading/error states exist
- no overlap with import flow files if possible

Prompt:

```text
Lane: desktop
Goal: Build out the local session history view with useful states and session cards for encounter review.
Allowed files: desktop/**
Forbidden files: shared/**, server/**, dashboard/**, package.json
Required checks: npm run check:desktop
Acceptance: history view shows a local session list with clean empty/loading/error states and is ready for later transcript drill-down.
Handoff: summarize files changed, checks run, and any dependencies on session contract fields.
```

### Packet DB1: dashboard review overview shell

Branch:

- `codex/dashboard-review-overview-shell`

Lane:

- `dashboard`

Goal:

- reshape the dashboard away from raw risk ranking and toward review/export activity, flagged findings, and session throughput

Allowed files:

- `dashboard/**`

Forbidden files:

- `shared/**`
- `server/**`
- `desktop/**`
- `package.json`

Required checks:

- `npm run check:dashboard`

Acceptance:

- overview page uses placeholder review-oriented metrics
- UI does not hard-code malpractice ranking language everywhere
- page structure is ready for later API wiring

Prompt:

```text
Lane: dashboard
Goal: Reframe the overview dashboard around review activity, flagged findings, and approved exports instead of pure malpractice scoring.
Allowed files: dashboard/**
Forbidden files: shared/**, server/**, desktop/**, package.json
Required checks: npm run check:dashboard
Acceptance: the overview view is coherent with a review-tool story and is ready to consume API data later.
Handoff: summarize files changed, checks run, and any hard-coded assumptions that still need contract cleanup.
```

## Wave 2

Start Wave 2 only after Wave 1 is merged and Gate B is green.

### Packet D3: desktop transcript and evidence viewer

Branch:

- `codex/desktop-transcript-evidence-viewer`

Lane:

- `desktop`

Goal:

- add a transcript drill-down UI with evidence-linked findings and reviewer actions

Allowed files:

- `desktop/**`

Forbidden files:

- `shared/**`
- `server/**`
- `dashboard/**`
- `package.json`

Required checks:

- `npm run check:desktop`

Acceptance:

- transcript segments render with timestamps
- findings can highlight linked evidence spans
- reviewer can accept, reject, or mark uncertain in UI state

Prompt:

```text
Lane: desktop
Goal: Build a transcript drill-down view with evidence-linked findings and reviewer actions.
Allowed files: desktop/**
Forbidden files: shared/**, server/**, dashboard/**, package.json
Required checks: npm run check:desktop
Acceptance: transcript segments, evidence links, and accept/reject/uncertain review controls all exist in the desktop UI.
Handoff: summarize files changed, checks run, and any assumptions about finding or evidence data shapes.
```

### Packet S2: server approved-export flow

Branch:

- `codex/server-approved-export-flow`

Lane:

- `server`

Goal:

- implement the reviewed export path and keep the server surface clearly limited to approved export payloads

Allowed files:

- `server/**`

Forbidden files:

- `shared/**`
- `desktop/**`
- `dashboard/**`
- `package.json`

Required checks:

- `npm run check:server`

Acceptance:

- server has an explicit approved-export ingestion path
- raw transcript or raw audio fields are not accepted by those schemas
- persistence may remain simple, but the boundary is explicit

Prompt:

```text
Lane: server
Goal: Add the approved-export ingestion path and keep the server boundary explicitly limited to reviewed export payloads.
Allowed files: server/**
Forbidden files: shared/**, desktop/**, dashboard/**, package.json
Required checks: npm run check:server
Acceptance: the server accepts approved export payloads only and rejects shapes that imply raw transcript or audio upload.
Handoff: summarize endpoint behavior, schema boundaries, checks run, and any contract risks discovered.
```

### Packet DB2: dashboard API integration

Branch:

- `codex/dashboard-api-integration`

Lane:

- `dashboard`

Goal:

- wire the overview and assessments views to the server API shape, with local fallback fixtures if the API is incomplete

Allowed files:

- `dashboard/**`

Forbidden files:

- `shared/**`
- `server/**`
- `desktop/**`
- `package.json`

Required checks:

- `npm run check:dashboard`

Acceptance:

- dashboard API client matches the current server contract
- views can render fetched or mocked review-oriented data
- loading and failure states exist

Prompt:

```text
Lane: dashboard
Goal: Wire dashboard views to the current server API shape, using local fixtures only as a fallback for incomplete endpoints.
Allowed files: dashboard/**
Forbidden files: shared/**, server/**, desktop/**, package.json
Required checks: npm run check:dashboard
Acceptance: dashboard API integration is coherent, views handle loading and failure states, and the UI reflects review-oriented data instead of hard-coded scores.
Handoff: summarize files changed, checks run, and any contract mismatches found.
```

### Packet D4: desktop live-capture stabilization spike

Branch:

- `codex/desktop-live-capture-spike`

Lane:

- `desktop`

Goal:

- isolate live microphone capture problems without blocking the import-first path

Allowed files:

- `desktop/**`

Forbidden files:

- `shared/**`
- `server/**`
- `dashboard/**`
- `package.json`

Required checks:

- `npm run check:desktop`

Acceptance:

- document current live-capture behavior and failure modes
- improve device selection, start/stop handling, or recorder stability if possible
- if stability is still weak, leave the feature clearly marked as experimental

Prompt:

```text
Lane: desktop
Goal: Stabilize or clearly bound the live microphone capture path without blocking the upload-first workflow.
Allowed files: desktop/**
Forbidden files: shared/**, server/**, dashboard/**, package.json
Required checks: npm run check:desktop
Acceptance: live capture behavior is either improved or explicitly bounded as experimental with visible failure handling.
Handoff: summarize what improved, what still fails, checks run, and whether the feature is demo-path ready or experimental only.
```

## Wave 3

Start Wave 3 only after Wave 2 is merged and Gate B is green again.

### Packet I1: integration and drift cleanup

Branch:

- `codex/integration-wave-cleanup`

Lane:

- `contracts`

Goal:

- clean up drift across lanes, normalize terminology, and ensure the repo passes full validation

Allowed files:

- `desktop/**`
- `server/**`
- `dashboard/**`
- `shared/**`
- root workflow docs

Forbidden files:

- `package-lock.json` unless dependency changes are intentional

Required checks:

- `npm run check:all`

Acceptance:

- cross-lane terminology is consistent
- stale score-centric naming is reduced where practical
- aggregate validation passes

Prompt:

```text
Lane: contracts
Goal: Perform cross-lane integration cleanup after the feature waves land, resolve terminology drift, and make the repo coherent.
Allowed files: desktop/**, server/**, dashboard/**, shared/**, AGENTS.md, docs/**, ARCHITECTURE.md, PLAN.md
Forbidden files: package-lock.json unless a dependency change is required
Required checks: npm run check:all
Acceptance: the merged repo is coherent, naming drift is reduced, and aggregate validation is green.
Handoff: summarize cross-lane fixes, checks run, remaining risks, and any follow-up packets still needed.
```

## Suggested concurrency

Good parallel set:

- Wave 0: 1 agent
- Wave 1: 4 agents
- Wave 2: 4 agents
- Wave 3: 1 agent

That gives you up to 4 active feature agents at once without heavy overlap.

## Stop conditions

Pause the board if any of these happen:

- more than one active branch needs `shared/**` changes
- lane checks are green but `npm run check:all` fails on merge
- two desktop packets are fighting over the same view files
- agents start making speculative contract edits instead of requesting them

## Recommended merge order inside each wave

1. server packets
2. desktop packets
3. dashboard packets
4. integration cleanup if needed

If a dashboard packet depends on server shapes, merge the server branch first and rebase the dashboard branch before landing it.
