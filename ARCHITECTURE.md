# Doctor Auditor - Architecture

## Overview

Doctor Auditor is a local-first encounter review system. It captures or imports consented clinician-patient encounters, keeps raw audio and full transcripts on the desktop, generates evidence-backed findings for human review, and only crosses the cloud boundary with approved, redacted exports.

The shared contract is intentionally review-centric. It does not define malpractice scores, overall risk buckets, or impairment rankings as first-class outputs.

## System Components

```
┌──────────────────────────────────────────────────────────────┐
│                 Clinician Workstation (Local)               │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │               Electron Desktop App                    │  │
│  │                                                        │  │
│  │  Audio import / live capture                           │  │
│  │         ↓                                              │  │
│  │  Transcript generation + speaker attribution           │  │
│  │         ↓                                              │  │
│  │  Review session + transcript segments                  │  │
│  │         ↓                                              │  │
│  │  Findings + evidence spans                             │  │
│  │         ↓                                              │  │
│  │  Human review decisions                                │  │
│  │         ↓                                              │  │
│  │  Approved redacted export                              │  │
│  └──────────────┬─────────────────────────────────────────┘  │
│                 │ Approved exports only                      │
└─────────────────┼────────────────────────────────────────────┘
                  │ HTTPS
                  ↓
┌──────────────────────────────────────────────────────────────┐
│                        Cloud Server                           │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                 FastAPI Backend                       │  │
│  │                                                        │  │
│  │  Approved export ingestion                             │  │
│  │  Authentication and audit metadata                     │  │
│  │  Storage for approved summaries only                   │  │
│  └──────────────┬─────────────────────────────────────────┘  │
│                 │                                            │
│  ┌──────────────┴─────────────────────────────────────────┐  │
│  │               Review Dashboard                         │  │
│  │                                                        │  │
│  │  Review queues, finding activity, export status        │  │
│  │  Throughput and approved summary visibility            │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## Data Flow and Privacy Boundary

### What stays local

- Raw audio recordings
- Full transcripts and speaker labels
- Draft findings and confidence values
- Reviewer notes before export approval
- Local audit history and file-system pointers

### What can leave the workstation

- Session metadata needed for an approved export
- Reviewed findings that a human explicitly approved
- Redacted evidence excerpts tied to those approved findings
- Export approval metadata and delivery status

### Export pipeline

1. Create a `ReviewSession` from imported audio or live capture.
2. Produce `TranscriptSegment` records with timing and confidence.
3. Generate `Finding` records with linked `EvidenceSpan` references.
4. Capture human `ReviewDecision` records for accept, reject, uncertain, or edited outcomes.
5. Build an `ApprovedExport` that contains only approved summaries and redacted evidence excerpts.

## Shared Contract Surface

The shared TypeScript package now centers on auditable review artifacts:

- `ReviewSession`
- `TranscriptSegment`
- `Finding`
- `EvidenceSpan`
- `ReviewDecision`
- `ApprovedExport`
- `SessionBundle`

That contract deliberately avoids score-heavy language. Downstream lanes should model review queues and approved exports, not assume a required malpractice ranking step.

## Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Desktop shell | Electron | Cross-platform shell with local device access |
| Desktop UI | React + TypeScript | Fast local review workflows and shared UI patterns |
| Speech-to-text | Whisper.cpp or equivalent local runtime | Privacy-preserving transcript generation |
| Speaker attribution | Local diarization tooling | Useful review context without a cloud dependency |
| Findings engine | Rules plus optional local/cloud LLM extraction | Evidence-backed findings instead of opaque scoring |
| Local storage | SQLite | Durable local session and audit storage |
| Cloud API | Python + FastAPI | Typed export boundary and straightforward service surface |
| Cloud DB | PostgreSQL | Storage for approved summaries and export activity |
| Dashboard | React + TypeScript | Review queue and export visibility |
| Auth | JWT + RBAC | Reviewer, quality lead, and admin separation |

## Directory Structure

```
doctor-auditor/
├── desktop/          # Electron desktop app
├── server/           # FastAPI backend for approved exports
├── dashboard/        # Review dashboard
├── shared/           # Shared TypeScript contracts
├── docker-compose.yml
└── ARCHITECTURE.md
```
