# Doctor Auditor Agent Guide

## Purpose

This repo is set up for parallel Codex work. Optimize for isolated changes, stable contracts, and fast lane-specific validation.

This is a live repository with an existing scaffold and an `origin` remote. Agents should inspect current lane files before changing anything and should not rebuild the repo from scratch.

## Core rules

- Work in one lane at a time.
- Avoid editing coordination-critical files unless your task is explicitly about contracts or repo operations.
- Prefer lane-local checks over full-workspace checks while iterating.
- Do not change `package-lock.json` unless your task adds, removes, or upgrades dependencies.
- If you need a shared contract change, make that change first, call it out clearly, and keep the diff small.

## Coordination-critical files

Treat these as serialized edits. Only one agent should touch them in a batch:

- `shared/**`
- `package.json`
- `package-lock.json`
- `docker-compose.yml`
- `ARCHITECTURE.md`
- `PLAN.md`
- `AGENTS.md`
- `docs/MULTI_AGENT_WORKFLOW.md`
- `docs/AGENT_LAUNCHBOARD.md`
- `docs/NAMED_AGENTS.md`

## Lanes

### `desktop`

Allowed paths:

- `desktop/**`

Primary checks:

- `npm run check:desktop`

### `dashboard`

Allowed paths:

- `dashboard/**`

Primary checks:

- `npm run check:dashboard`

### `server`

Allowed paths:

- `server/**`

Primary checks:

- `npm run check:server`

### `contracts`

Allowed paths:

- `shared/**`
- coordination-critical root files

Primary checks:

- `npm run check:shared`
- `npm run check:contracts`

## Branch naming

Use `codex/<lane>-<task>` branches.

Examples:

- `codex/desktop-recording-shell`
- `codex/server-assessment-endpoint`
- `codex/contracts-shared-session-schema`

Base new branches from `origin/main` unless you are explicitly told to stack on a different integration branch.

## Worktrees

Prefer one git worktree per active agent. Do not run multiple agents against the same checkout if you can avoid it.

Suggested pattern:

- create worktrees under a sibling folder such as `../doctor-auditor-worktrees/`
- use one worktree per named agent branch
- merge back only after that lane's checks pass

## Handoff contract

Every agent handoff should include:

- lane worked
- files changed
- checks run
- contract changes made
- follow-up risks or blockers

## Multi-agent order of operations

1. Contract agent lands shared schema or workflow changes.
2. Feature agents build against that contract in parallel.
3. Integration agent rebases, resolves drift, and runs `npm run check:all`.

If the contract is still moving, feature work should pause rather than guess.

## Launchboard

Use [docs/AGENT_LAUNCHBOARD.md](/Users/discordwell/Projects/doctor-auditor/docs/AGENT_LAUNCHBOARD.md) for ready-to-run agent packets, wave ordering, and merge gates.

## Named Agents

Use [docs/NAMED_AGENTS.md](/Users/discordwell/Projects/doctor-auditor/docs/NAMED_AGENTS.md) for copy-paste launch prompts and stable agent names.
