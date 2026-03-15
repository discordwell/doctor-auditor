# Multi-Agent Workflow

## Goal

Exploit parallel agents without turning the repo into merge-conflict soup.

The workflow is:

1. freeze a small contract surface,
2. assign isolated lanes,
3. run lane-local checks,
4. merge in a controlled order,
5. promote only green work into the demo path.

For ready-to-run task packets, use [AGENT_LAUNCHBOARD.md](/Users/discordwell/Projects/doctor-auditor/docs/AGENT_LAUNCHBOARD.md).

## Recommended roles

### Contract agent

Owns:

- `shared/**`
- repo-level scripts
- `PLAN.md`
- `ARCHITECTURE.md`
- workflow docs

Responsibilities:

- define or update shared types
- keep root scripts usable
- publish lane boundaries

This role is the bottleneck by design. Do not parallelize it casually.

### Desktop agent

Owns:

- `desktop/electron/**`
- `desktop/src/**`

Responsibilities:

- recording UX
- local session views
- Electron integration

### Dashboard agent

Owns:

- `dashboard/**`

Responsibilities:

- insurer-facing views
- charts
- API client integration

### Server agent

Owns:

- `server/**`

Responsibilities:

- API schemas and endpoints
- persistence
- auth and sync flows

### Integration agent

Owns:

- cross-lane rebases
- final validation
- drift cleanup

Responsibilities:

- resolve conflicts after lane work lands
- run aggregate checks
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

### Soft boundaries

These can be edited by other lanes only when the owning lane is idle:

- `desktop/src/App.tsx`
- `dashboard/src/App.tsx`
- `server/app/main.py`

Those are integration hotspots. Expect conflicts.

## Task packet template

When you spin up an agent, give it a packet with:

- lane
- goal
- allowed files
- forbidden files
- required checks
- acceptance criteria
- output format for the handoff

Example packet:

```text
Lane: desktop
Goal: Add upload-first encounter import UI in the recording view
Allowed files: desktop/**
Forbidden files: shared/**, package.json, server/**, dashboard/**
Required checks: npm run check:desktop
Acceptance: user can choose a local audio file and see import status in UI
Handoff: summarize files changed, checks run, and any schema requests
```

## Merge order

Use this order unless there is a strong reason not to:

1. contracts
2. server
3. desktop
4. dashboard
5. integration cleanup

This sequence minimizes rework because shared types and endpoints stabilize before UI work converges.

## Validation matrix

Each lane should be able to validate itself without waiting on others.

| Lane | Command | Purpose |
|------|---------|---------|
| contracts | `npm run check:shared` | Validate shared TypeScript contracts |
| desktop | `npm run check:desktop` | Typecheck and test desktop |
| dashboard | `npm run check:dashboard` | Typecheck and test dashboard |
| server | `npm run check:server` | Compile-check Python server |
| integration | `npm run check:all` | Aggregate workspace validation |

## Contract change policy

If a feature agent needs a shared contract change:

1. stop editing feature files,
2. write the smallest possible contract diff,
3. land the contract change first,
4. rebase the feature lane,
5. continue implementation.

Do not mix speculative schema changes with large UI or server diffs.

## Drift control

Rebase often when:

- `shared/**` changed
- root scripts changed
- endpoint shapes changed

Do not rebase opportunistically in the middle of an unstable diff. Finish a coherent chunk first.

## Demo-path gating

A lane can be fast and sloppy in `experimental`, but not in `demo-path`.

Before promoting work into the main demo:

- checks pass,
- failure mode is documented,
- no shared contract drift remains,
- and the integration agent can explain how the feature degrades if its dependency is weak.

## Good multi-agent tasks for this repo

- desktop import flow
- desktop session history UI
- server health and assessment endpoints
- dashboard overview charts
- shared assessment and session schemas
- audit log model cleanup

## Bad multi-agent tasks for this repo

- two agents editing `shared/types/index.ts` at once
- one agent changing API responses while another builds UI against old shapes
- multiple agents modifying root scripts in parallel
- simultaneous broad formatting passes across the whole repo
