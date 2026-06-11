# Doctor Auditor - Architecture

## Overview

Doctor Auditor is a local-first encounter review system. It captures or imports consented clinician-patient encounters, keeps raw audio and full transcripts on the desktop, generates evidence-backed findings for human review, and only crosses the cloud boundary with approved outputs.

The shared contract is intentionally review-first. It does not define clinician scoring, malpractice buckets, or impairment rankings as first-class outputs.

## Architectural decisions

These decisions are intentional and should remain explicit:

- review-first contracts stay
- insurer scoring is a separate downstream layer
- the cloud server ingests approved exports and insurer-safe derived features, not raw session bundles
- raw audio, full transcripts, draft findings, and reviewer notes stay local
- Remote assist is an optional minimized workflow, not a raw-PHI analysis channel

## System components

```
┌──────────────────────────────────────────────────────────────┐
│                 Clinician Workstation (Local)               │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │               Electron Desktop App                    │  │
│  │                                                        │  │
│  │  Audio import / live capture                           │  │
│  │         ↓                                              │  │
│  │  Local transcription via embedded Python worker        │  │
│  │         ↓                                              │  │
│  │  Local transcript analysis and findings                │  │
│  │         ↓                                              │  │
│  │  Review session + transcript segments                  │  │
│  │         ↓                                              │  │
│  │  Human review decisions                                │  │
│  │         ↓                                              │  │
│  │  Approved redacted export                              │  │
│  └──────────────┬─────────────────────────────────────────┘  │
│                 │ Approved exports and safe ops only        │
└─────────────────┼────────────────────────────────────────────┘
                  │ HTTPS
                  ↓
┌──────────────────────────────────────────────────────────────┐
│                        Cloud Server                          │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                 FastAPI Backend                       │  │
│  │                                                        │  │
│  │  Auth                                                  │  │
│  │  Approved export ingestion                             │  │
│  │  Ops event ingestion                                   │  │
│  │  Demo seed                                             │  │
│  │  Remote assist gateway                                 │  │
│  └──────────────┬─────────────────────────────────────────┘  │
│                 │                                            │
│  ┌──────────────┴─────────────────────────────────────────┐  │
│  │               Review Dashboard                         │  │
│  │                                                        │  │
│  │  Approved exports                                      │  │
│  │  Remote assist and delivery ops                        │  │
│  │  Redaction and delivery follow-up                      │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## Data flow and privacy boundary

### What stays local

- raw audio recordings
- full transcripts and speaker labels
- draft findings and confidence values
- reviewer notes before export approval
- local audit history and file-system pointers

### What can leave the workstation

- approved export envelopes
- approved, redacted evidence excerpts
- ops events for approved export and Remote assist workflows
- insurer-safe derived features that are intentionally generated from approved outputs

### What must not leave the workstation

- raw session bundles
- full transcript payloads
- raw audio payloads
- unreviewed findings
- reviewer drafts and local notes

## Desktop runtime

The desktop app uses:

- Electron for shell and IPC
- React for import, history, review, and settings UI
- SQLite for local session persistence
- an embedded Python worker under `desktop/electron/` for local transcription and transcript analysis

The local processing sequence is:

1. create a `ReviewSession`
2. persist local audio metadata and consent
3. run transcription locally
4. persist `TranscriptSegment` records
5. run local transcript analysis
6. persist `Finding` and `EvidenceSpan` records
7. collect `ReviewDecision` records
8. build an `ApprovedExport`

## Cloud runtime

The cloud server is intentionally narrow.

It owns:

- auth
- approved export ingestion
- ops event ingestion
- demo seed
- Remote assist gateway

The hosted boundary is same-origin for the dashboard:

- `https://docaudit.discordwell.com/` serves the dashboard build
- `https://docaudit.discordwell.com/api/...` serves the FastAPI boundary behind a reverse proxy
- browser dashboard traffic should stay on `/api`, not call a desktop-local host
- desktop sync and Remote assist calls default to `https://docaudit.discordwell.com/api`
- `DOCTOR_AUDITOR_API_URL` exists only as an explicit override when pointing the desktop app at a different boundary
- every data surface, including the Remote assist gateway, requires an authenticated bearer token; assist rate limits are keyed to the verified identity
- known limitation: registration is open self-serve to keep the demo bootstrap working, so the auth boundary is an audit and abuse-tracking layer, not a hard tenant wall

It does not own:

- raw session uploads
- full transcript storage
- desktop review-state mirroring
- scoring as part of the shared contract

## Shared contract surface

The shared TypeScript package centers on auditable review artifacts:

- `ReviewSession`
- `TranscriptSegment`
- `Finding`
- `EvidenceSpan`
- `ReviewDecision`
- `ApprovedExport`
- `SessionBundle`

That contract should remain review-first even if downstream insurer-safe feature generation is added later.

## Tech stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Desktop shell | Electron | Cross-platform shell with local device access |
| Desktop UI | React + TypeScript | Fast local review workflows and shared UI patterns |
| Local processing | Embedded Python worker | Separate local transcription and transcript-analysis steps from Electron main |
| Local storage | SQLite | Durable local session and audit storage |
| Cloud API | Python + FastAPI | Typed export and ops boundary |
| Cloud DB | PostgreSQL | Storage for approved exports and ops activity |
| Dashboard | React + TypeScript | Same-origin approved export and ops visibility |
| TLS edge | Reverse proxy such as Caddy | Terminates TLS and routes `/` to dashboard and `/api` to FastAPI |
| Auth | JWT + RBAC | Reviewer, quality lead, and admin separation |

## Directory structure

```
doctor-auditor/
├── desktop/          # Electron app and embedded Python worker
├── server/           # FastAPI boundary for approved exports and ops
├── dashboard/        # Approved export and ops dashboard
├── shared/           # Shared TypeScript contracts
├── docker-compose.yml
└── ARCHITECTURE.md
```
