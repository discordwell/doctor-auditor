# Multi-Agent Workflow

## Goal

Exploit parallel agents without turning the repo into merge-conflict soup.

The workflow is:

1. reset shared docs and root build assumptions,
2. assign isolated lanes,
3. run lane-local checks,
4. merge in a controlled order,
5. promote only green work into the main demo path.

For ready-to-run task packets, use [AGENT_LAUNCHBOARD.md](/Users/discordwell/Projects/doctor-auditor/docs/AGENT_LAUNCHBOARD.md).

## Recommended roles

### Contracts and setup agent

Owns:

- `shared/**` when a real contract change is unavoidable
- repo-level scripts
- `PLAN.md`
- `ARCHITECTURE.md`
- workflow docs
- root packaging and compose wiring

Responsibilities:

- publish lane boundaries
- keep root scripts usable
- document the current architecture accurately
- make workspace and validation gates coherent

This role is serialized by design. Do not parallelize it casually.

### Desktop agent

Owns:

- `desktop/electron/**`
- `desktop/src/**`

Responsibilities:

- local import and live-capture workflows
- transcript and finding persistence
- review UI and Electron integration

### Dashboard agent

Owns:

- `dashboard/**`

Responsibilities:

- approved export and ops views
- boundary-safe API client integration
- bootstrap and failure-state visibility

### Server agent

Owns:

- `server/**`

Responsibilities:

- auth
- approved export ingestion
- ops events
- Remote assist gateway
- demo seed behavior
- persistence and tests

### Integration agent

Owns:

- cross-lane rebases
- final validation
- drift cleanup

Responsibilities:

- resolve conflicts after lane work lands
- run aggregate checks
- normalize terminology after merges
- reject work that bypasses gates

## Lane boundaries

### Hard boundaries

These files should not be edited by feature agents unless the task explicitly calls for it:

- `shared/**`
- `package.json`
- `package-lock.json`
- `docker-compose.yml`
- `ARCHITECTURE.md`
- `PLAN.md`
- `AGENTS.md`
- `docs/**`

### Soft boundaries

These can be edited by other lanes only when the owning lane is idle:

- `desktop/electron/main.ts`
- `desktop/src/views/RecordingView.tsx`
- `dashboard/src/services/api.ts`
- `server/app/main.py`

Those are integration hotspots. Expect conflicts.

## Task packet template

When you spin up an agent, give it a packet with:

- lane
- branch
- goal
- allowed files
- forbidden files
- required checks
- acceptance criteria
- output format for the handoff

Example packet:

```text
Lane: desktop
Branch: codex/desktop-local-analysis-pipeline
Goal: Add a distinct local transcript-analysis step after transcription and persist findings before review/export can proceed.
Allowed files: desktop/electron/**
Forbidden files: desktop/electron/audio-capture.*, desktop/src/**, server/**, dashboard/**, shared/**, package.json
Required checks: npm run check:desktop
Acceptance: transcript segments persist first, findings persist second, and review/export stays gated until findings exist.
Handoff: summarize files changed, checks run, and any schema requests.
```

## Merge order

Use this order unless there is a strong reason not to:

1. docs and build reset
2. server
3. desktop
4. dashboard
5. integration cleanup

This sequence minimizes rework because root assumptions stabilize before feature work converges.

## Validation matrix

Each lane should be able to validate itself without waiting on others.

| Lane | Command | Purpose |
|------|---------|---------|
| contracts | `npm run check:all` | Validate root docs, scripts, and workspaces after serialized setup changes |
| contracts | `docker compose build dashboard server` | Validate repo-root-aware container assumptions |
| desktop | `npm run check:desktop` | Typecheck and test desktop |
| dashboard | `npm run check:dashboard` | Typecheck and test dashboard |
| server | `npm run check:server` | Compile-check and test Python server |
| integration | `npm run check:all` | Aggregate workspace validation |

## Contract change policy

If a feature agent needs a shared contract change:

1. stop editing feature files,
2. write the smallest possible contract diff,
3. land the contract change first,
4. rebase the feature lane,
5. continue implementation.

Do not mix speculative schema changes with large UI or server diffs.

## Boundary policy

Keep these decisions explicit:

- the review-first shared contracts stay
- insurer scoring is a separate downstream layer
- the cloud server ingests approved exports and insurer-safe derived features, not raw session bundles

If a task tries to collapse those boundaries, stop and rewrite the task first.

## Drift control

Rebase often when:

- `shared/**` changed
- root scripts changed
- dashboard container wiring changed
- server endpoint shapes changed

Do not rebase opportunistically in the middle of an unstable diff. Finish a coherent chunk first.

## Demo-path gating

A lane can be fast and sloppy in `experimental`, but not in `demo-path`.

Before promoting work into the main demo path:

- checks pass
- failure mode is documented
- no shared contract drift remains
- and the integration agent can explain how the feature degrades if its dependency is weak

## Good multi-agent tasks for this repo

- root build and container reset
- desktop local analysis pipeline
- desktop live-capture bounds
- server boundary hardening
- dashboard ops-boundary polish
- terminology cleanup after merge

## Bad multi-agent tasks for this repo

- two agents editing repo docs or root build files at once
- one agent changing server boundary assumptions while another builds UI against old shapes
- two desktop agents both editing `desktop/electron/main.ts`
- dashboard code importing `@doctor-auditor/shared/local-review`
- simultaneous broad formatting passes across the whole repo
