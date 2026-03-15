import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { createHash, randomUUID } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import type {
  Finding,
  ModelAssistReceipt,
  ModelAssistRequest,
  SeriousnessAssessment,
  TranscriptSegment,
} from "@doctor-auditor/shared/local-review";
import type {
  ApprovedExport,
  ApprovedExportEnvelope,
  OpsEvent,
} from "@doctor-auditor/shared/cloud";
import { AudioCapture } from "./audio-capture";
import { CloudSyncClient } from "./cloud-sync";
import { LocalDatabase } from "./database";
import { PythonReviewMlClient } from "./review-ml";
import {
  ReviewRuntimeService,
  type ReviewRuntimeAnalysisCompleted,
  type ReviewRuntimeAnalysisFailed,
  type ReviewRuntimeTranscriptionCompleted,
  type ReviewRuntimeTranscriptionFailed,
} from "./review-runtime";
import type {
  CreateApprovedExportRequest,
  CreateApprovedExportResult,
  DesktopSessionBundle,
  DesktopSessionSummary,
  PersistReviewDecisionRequest,
  RequestSeriousnessAssistRequest,
  RequestSeriousnessAssistResult,
  SessionIntakeRequest,
  UpdateModelAssistActionRequest,
} from "./review-models";

const DESKTOP_REVIEWER_ID = "desktop";

let mainWindow: BrowserWindow | null = null;
let audioCapture: AudioCapture | null = null;
let cloudSync: CloudSyncClient | null = null;
let db: LocalDatabase | null = null;
let reviewRuntime: ReviewRuntimeService | null = null;
let activeRecordingSessionId: string | null = null;

type ImportStage =
  | "selected"
  | "copying"
  | "creating-session"
  | "completed"
  | "error";

interface ImportProgressPayload {
  stage: ImportStage;
  message: string;
  fileName?: string;
  sessionId?: string;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: "Doctor Auditor",
  });

  void loadWindowContent(mainWindow);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function loadWindowContent(window: BrowserWindow): Promise<void> {
  const bundledIndexPath = path.join(__dirname, "../dist/index.html");
  const rendererUrl =
    process.env.DOCTOR_AUDITOR_RENDERER_URL ?? "http://localhost:5173";

  if (!app.isPackaged) {
    await window.loadURL(rendererUrl);
    window.webContents.openDevTools();
    return;
  }

  await window.loadFile(bundledIndexPath);
}

async function initializeServices(): Promise<void> {
  const userDataPath = app.getPath("userData");

  db = new LocalDatabase(path.join(userDataPath, "doctor-auditor.db"));
  audioCapture = new AudioCapture();
  cloudSync = new CloudSyncClient();
  reviewRuntime = new ReviewRuntimeService(new PythonReviewMlClient());

  // Keep Electron main limited to IPC and persistence. STT, diarization,
  // and review-analysis belong behind the Python review-ML boundary, not here.
  reviewRuntime.on(
    "transcription-completed",
    ({ job, segments }: ReviewRuntimeTranscriptionCompleted) => {
      if (!db) {
        return;
      }

      db.replaceTranscriptSegments(job.sessionId, segments);

      const completedSummary = db.updateSession(job.sessionId, {
        transcriptStatus: segments.length > 0 ? "completed" : "failed",
        reviewStatus: "not_started",
      });

      if (completedSummary) {
        emitSessionChanged(completedSummary);
      }
    }
  );
  reviewRuntime.on(
    "analysis-completed",
    ({ findings, job }: ReviewRuntimeAnalysisCompleted) => {
      if (!db) {
        return;
      }

      db.replaceFindings(job.sessionId, findings);
      const sessionSummary = db.getSessionSummary(job.sessionId);
      if (sessionSummary) {
        emitSessionChanged(sessionSummary);
      }
    }
  );
  reviewRuntime.on(
    "analysis-failed",
    ({ error, job }: ReviewRuntimeAnalysisFailed) => {
      console.error("Transcript analysis pipeline failed:", error);
      if (!db) {
        return;
      }

      const sessionSummary = db.updateSession(job.sessionId, {
        reviewStatus: "not_started",
      });
      if (sessionSummary) {
        emitSessionChanged(sessionSummary);
      }
    }
  );
  reviewRuntime.on(
    "transcription-failed",
    ({ error, job }: ReviewRuntimeTranscriptionFailed) => {
      console.error("Transcription pipeline failed:", error);
      if (!db) {
        return;
      }

      const failedSummary = db.updateSession(job.sessionId, {
        transcriptStatus: "failed",
      });

      if (failedSummary) {
        emitSessionChanged(failedSummary);
      }
    }
  );

  audioCapture.on("level", (level: number) => {
    mainWindow?.webContents.send("audio:level", level);
  });
  audioCapture.on("capture-error", (message: string) => {
    failActiveRecordingSession(message);
  });
}

function emitImportProgress(payload: ImportProgressPayload): void {
  mainWindow?.webContents.send("session:import-progress", payload);
}

function emitSessionChanged(sessionSummary: DesktopSessionSummary): void {
  mainWindow?.webContents.send("session:changed", sessionSummary);
}

function emitLiveCaptureError(payload: {
  message: string;
  session: DesktopSessionSummary | null;
}): void {
  mainWindow?.webContents.send("audio:capture-error", payload);
}

function failActiveRecordingSession(message: string): DesktopSessionSummary | null {
  if (!db || !activeRecordingSessionId) {
    emitLiveCaptureError({
      message,
      session: null,
    });
    return null;
  }

  const failedSummary = db.failLiveCaptureSession(
    activeRecordingSessionId,
    new Date().toISOString()
  );
  activeRecordingSessionId = null;

  if (failedSummary) {
    emitSessionChanged(failedSummary);
  }

  emitLiveCaptureError({
    message,
    session: failedSummary,
  });

  return failedSummary;
}

function queueTranscription(
  sessionId: string,
  audioPath: string,
  source: TranscriptSegment["source"]
): DesktopSessionSummary | null {
  if (!db) {
    return null;
  }
  if (!reviewRuntime) {
    throw new Error("Review runtime unavailable.");
  }

  db.resetLocalReviewArtifacts(sessionId);
  const queuedSummary = db.updateSession(sessionId, {
    transcriptStatus: "in_progress",
  });

  if (queuedSummary) {
    emitSessionChanged(queuedSummary);
  }

  reviewRuntime.enqueueTranscription({
    audioPath,
    sessionId,
    source,
  });

  return queuedSummary;
}

function getValidatedIntake(
  request: SessionIntakeRequest | undefined
): SessionIntakeRequest {
  if (!request) {
    throw new Error("Session details are required before starting capture.");
  }

  const clinicianId = request.clinicianId.trim();
  if (!clinicianId) {
    throw new Error("Add a clinician label before starting capture.");
  }

  if (!request.recordedWithConsent) {
    throw new Error("Confirm recorded consent before starting capture.");
  }

  return {
    clinicianId,
    recordedWithConsent: request.recordedWithConsent,
    exportAllowed: request.exportAllowed,
    remoteAssistAllowed: request.remoteAssistAllowed,
    policyVersion: request.policyVersion,
  };
}

function getSessionBundleOrThrow(sessionId: string): DesktopSessionBundle {
  if (!db) {
    throw new Error("Database not initialized");
  }

  const bundle = db.getSession(sessionId);
  if (!bundle) {
    throw new Error("The selected review session no longer exists.");
  }

  return bundle;
}

function getFindingOrThrow(
  bundle: DesktopSessionBundle,
  findingId: string
): Finding {
  const finding = bundle.findings.find((item) => item.id === findingId);
  if (!finding) {
    throw new Error("The selected finding no longer exists.");
  }
  return finding;
}

function buildMinimizedConcernPacket(
  bundle: DesktopSessionBundle,
  finding: Finding
): ModelAssistRequest["concern"] {
  if (finding.evidenceSpans.length === 0) {
    throw new Error(
      "Remote assist requires at least one linked evidence span."
    );
  }

  const speakerLabels = Array.from(
    new Set(
      finding.evidenceSpans
        .map((span) =>
          bundle.transcriptSegments.find(
            (segment) => segment.id === span.transcriptSegmentId
          )?.speakerLabel
        )
        .filter((value): value is TranscriptSegment["speakerLabel"] =>
          typeof value === "string"
        )
    )
  );

  const encounterStartedAt = Date.parse(bundle.session.encounterStartedAt);
  const encounterEndedAt = Date.parse(
    bundle.session.encounterEndedAt ?? bundle.session.encounterStartedAt
  );
  const encounterDurationMs =
    Number.isNaN(encounterStartedAt) || Number.isNaN(encounterEndedAt)
      ? undefined
      : Math.max(encounterEndedAt - encounterStartedAt, 0);

  return {
    findingCode: finding.code,
    findingStatus: finding.status,
    findingConfidence: finding.confidence,
    evidenceSpanCount: finding.evidenceSpans.length,
    speakerLabels,
    captureMode: bundle.session.captureMode,
    encounterDurationMs,
  };
}

function buildModelAssistRequest(
  bundle: DesktopSessionBundle,
  finding: Finding
): ModelAssistRequest {
  const requestedAt = new Date().toISOString();

  return {
    id: `assist-request-${randomUUID()}`,
    sessionId: bundle.session.id,
    findingId: finding.id,
    requestedBy: DESKTOP_REVIEWER_ID,
    requestedAt,
    policyVersion: bundle.session.consent.policyVersion,
    policyMode: "minimized_no_raw_phi",
    concern: buildMinimizedConcernPacket(bundle, finding),
  };
}

function buildAssistReceipt(
  request: ModelAssistRequest,
  assessment: SeriousnessAssessment,
  latencyMs: number
): ModelAssistReceipt {
  return {
    id: `assist-receipt-${randomUUID()}`,
    requestId: request.id,
    sessionId: request.sessionId,
    findingId: request.findingId,
    status: "completed",
    policyMode: request.policyMode,
    requestedAt: request.requestedAt,
    completedAt: assessment.assessedAt,
    latencyMs,
    reviewerAction: "not_applied",
    assessment,
  };
}

function buildFailedAssistReceipt(
  request: ModelAssistRequest,
  error: unknown,
  latencyMs: number
): ModelAssistReceipt {
  return {
    id: `assist-receipt-${randomUUID()}`,
    requestId: request.id,
    sessionId: request.sessionId,
    findingId: request.findingId,
    status: "failed",
    policyMode: request.policyMode,
    requestedAt: request.requestedAt,
    completedAt: new Date().toISOString(),
    latencyMs,
    errorCode: normalizeErrorCode(error),
    reviewerAction: "not_applied",
  };
}

function buildOpsEvent(payload: {
  sessionId: string;
  type: OpsEvent["type"];
  exportId?: string;
  assistReceiptId?: string;
  provider?: string;
  model?: string;
  policyMode?: string;
  latencyMs?: number;
  errorCode?: string;
  reviewerAction?: string;
}): OpsEvent {
  return {
    id: `ops-${randomUUID()}`,
    localSessionId: payload.sessionId,
    exportId: payload.exportId,
    assistReceiptId: payload.assistReceiptId,
    type: payload.type,
    recordedAt: new Date().toISOString(),
    actorId: DESKTOP_REVIEWER_ID,
    provider: payload.provider,
    model: payload.model,
    policyMode: payload.policyMode,
    latencyMs: payload.latencyMs,
    errorCode: payload.errorCode,
    reviewerAction: payload.reviewerAction,
  };
}

async function postOpsEventBestEffort(event: OpsEvent): Promise<string | null> {
  if (!cloudSync) {
    return "Cloud sync client unavailable.";
  }

  try {
    await cloudSync.postOpsEvent(event);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Unable to sync ops event.";
  }
}

function buildApprovedExport(bundle: DesktopSessionBundle, input: {
  destination?: string;
  status?: "approved" | "sent";
}): ApprovedExport {
  if (!bundle.session.consent.exportAllowed) {
    throw new Error("This session is not approved for cloud export.");
  }

  if (bundle.session.reviewStatus !== "completed") {
    throw new Error("Complete local review before creating an approved export.");
  }

  const decisionsById = new Map(
    bundle.reviewDecisions.map((decision) => [decision.id, decision])
  );

  const findings = bundle.findings.flatMap((finding) => {
    if (!finding.reviewDecisionId) {
      return [];
    }

    const decision = decisionsById.get(finding.reviewDecisionId);
    if (!decision || (decision.outcome !== "accepted" && decision.outcome !== "edited")) {
      return [];
    }

    const approvedEvidenceSpans =
      decision.approvedEvidenceSpans ?? finding.evidenceSpans;

    return [
      {
        findingId: finding.id,
        code: finding.code,
        title: decision.editedTitle ?? finding.title,
        summary: decision.editedSummary ?? finding.summary,
        reviewDecisionId: decision.id,
        evidenceExcerpts: approvedEvidenceSpans.map((span) => ({
          sourceEvidenceSpanId: span.id,
          sourceTranscriptSegmentId: span.transcriptSegmentId,
          excerpt: span.excerpt,
          startOffsetMs: span.startOffsetMs,
          endOffsetMs: span.endOffsetMs,
        })),
      },
    ];
  });

  if (findings.length === 0) {
    throw new Error("At least one accepted or edited finding is required for export.");
  }

  const approvedAt = new Date().toISOString();
  const status = input.status ?? "approved";

  return {
    id: `export-${randomUUID()}`,
    sessionId: bundle.session.id,
    status,
    summary:
      findings.length === 1
        ? `Approved export for ${findings[0]?.title ?? "reviewed finding"}.`
        : `Approved export containing ${findings.length} reviewed findings.`,
    findings,
    approvedBy: DESKTOP_REVIEWER_ID,
    approvedAt,
    destination: input.destination ?? "manual-review-hold",
    sentAt: status === "sent" ? approvedAt : undefined,
  };
}

function buildApprovedExportEnvelope(
  bundle: DesktopSessionBundle,
  approvedExport: ApprovedExport
): ApprovedExportEnvelope {
  return {
    id: approvedExport.id,
    session: {
      localSessionId: bundle.session.id,
      clinicianId: bundle.session.clinicianId,
      encounterStartedAt: bundle.session.encounterStartedAt,
      encounterEndedAt: bundle.session.encounterEndedAt,
      captureMode: bundle.session.captureMode,
    },
    consent: {
      recordedWithConsent: bundle.session.consent.recordedWithConsent,
      exportAllowed: bundle.session.consent.exportAllowed,
      remoteAssistAllowed: bundle.session.consent.remoteAssistAllowed,
      policyVersion: bundle.session.consent.policyVersion,
    },
    export: approvedExport,
    attestation: {
      reviewedBy: DESKTOP_REVIEWER_ID,
      reviewCompletedAt: bundle.session.updatedAt,
      clientVersion: app.getVersion(),
      localBundleHash: createHash("sha256")
        .update(JSON.stringify(bundle))
        .digest("hex"),
      assistReceiptIds: bundle.modelAssistReceipts.map((receipt) => receipt.id),
    },
  };
}

function normalizeErrorCode(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "assist-request-failed";
  return message
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function registerIpcHandlers(): void {
  ipcMain.handle("audio:start-recording", async (_event, request?: SessionIntakeRequest) => {
    if (!audioCapture) throw new Error("Audio capture not initialized");
    if (!db) throw new Error("Database not initialized");

    const intake = getValidatedIntake(request);
    const startedAt = new Date().toISOString();
    const recording = await audioCapture.startRecording();

    try {
      const session = db.createLiveCaptureSession({
        ...intake,
        startedAt,
        audioPath: recording.sessionPath,
      });
      activeRecordingSessionId = session.session.id;
      emitSessionChanged(session);
      return {
        sessionPath: recording.sessionPath,
        session,
      };
    } catch (error) {
      await audioCapture.stopRecording().catch(() => undefined);
      throw error;
    }
  });

  ipcMain.handle("audio:stop-recording", async () => {
    if (!audioCapture) throw new Error("Audio capture not initialized");
    if (!db) throw new Error("Database not initialized");
    if (!activeRecordingSessionId) {
      throw new Error("No active live capture session.");
    }

    const sessionId = activeRecordingSessionId;
    try {
      const stoppedRecording = await audioCapture.stopRecording();
      activeRecordingSessionId = null;

      const finalizedSession = db.finalizeLiveCaptureSession(sessionId, {
        endedAt: new Date().toISOString(),
        audioPath: stoppedRecording.filePath,
      });

      if (finalizedSession) {
        emitSessionChanged(finalizedSession);
      }

      const queuedSummary = queueTranscription(
        sessionId,
        stoppedRecording.filePath,
        "live_capture"
      );

      return {
        filePath: stoppedRecording.filePath,
        duration: stoppedRecording.duration,
        session: queuedSummary ?? finalizedSession,
      };
    } catch (error) {
      if (activeRecordingSessionId === sessionId) {
        failActiveRecordingSession(
          error instanceof Error
            ? error.message
            : "Live capture could not be finalized."
        );
      }

      throw error;
    }
  });

  ipcMain.handle("audio:get-devices", async () => {
    if (!audioCapture) throw new Error("Audio capture not initialized");
    return audioCapture.getDevices();
  });

  ipcMain.handle("audio:get-capture-status", async () => {
    if (!audioCapture) throw new Error("Audio capture not initialized");
    return audioCapture.getCaptureStatus();
  });

  ipcMain.handle("session:get-all", async () => {
    if (!db) throw new Error("Database not initialized");
    return db.getAllSessions();
  });

  ipcMain.handle("session:get", async (_event, sessionId: string) => {
    if (!db) throw new Error("Database not initialized");
    return db.getSession(sessionId);
  });

  ipcMain.handle(
    "session:save-review-decision",
    async (_event, request: PersistReviewDecisionRequest) => {
      if (!db) throw new Error("Database not initialized");

      const sessionBundle = db.saveReviewDecision({
        ...request,
        reviewedBy: DESKTOP_REVIEWER_ID,
      });
      const sessionSummary = db.getSessionSummary(request.sessionId);
      if (sessionSummary) {
        emitSessionChanged(sessionSummary);
      }
      return sessionBundle;
    }
  );

  ipcMain.handle(
    "session:request-seriousness-assist",
    async (
      _event,
      request: RequestSeriousnessAssistRequest
    ): Promise<RequestSeriousnessAssistResult> => {
      if (!db) throw new Error("Database not initialized");
      if (!cloudSync) throw new Error("Cloud sync client unavailable");

      const bundle = getSessionBundleOrThrow(request.sessionId);
      if (!bundle.session.consent.remoteAssistAllowed) {
        throw new Error(
          "Remote assist is not permitted for this session."
        );
      }

      const finding = getFindingOrThrow(bundle, request.findingId);
      const assistRequest = buildModelAssistRequest(bundle, finding);
      const syncErrors: string[] = [];

      db.recordModelAssistRequested(assistRequest);
      const requestedSyncError = await postOpsEventBestEffort(
        buildOpsEvent({
          sessionId: assistRequest.sessionId,
          assistReceiptId: assistRequest.id,
          type: "assist_requested",
          policyMode: assistRequest.policyMode,
        })
      );
      if (requestedSyncError) {
        syncErrors.push(requestedSyncError);
      }

      const startedAt = Date.now();

      try {
        const assessment =
          await cloudSync.requestSeriousnessAssessment(assistRequest);
        const receipt = buildAssistReceipt(
          assistRequest,
          assessment,
          Date.now() - startedAt
        );
        const nextBundle = db.saveModelAssistReceipt({
          request: assistRequest,
          receipt,
        });
        const completedSyncError = await postOpsEventBestEffort(
          buildOpsEvent({
            sessionId: assistRequest.sessionId,
            assistReceiptId: receipt.id,
            type: "assist_completed",
            provider: assessment.provider,
            model: assessment.model,
            policyMode: receipt.policyMode,
            latencyMs: receipt.latencyMs,
          })
        );
        if (completedSyncError) {
          syncErrors.push(completedSyncError);
        }

        const sessionSummary = db.getSessionSummary(request.sessionId);
        if (sessionSummary) {
          emitSessionChanged(sessionSummary);
        }

        return {
          bundle: nextBundle,
          receipt,
          synced: syncErrors.length === 0,
          syncError:
            syncErrors.length > 0 ? syncErrors.join("; ") : undefined,
        };
      } catch (error) {
        const receipt = buildFailedAssistReceipt(
          assistRequest,
          error,
          Date.now() - startedAt
        );
        const nextBundle = db.saveModelAssistReceipt({
          request: assistRequest,
          receipt,
        });
        const failedSyncError = await postOpsEventBestEffort(
          buildOpsEvent({
            sessionId: assistRequest.sessionId,
            assistReceiptId: receipt.id,
            type: "assist_failed",
            policyMode: receipt.policyMode,
            latencyMs: receipt.latencyMs,
            errorCode: receipt.errorCode,
          })
        );
        if (failedSyncError) {
          syncErrors.push(failedSyncError);
        }

        const sessionSummary = db.getSessionSummary(request.sessionId);
        if (sessionSummary) {
          emitSessionChanged(sessionSummary);
        }

        return {
          bundle: nextBundle,
          receipt,
          synced: syncErrors.length === 0,
          syncError:
            syncErrors.length > 0 ? syncErrors.join("; ") : undefined,
        };
      }
    }
  );

  ipcMain.handle(
    "session:update-model-assist-action",
    async (_event, request: UpdateModelAssistActionRequest) => {
      if (!db) throw new Error("Database not initialized");

      const nextBundle = db.updateModelAssistReviewerAction(request);

      if (request.reviewerAction === "dismissed") {
        await postOpsEventBestEffort(
          buildOpsEvent({
            sessionId: request.sessionId,
            assistReceiptId: request.receiptId,
            type: "assist_overridden",
            reviewerAction: request.reviewerAction,
          })
        );
      }

      const sessionSummary = db.getSessionSummary(request.sessionId);
      if (sessionSummary) {
        emitSessionChanged(sessionSummary);
      }

      return nextBundle;
    }
  );

  ipcMain.handle(
    "session:create-approved-export",
    async (
      _event,
      request: CreateApprovedExportRequest
    ): Promise<CreateApprovedExportResult> => {
      if (!db) throw new Error("Database not initialized");

      const bundle = getSessionBundleOrThrow(request.sessionId);
      const approvedExport = buildApprovedExport(bundle, {
        destination: request.destination,
        status: request.status,
      });
      const nextBundle = db.saveApprovedExport(approvedExport);
      if (!nextBundle) {
        throw new Error("The approved export could not be persisted locally.");
      }

      const envelope = buildApprovedExportEnvelope(nextBundle, approvedExport);
      const syncErrors: string[] = [];

      if (cloudSync) {
        try {
          await cloudSync.postApprovedExport(envelope);
        } catch (error) {
          syncErrors.push(
            error instanceof Error
              ? error.message
              : "Unable to sync approved export."
          );
        }
      } else {
        syncErrors.push("Cloud sync client unavailable.");
      }

      const exportSyncError = await postOpsEventBestEffort(
        buildOpsEvent({
          sessionId: request.sessionId,
          exportId: approvedExport.id,
          type: approvedExport.status === "sent" ? "export_sent" : "export_approved",
        })
      );
      if (exportSyncError) {
        syncErrors.push(exportSyncError);
      }

      const sessionSummary = db.getSessionSummary(request.sessionId);
      if (sessionSummary) {
        emitSessionChanged(sessionSummary);
      }

      return {
        bundle: nextBundle,
        envelope,
        synced: syncErrors.length === 0,
        syncError: syncErrors.length > 0 ? syncErrors.join("; ") : undefined,
      };
    }
  );

  ipcMain.handle(
    "session:import-audio",
    async (_event, request?: SessionIntakeRequest) => {
      if (!mainWindow) throw new Error("Main window not initialized");
      if (!db) throw new Error("Database not initialized");

      const intake = getValidatedIntake(request);

      const selection = await dialog.showOpenDialog(mainWindow, {
        title: "Import Encounter Audio",
        properties: ["openFile"],
        filters: [
          {
            name: "Audio Files",
            extensions: ["wav", "mp3", "m4a", "aac", "flac", "ogg", "webm"],
          },
        ],
      });

      if (selection.canceled || selection.filePaths.length === 0) {
        return { cancelled: true as const };
      }

      const sourcePath = selection.filePaths[0];
      const fileName = path.basename(sourcePath);
      const importsDir = path.join(app.getPath("userData"), "imports");
      const extension = path.extname(sourcePath);
      const targetPath = path.join(
        importsDir,
        `import-${Date.now()}${extension.toLowerCase()}`
      );

      emitImportProgress({
        stage: "selected",
        message: "Audio selected. Preparing local copy.",
        fileName,
      });

      try {
        await fs.mkdir(importsDir, { recursive: true });

        emitImportProgress({
          stage: "copying",
          message: "Copying audio into the local workspace.",
          fileName,
        });
        const sourceStats = await fs.stat(sourcePath);
        await fs.copyFile(sourcePath, targetPath);

        emitImportProgress({
          stage: "creating-session",
          message: "Creating a review session shell.",
          fileName,
        });
        const session = db.createImportedSession({
          ...intake,
          audioPath: targetPath,
          capturedAt: sourceStats.mtime.toISOString(),
          sourceFileName: fileName,
        });

        emitSessionChanged(session);
        const queuedSummary = queueTranscription(
          session.session.id,
          targetPath,
          "audio_import"
        );

        emitImportProgress({
          stage: "completed",
          message: "Import complete. Review session created and transcription queued.",
          fileName,
          sessionId: session.session.id,
        });

        return {
          cancelled: false as const,
          session: queuedSummary ?? session,
        };
      } catch (error) {
        emitImportProgress({
          stage: "error",
          message:
            error instanceof Error
              ? error.message
              : "Import failed while preparing the encounter.",
          fileName,
        });
        throw error;
      }
    }
  );
}

app.whenReady()
  .then(async () => {
    await initializeServices();
    registerIpcHandlers();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  })
  .catch((error) => {
    const message =
      error instanceof Error
        ? error.message
        : "Electron failed to initialize.";
    console.error("Desktop startup failed:", error);
    dialog.showErrorBox("Doctor Auditor failed to start", message);
    app.quit();
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  void reviewRuntime?.dispose();
});
