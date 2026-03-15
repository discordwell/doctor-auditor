# Doctor Auditor Plan Review

## Bottom line

The original plan is ambitious but badly mixes:

- a demoable local audio product,
- a high-stakes clinical risk classifier,
- a HIPAA/privacy architecture,
- and a multi-app platform build.

That is too much for an MVP, and some of the core claims are not technically or legally defensible yet.

If you want this repo to not suck, the first rule is:

**Do not ship a "malpractice risk" or "doctor impairment" classifier as the MVP.**

Start with a local-first encounter review tool that produces evidence-backed findings from recorded conversations. Build the scorecard later, only after you have labeled data and measured error rates.

## What is weak in Claude's plan

### 1. The product claim is ahead of the evidence

"High / medium / low malpractice risk" sounds clean, but it hides the hard part:

- What exact behavior maps to each bucket?
- Who labels the ground truth?
- How do you separate rude communication from medically appropriate urgency?
- How do you avoid systematically penalizing accents, speech disorders, specialties, or high-acuity settings?

Without a labeled evaluation set, this score is theater.

### 2. It collapses multiple unsolved problems into one feature

The plan treats these as if they are ordinary backlog items:

- real-time audio capture,
- reliable local transcription,
- diarization,
- doctor voice identification,
- PHI redaction,
- nuanced risk analysis,
- hybrid local/cloud inference,
- secure sync,
- and analytics dashboards.

Each of those can derail a v1 by itself.

### 3. "Signs of impairment" is a bad v1 target

Trying to infer fatigue, intoxication, or emotional instability from audio is high-risk and error-prone. It invites false accusations and is the easiest way to make the product untrustworthy.

Drop it from the first versions.

### 4. "De-identified snippets" is not a magic safety switch

Redaction is imperfect. Clinical dialogue leaks identity through context, conditions, dates, family structure, location clues, and rare events. A consent toggle alone is not enough to justify cloud analysis.

For MVP, keep analysis local by default and treat cloud export as a separate, explicit workflow.

### 5. The architecture is overbuilt too early

Electron app + cloud API + cloud dashboard + auth + encryption + audit logs + hybrid inference is a platform roadmap, not an MVP.

You do not need all of that to prove the core value.

### 6. The categories are too subjective

"Dismissiveness" and "poor bedside manner" are real concerns, but they need observable definitions. Otherwise the model will produce vague moral judgments with no reproducible standard.

### 7. No evaluation plan exists

The original plan has tests for code paths, but not for model quality. That is not enough. You need:

- labeled conversations,
- target precision/recall by finding type,
- false-positive review,
- and specialty/context-specific calibration.

## Better product framing

### V1 problem statement

Build a local-first desktop tool that records a consented doctor-patient encounter, transcribes it, separates speakers, and produces a structured review report with evidence spans for a small set of observable communication and workflow findings.

### V1 output

Do this:

- produce findings such as "interrupted patient three times" or "medication risks were not discussed in the transcript",
- attach transcript timestamps and supporting excerpts,
- show confidence,
- allow a human reviewer to accept or reject findings,
- export a redacted summary.

Do not do this yet:

- malpractice risk buckets,
- impairment detection,
- insurer-facing premium decisions,
- autonomous alerts to management,
- unsupervised cloud PHI handling.

## Revised success criteria

The first shippable demo succeeds if it can:

1. Capture audio locally from the microphone.
2. Produce a usable transcript within a reasonable delay.
3. Split the encounter into speaker-attributed segments well enough for review.
4. Detect 5 to 7 narrowly defined findings with evidence.
5. Let a reviewer override every finding.
6. Store all raw encounter data locally.
7. Export only a redacted summary when explicitly requested.

If it cannot do those seven things reliably, a cloud dashboard is premature.

## Recommended technical shape

## Monorepo

Use a `pnpm` workspace with four parts:

- `desktop/`: Electron + React + TypeScript + Vite
- `worker/`: Python service for transcription, diarization, and analysis
- `dashboard/`: React dashboard for later phases
- `shared/`: schemas and contracts

Add `worker/` even though it is not in the current folder layout. Native audio/ML tooling is materially easier there than in Node.

## Why a Python worker is the right compromise

Claude's plan assumes Node bindings for everything. That will waste time.

A local Python sidecar is the pragmatic option for:

- speech-to-text,
- diarization,
- redaction,
- embedding/speaker verification,
- and evaluation scripts.

Let Electron own the UI and device integration. Let Python own the ML pipeline.

## Suggested stack

- Desktop shell: Electron
- Desktop UI: React + TypeScript + Vite
- Package manager: `pnpm`
- State: Zustand or plain React state
- Local DB: SQLite
- Desktop-to-worker IPC: localhost HTTP or gRPC over loopback
- Transcription: `faster-whisper` or `whisper.cpp`, whichever is more stable on your Apple Silicon target after a spike
- Speaker separation: start with diarization plus doctor enrollment; do not promise perfect speaker identity
- Analysis: rules + prompt-based local LLM for evidence extraction, not freeform moral scoring
- Local model runtime: Ollama only after the non-LLM pipeline works
- Validation schemas: Zod in TypeScript and Pydantic in Python
- Tests: Vitest for desktop/shared, pytest for worker

## Data model that will hold up

Center the system on auditable artifacts, not scores.

Core entities:

- `review_session`
- `transcript_segment`
- `finding`
- `evidence_span`
- `review_decision`
- `approved_export`
- `audit_log_entry`
- `session_bundle`

That gives you traceability when a finding is challenged.

For the current repo, the Wave 0 shared contract should map directly to:

- `ReviewSession`
- `TranscriptSegment`
- `Finding`
- `EvidenceSpan`
- `ReviewDecision`
- `ApprovedExport`

If later tracks need audio chunks, sync records, or additional reviewer metadata, add them around this contract surface instead of collapsing back into score-first payloads.

## V1 findings rubric

Keep the first rubric tight and observable. Example finding types:

- patient interruption frequency
- unanswered direct patient questions
- absence of treatment risk discussion after procedure mention
- absence of follow-up instructions near session close
- signs that patient concern was restated incorrectly
- abrupt session termination after unresolved concern

Each finding must define:

- trigger condition,
- required evidence,
- exclusions,
- confidence rules,
- and what a reviewer sees.

If you cannot write the rule clearly, it is not ready for the model.

## Privacy and compliance boundary

For MVP:

- raw audio stays local,
- full transcript stays local,
- analysis runs local,
- redacted export is manual and explicit,
- cloud sync is off by default.

Also require explicit encounter consent handling in the product design. If two-party consent laws apply in the recording jurisdiction, that is not a settings toggle you can hand-wave away.

## Parallel buildout model

The right way to be ambitious here is not to force a single critical path.

Run multiple tracks in parallel, but hold them behind explicit merge gates. A track can move fast, spike aggressively, and even use throwaway code. It does not get promoted into the main demo flow until it passes its gate.

## Shared rule for every track

A subsystem can only graduate from `experimental` to `demo-path` if it has:

- a clear input and output contract,
- repeatable local runs,
- basic automated checks,
- a benchmark or fixture set,
- and a documented failure mode.

If any of those are missing, it stays off the critical path.

## Workstreams

### Track A: Platform foundation

Scope:

- `pnpm` workspace
- Electron shell
- React desktop UI
- Python worker service
- shared schemas
- local SQLite access layer
- CI for lint, typecheck, and tests

Output contract:

- desktop can submit a local job to the worker
- worker can return structured JSON responses
- schemas are versioned in `shared/`

Gate:

- one command boots desktop and worker together
- one command runs all checks
- fixture jobs can move through the stack without manual patching

Failure action:

- if contracts keep changing, freeze feature work and stabilize schemas first

### Track B: Audio ingestion

Scope:

- prerecorded file import
- live microphone capture
- device selection
- chunked audio persistence
- waveform and basic audio health indicators

Output contract:

- worker receives normalized audio chunks or file paths in a stable format

Gate:

- import path works on known fixtures
- live capture can run for 30 minutes without dropped chunks or crashes
- recordings are timestamped and recoverable after app restart

Failure action:

- if live capture is unstable, continue with prerecorded import only

### Track C: Transcription

Scope:

- compare `faster-whisper` and `whisper.cpp`
- batch transcript generation
- optional near-real-time chunk transcription
- transcript segment storage

Output contract:

- transcript segments with start time, end time, text, and source confidence

Gate:

- one implementation is selected based on repeatable local results on Apple Silicon
- transcript output is good enough for a human reviewer to follow the encounter
- reruns on the same fixture are materially consistent

Failure action:

- if streaming quality is weak, ship post-visit transcription first

### Track D: Speaker attribution

Scope:

- diarization spike
- doctor voice enrollment spike
- speaker labeling in transcript view
- uncertainty display

Output contract:

- each transcript segment has `speaker_label` and `speaker_confidence`

Gate:

- speaker attribution is useful enough that reviewers are not confused more often than helped
- low-confidence segments are surfaced explicitly

Failure action:

- if identity attribution is unreliable, fall back to generic `Speaker A` / `Speaker B`
- if diarization is unreliable, ship a plain transcript with no role claims

### Track E: Findings engine

Scope:

- define 5 to 7 observable findings
- build rule-first extraction
- optionally add local LLM evidence extraction behind the rules
- structured findings with evidence spans

Output contract:

- findings JSON with `type`, `confidence`, `status`, and transcript evidence references

Gate:

- first 2 findings work end-to-end before adding more
- every finding links to transcript evidence
- reviewer override rate is acceptable on fixture reviews

Failure action:

- if a finding is too noisy, cut that finding type
- if LLM extraction adds instability, keep rules and remove the LLM from demo-path

### Track F: Privacy, redaction, and auditability

Scope:

- local-only raw data storage
- export review flow
- redaction pipeline
- audit events for view and export actions

Output contract:

- export payload contains only approved summary fields and redacted excerpts

Gate:

- raw audio never leaves local storage in the demo flow
- export is manual and reviewable
- audit logs capture who exported what and when

Failure action:

- if redaction quality is uncertain, disable export rather than risk leakage

### Track G: Cloud sync and insurer demo surface

Scope:

- FastAPI service
- Postgres schema for approved exports
- manual sync
- basic dashboard for aggregate review

Output contract:

- server accepts only approved export schemas from Track F

Gate:

- payload inspection confirms no raw transcript or audio is sent
- dashboard only shows approved summary fields

Failure action:

- if Track F is not green, Track G does not launch
- if sync needs special-case exceptions, stop and simplify the payload

## Gates that control the whole program

### Gate 0: Foundation green

Required:

- Track A is green

Unlocks:

- all other tracks can build against stable contracts

### Gate 1: Transcript proof

Required:

- Track B prerecorded import is green
- Track C batch transcription is green

Unlocks:

- session viewer
- fixture-based evaluation

### Gate 2: Live capture proof

Required:

- Track B live capture is green

Unlocks:

- live demo path

Fallback:

- if this gate fails, demo with prerecorded encounters only

### Gate 3: Speaker usefulness proof

Required:

- Track D is green

Unlocks:

- role-aware findings

Fallback:

- if this gate fails, findings must avoid doctor/patient role assumptions

### Gate 4: Findings usefulness proof

Required:

- Track E is green for at least 2 findings

Unlocks:

- reviewer workflow
- report generation

Fallback:

- if this gate fails, demo transcript review only

### Gate 5: Export safety proof

Required:

- Track F is green

Unlocks:

- redacted report export
- any remote sync work

Fallback:

- if this gate fails, no cloud story in the demo

### Gate 6: Cloud demo proof

Required:

- Track G is green

Unlocks:

- insurer-facing dashboard demo

Fallback:

- if this gate fails, present the desktop reviewer only

## Hard kill criteria

These are not "needs polish" items. These are stop signs.

- If transcription is not usable on your fixture set, do not build findings on top of it.
- If speaker attribution silently guesses wrong, remove role claims from the product.
- If redaction cannot be trusted, keep all outputs local.
- If reviewers reject a large share of findings, do not aggregate them into scores.
- If live capture is unstable, move the demo to upload-first.
- If a finding cannot be explained with evidence, it is not allowed in the UI.

## Recommended team shape for parallel work

Even if one person is driving, think in owners:

- owner 1: desktop shell, storage, UX
- owner 2: transcription and diarization
- owner 3: findings, rubrics, evaluation set
- owner 4: privacy/export/sync contracts

Agentic coding helps most when each track has a crisp contract and a fixture set. It is much less useful when five experimental subsystems are mutating the same data model every day.

## First 14 days

### Days 1 to 3

- make Track A green
- define shared schemas
- create fixture folder with 5 to 10 sample encounters

### Days 4 to 7

- run Track B prerecorded import spike
- run Track C transcription bakeoff
- start Track F export schema and audit event design

### Days 8 to 10

- implement transcript viewer
- run Track D diarization spike
- define first 2 findings and manual labels for fixtures

### Days 11 to 14

- wire first 2 findings end-to-end
- review false positives on fixtures
- attempt live capture only after prerecorded path is green

## What to cut from the first 90 days

Cut these unless you like rebuilding everything twice:

- insurer underwriting workflows
- automated doctor ranking
- real-time risk flags during the encounter
- Claude or other cloud LLM integration
- certificate pinning
- full RBAC complexity
- "high / medium / low malpractice risk"
- impairment detection

None of those are core proof-of-value for the first build.

## Evaluation plan

You need a product evaluation plan, not just unit tests.

Create a tiny internal benchmark set:

- 20 to 30 consented sample encounters
- transcript ground truth for a subset
- manually labeled findings
- reviewer notes on false positives and false negatives

Track:

- diarization usefulness
- finding precision by type
- finding recall by type
- redaction misses
- review override rate

If review override rate is high, your model layer is not trustworthy enough to score clinicians.

## Concrete execution order for this repo

1. Make Track A green and add the missing `worker/` service.
2. Run Tracks B, C, and F in parallel on prerecorded fixtures.
3. Add transcript viewer as soon as Tracks B and C are minimally functional.
4. Run Track D as an isolated spike; do not block transcript review on it.
5. Run Track E on only 2 findings until reviewer feedback is credible.
6. Attempt live capture only after prerecorded review is already useful.
7. Launch Track G only after Track F is green.

## A better north star

Bad north star:

- "Tell insurers which doctors are high risk."

Good north star:

- "Help a human reviewer inspect encounter communication patterns with transcript evidence and privacy controls."

That second version is buildable, defensible, and leaves room to add scoring later if the data justifies it.

## Immediate next step

Bootstrap the repo for a local-first desktop + Python worker architecture and prove prerecorded transcription before touching real-time analysis or any cloud features.
