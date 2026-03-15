# Doctor Auditor

Doctor Auditor is a local-first encounter review system for clinician-patient conversations. The desktop app keeps raw audio, full transcripts, draft findings, and reviewer notes on the workstation. The hosted dashboard is intentionally narrower: it only handles approved exports, safe ops events, and optional minimized Remote assist traffic.

For a hackathon judge, the core idea is simple: this project helps review sensitive medical conversations without treating the cloud like the default home for raw session data. The desktop app is where capture, transcription, review, and approval happen. The dashboard is where approved outputs and operations visibility live.

## Install Notes

### Fastest path: packaged macOS app

The repo already includes a packaged Apple Silicon build:

- `desktop/dist/doctor-auditor-0.1.0-arm64.dmg`

Install steps:

1. Open `desktop/dist/doctor-auditor-0.1.0-arm64.dmg`.
2. Drag `Doctor Auditor.app` into `Applications`.
3. Launch the app.
4. If you want to test live recording, allow microphone access when macOS prompts for it.

Notes:

- This packaged build is for macOS Apple Silicon.
- Live recording currently expects a local SoX recorder binary (`sox` or `rec`). On macOS, install it with `brew install sox`.
- If you already have an audio file, you can use the import flow from the Recording screen instead of testing the microphone path.

### Source install

If you want the desktop review pipeline from source, run:

```bash
npm install
python3 -m pip install -r desktop/electron/requirements-review-ml.txt
npm run desktop
```

Notes:

- The Electron app will open automatically.
- The local transcription worker expects `python3` to be available on your machine.
- The first transcription run may take a bit longer while the local Whisper model is prepared.
- The desktop app points at the hosted API by default. Only set `DOCTOR_AUDITOR_API_URL` if you intentionally want to target a different backend.

## How to Use It

### 1. Start on the desktop app

The desktop app is the primary product surface.

Use the `Recording` view to:

1. Enter a clinician ID.
2. Confirm consent and export permissions.
3. Either start a live microphone recording or import an existing audio file.

Once the session is created, the app keeps the local audio, transcript state, and review state together so it can be resumed later from `History`.

### 2. Review the encounter locally

After capture or import, the app runs local transcription and local transcript analysis. In the session review flow, a reviewer can:

1. Inspect transcript segments and evidence-backed findings.
2. Mark findings as accepted, rejected, or uncertain.
3. Optionally request Remote assist for a minimized seriousness assessment.
4. Create an approved export only after human review.

This is the core product behavior: the workstation holds the sensitive raw session context, while the reviewer turns that into an auditable approved output.

### 3. Open the dashboard

The fastest way to review the cloud side is the hosted deployment:

- [https://docaudit.discordwell.com/](https://docaudit.discordwell.com/)

What you will see:

- `Overview` shows backlog, workload, release timing, and assist activity.
- `Exports` shows approved export envelopes and delivery status.
- `Operations` shows assist requests, failures, overrides, redaction blocks, and export events.

The dashboard bootstraps a demo reviewer session and seed data on first load, so there is a usable demo path without needing manual setup.

If you want to run the dashboard and API locally instead:

```bash
docker compose up --build
```

Then open:

- `http://localhost:3000` for the dashboard
- `http://localhost:8001/health` for the API health check

### What makes it different

- **It is local-first by design.** Raw audio, full transcripts, draft findings, and reviewer notes stay on the workstation instead of being pushed upstream by default.
- **It is review-first, not score-first.** The product is organized around evidence, reviewer judgment, and approved exports rather than opaque clinician scoring.
- **It gives the cloud a narrow job.** The hosted boundary only needs to handle approved exports, ops events, and minimized Remote assist traffic.
- **It separates reviewer work from operations work.** The desktop app is for sensitive review. The dashboard is for release management and operational visibility.
- **It demonstrates a realistic privacy posture.** The system is opinionated about what may leave the machine and what must remain local.

## Architecture at a Glance

- Desktop: Electron + React + local SQLite persistence
- Local review pipeline: Python worker for transcription and transcript analysis
- Cloud API: FastAPI
- Dashboard: React + TypeScript
- Shared contracts: TypeScript types in [`shared/`](shared/)

For more detail, see [`ARCHITECTURE.md`](ARCHITECTURE.md) and [`server/DEPLOYMENT.md`](server/DEPLOYMENT.md).
