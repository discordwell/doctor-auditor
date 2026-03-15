# Doctor Auditor Rebaseline Plan

## Summary

Doctor Auditor is a local-first encounter review system. The desktop app records or imports consented encounters, keeps raw audio and full transcripts local, produces review-first findings with evidence, and only sends approved outputs across the cloud boundary.

This repo is no longer planning around a score-first MVP. The current shared contracts remain review-first, and any eventual insurer scoring layer is downstream of reviewed exports rather than a first-class desktop or shared-contract output.

## Current repo reality

The current implementation already includes:

- npm workspaces at the repo root
- a desktop app with import flow, local session history, transcript review UI, and approved export creation
- an embedded Python review worker under `desktop/electron/`
- a FastAPI server for auth, approved exports, ops events, demo seed, and assist gateway
- a dashboard focused on approved exports and safe ops signals

The current gaps are not scaffold gaps. They are coherence and boundary gaps.

## Product decisions

These decisions are explicit and should stay explicit:

- review-first shared contracts stay
- insurer scoring is a separate downstream layer
- the cloud server ingests approved exports and insurer-safe derived features, not raw session bundles
- raw audio, full transcripts, draft findings, and reviewer notes remain local
- remote assist is optional and limited to minimized, non-raw context

## Near-term objectives

### 1. Make the board and docs match reality

- retire the stale agent waves that describe already-landed work
- publish the new Surveyor, Foundry, Miner, Pulse, Relay, Harbor, and Stitch packets
- document npm workspaces and the embedded Python review worker accurately

### 2. Fix root build and validation assumptions

- make `@doctor-auditor/shared` an explicit workspace dependency where it is imported
- make `check:server` run compile plus pytest
- make the dashboard container build from a repo-root-aware context

### 3. Complete the desktop local review pipeline

- keep transcription and transcript analysis as separate steps
- persist transcript segments first
- persist findings second
- keep review and export gated on persisted findings
- keep live capture explicitly bounded as experimental unless stability improves materially

### 4. Harden the cloud boundary

- keep server routes limited to auth, approved exports, ops events, demo seed, and assist gateway
- reject raw transcript and raw audio upload shapes
- treat approved exports and insurer-safe derived features as the only intended server ingest surface

### 5. Remove remaining terminology drift

- stop using score-first or malpractice-first framing in repo metadata and UI copy
- prefer `Remote assist` as the user-facing term for the minimized assist workflow

## Workstreams

### Surveyor

- rewrite `PLAN.md`, `ARCHITECTURE.md`, and agent docs to current reality

### Foundry

- repair packaging, build, and validation gates

### Miner

- complete the desktop post-transcription analysis pipeline

### Pulse

- stabilize or clearly bound live capture

### Relay

- harden server behavior and tests

### Harbor

- polish dashboard copy and boundary behavior

### Stitch

- normalize the merged repo after the parallel work lands

## Success criteria

This rebaseline is successful when:

1. repo docs and launch packets match the actual implementation
2. `npm run check:all` is green
3. `docker compose build dashboard server` is green
4. desktop sessions can persist transcript segments and findings in sequence
5. review and export remain blocked until findings exist
6. the cloud server remains boundary-safe and does not accept raw session bundles
