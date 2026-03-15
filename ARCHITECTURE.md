# Doctor Auditor — Architecture

## Overview

Doctor Auditor is a malpractice risk assessment system that analyzes doctor-patient conversations. It uses a hybrid architecture where HIPAA-sensitive data stays local and only de-identified risk metrics are sent to a cloud server.

## System Components

```
┌─────────────────────────────────────────────────────────┐
│                  Doctor's Office (Local)                  │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Electron Desktop App                 │   │
│  │                                                    │   │
│  │  Microphone → Audio Capture                       │   │
│  │       ↓                                            │   │
│  │  Whisper.cpp (Local STT)                          │   │
│  │       ↓                                            │   │
│  │  Speaker Diarization (Doctor vs Patient)           │   │
│  │       ↓                                            │   │
│  │  Transcript → Encrypted SQLite (PHI stays here)   │   │
│  │       ↓                                            │   │
│  │  LLM Analysis ─┬─ Ollama (local, default)        │   │
│  │                 └─ Claude API (opt-in, de-ID'd)    │   │
│  │       ↓                                            │   │
│  │  Risk Assessment (scores + flags)                 │   │
│  └──────────┬───────────────────────────────────────┘   │
│             │ De-identified risk scores only              │
└─────────────┼────────────────────────────────────────────┘
              │ HTTPS (encrypted)
              ↓
┌─────────────────────────────────────────────────────────┐
│                    Cloud Server                          │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │              FastAPI Backend                       │   │
│  │                                                    │   │
│  │  API Endpoints (receive risk assessments)         │   │
│  │  Authentication (JWT, role-based)                 │   │
│  │  PostgreSQL (de-identified data only)             │   │
│  └──────────┬───────────────────────────────────────┘   │
│             │                                            │
│  ┌──────────┴───────────────────────────────────────┐   │
│  │              React Dashboard                      │   │
│  │                                                    │   │
│  │  Insurance Underwriters: risk overview, trends    │   │
│  │  Hospital Admins: doctor detail, department view  │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Data Flow & Privacy Boundary

### What stays LOCAL (HIPAA-protected):
- Raw audio recordings
- Full transcripts with speaker labels
- Patient-identifying information
- Specific medical details discussed
- Audit logs of all local data access

### What goes to the CLOUD (de-identified):
- Risk scores (1-10 per category, overall H/M/L)
- Session metadata (date, duration, doctor ID)
- Anonymized behavioral flags
- Aggregated trend data

### De-identification Pipeline (for opt-in Claude API):
1. Strip patient names → "Patient"
2. Remove dates of birth, addresses, phone numbers
3. Remove medical record numbers
4. Optionally generalize condition names

## Risk Assessment Model

Three scoring dimensions, each 1-10:

| Category | What It Detects |
|----------|----------------|
| **Communication** | Dismissiveness, not explaining risks, rushing, poor bedside manner, interrupting |
| **Clinical** | Skipping assessments, ignoring symptoms, premature diagnosis, missing follow-ups |
| **Behavioral** | Impairment signs, fatigue, hostility, inappropriate comments, emotional instability |

**Overall risk**: Weighted combination → High (7-10) / Medium (4-6) / Low (1-3)

## Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Desktop shell | Electron | Cross-platform, native mic access |
| Desktop UI | React + TypeScript | Component reuse with dashboard |
| Speech-to-text | Whisper.cpp | Local, fast on Apple Silicon, privacy-preserving |
| Speaker diarization | sherpa-onnx | Local, runs on CPU/Metal |
| Local LLM | Ollama | Easy model management, Apple Silicon optimized |
| Cloud LLM | Claude API | Superior nuance for subtle risk signals |
| Local storage | SQLite + SQLCipher | Encrypted at rest, no server dependency |
| Cloud API | Python + FastAPI | Async, typed, excellent for REST APIs |
| Cloud DB | PostgreSQL | Reliable, good for analytics queries |
| Cloud dashboard | React + TypeScript | Shared components with desktop app |
| Auth | JWT + RBAC | Role separation: underwriter vs admin |

## Directory Structure

```
doctor-auditor/
├── desktop/          # Electron desktop app (local, HIPAA)
├── server/           # FastAPI cloud backend
├── dashboard/        # React cloud dashboard
├── shared/           # Shared TypeScript types/contracts
├── docker-compose.yml
└── ARCHITECTURE.md
```

See each subdirectory's README for component-specific details.
