import { app, BrowserWindow, dialog, ipcMain } from "electron";
import * as fs from "fs/promises";
import * as path from "path";
import type { TranscriptSegment } from "@doctor-auditor/shared/local-review";
import type { OpsEvent } from "@doctor-auditor/shared/cloud";
import { AudioCapture } from "./audio-capture";
import { resolveCloudSyncConfig } from "./cloud-config";
import { CloudSyncClient } from "./cloud-sync";
import { LocalDatabase } from "./database";
import { buildModelAssistRequest } from "./model-assist";
import {
  buildApprovedExport,
  buildApprovedExportEnvelope,
  buildAssistReceipt,
  buildFailedAssistReceipt,
  buildOpsEvent,
  DESKTOP_REVIEWER_ID,
  newAssistReceiptId,
} from "./session-artifacts";
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
import {
  canAutoRecoverTranscription,
  canManuallyRetryTranscription,
} from "./transcription-recovery";

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
  const cloudSyncConfig = resolveCloudSyncConfig({
    env: process.env,
  });

  db = new LocalDatabase(path.join(userDataPath, "doctor-auditor.db"));
  audioCapture = new AudioCapture();
  cloudSync = new CloudSyncClient(cloudSyncConfig);
  reviewRuntime = new ReviewRuntimeService(new PythonReviewMlClient());

  // Keep Electron main limited to IPC and persistence. STT, diarization,
  // and review-analysis belong behind the Python review-ML boundary, not here.
  reviewRuntime.on(
    "transcription-completed",
    ({ job, segments }: ReviewRuntimeTranscriptionCompleted) => {
      if (!db) {
        return;
      }
      if (!hasPersistedSession(job.sessionId)) {
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
      if (!hasPersistedSession(job.sessionId)) {
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
      if (!db) {
        return;
      }
      if (!hasPersistedSession(job.sessionId)) {
        return;
      }

      console.error("Transcript analysis pipeline failed:", error);

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
      if (!db) {
        return;
      }
      if (!hasPersistedSession(job.sessionId)) {
        return;
      }

      console.error("Transcription pipeline failed:", error);

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

function getTranscriptSource(
  sessionSummary: DesktopSessionSummary
): TranscriptSegment["source"] {
  return sessionSummary.session.captureMode === "live_capture"
    ? "live_capture"
    : "audio_import";
}

function markTranscriptFailure(
  sessionId: string,
  error?: unknown
): DesktopSessionSummary | null {
  if (!db) {
    return null;
  }

  if (error) {
    console.error("Transcription recovery failed:", error);
  }

  const failedSummary = db.updateSession(sessionId, {
    transcriptStatus: "failed",
  });

  if (failedSummary) {
    emitSessionChanged(failedSummary);
  }

  return failedSummary;
}

async function resolveSessionAudioPath(
  sessionSummary: DesktopSessionSummary
): Promise<string> {
  if (!sessionSummary.audioPath) {
    throw new Error("This session no longer has local audio to transcribe.");
  }

  try {
    await fs.access(sessionSummary.audioPath);
  } catch {
    throw new Error("The local audio file for this session is missing.");
  }

  return sessionSummary.audioPath;
}

async function retrySessionTranscription(
  sessionId: string
): Promise<DesktopSessionSummary | null> {
  if (!db) {
    throw new Error("Database not initialized");
  }

  const sessionSummary = db.getSessionSummary(sessionId);
  if (!sessionSummary) {
    throw new Error("The selected review session no longer exists.");
  }

  if (!canManuallyRetryTranscription(sessionSummary)) {
    throw new Error(
      "Only failed sessions with saved local audio can be retried."
    );
  }

  const audioPath = await resolveSessionAudioPath(sessionSummary);
  return queueTranscription(
    sessionId,
    audioPath,
    getTranscriptSource(sessionSummary)
  );
}

async function resumePendingTranscriptions(): Promise<void> {
  if (!db) {
    return;
  }

  const userDataPath = app.getPath("userData");
  const recoverableSessions = db
    .getAllSessions()
    .filter((sessionSummary) =>
      canAutoRecoverTranscription(sessionSummary, userDataPath)
    )
    .sort((left, right) => {
      return (
        Date.parse(left.session.createdAt) - Date.parse(right.session.createdAt)
      );
    });

  for (const sessionSummary of recoverableSessions) {
    try {
      const audioPath = await resolveSessionAudioPath(sessionSummary);
      queueTranscription(
        sessionSummary.session.id,
        audioPath,
        getTranscriptSource(sessionSummary)
      );
    } catch (error) {
      console.warn(
        `Unable to resume transcript processing for ${sessionSummary.session.id}:`,
        error
      );
      markTranscriptFailure(sessionSummary.session.id, error);
    }
  }
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

function hasPersistedSession(sessionId: string): boolean {
  if (!db) {
    return false;
  }

  return db.getSessionSummary(sessionId) !== null;
}

function getFindingOrThrow(bundle: DesktopSessionBundle, findingId: string) {
  const finding = bundle.findings.find((item) => item.id === findingId);
  if (!finding) {
    throw new Error("The selected finding no longer exists.");
  }
  return finding;
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
      throw new Error("No active recording session.");
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
            : "Recording could not be finalized."
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

  ipcMain.handle("cloud:get-config", async () => {
    if (!cloudSync) throw new Error("Cloud sync client unavailable");
    return cloudSync.getConfiguration();
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
    "session:retry-transcription",
    async (_event, sessionId: string) => {
      return retrySessionTranscription(sessionId);
    }
  );

  ipcMain.handle("session:delete", async (_event, sessionId: string) => {
    if (!db) throw new Error("Database not initialized");
    if (activeRecordingSessionId === sessionId) {
      throw new Error("Stop the active recording before deleting this session.");
    }

    const deletedSession = db.deleteSession(sessionId);
    if (!deletedSession) {
      throw new Error("The selected review session no longer exists.");
    }

    if (deletedSession.audioPath) {
      try {
        await fs.rm(deletedSession.audioPath, { force: true });
      } catch (error) {
        console.warn("Unable to remove deleted session audio:", error);
      }
    }
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
      const finding = request.findingId
        ? getFindingOrThrow(bundle, request.findingId)
        : undefined;
      const assistRequest = buildModelAssistRequest(bundle, finding);
      // Mint the receipt id up front and reuse it for the assist_requested ops
      // event and the eventual receipt (completed or failed). This keeps the
      // whole assist lifecycle correlatable by assistReceiptId; the requested
      // event used to carry the request id, which never matched the receipt.
      const assistReceiptId = newAssistReceiptId();
      const syncErrors: string[] = [];

      db.recordModelAssistRequested(assistRequest);
      const requestedSyncError = await postOpsEventBestEffort(
        buildOpsEvent({
          sessionId: assistRequest.sessionId,
          assistReceiptId,
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
          Date.now() - startedAt,
          assistReceiptId
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
            assessment,
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
          Date.now() - startedAt,
          assistReceiptId
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

      const envelope = buildApprovedExportEnvelope(
        nextBundle,
        approvedExport,
        app.getVersion()
      );
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
    void resumePendingTranscriptions();

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
