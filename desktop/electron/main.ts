import { app, BrowserWindow, dialog, ipcMain } from "electron";
import * as fs from "fs/promises";
import * as path from "path";
import type { TranscriptSegment } from "@doctor-auditor/shared";
import { AudioCapture } from "./audio-capture";
import { LocalDatabase } from "./database";
import {
  ReviewRuntimeService,
  type ReviewRuntimeTranscriptionCompleted,
  type ReviewRuntimeTranscriptionFailed,
} from "./review-runtime";
import type {
  DesktopSessionSummary,
  PersistReviewDecisionRequest,
  SessionIntakeRequest,
} from "./review-models";

const DESKTOP_REVIEWER_ID = "desktop";

let mainWindow: BrowserWindow | null = null;
let audioCapture: AudioCapture | null = null;
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
  reviewRuntime = new ReviewRuntimeService();

  // Keep Electron main limited to IPC and persistence. Future STT,
  // diarization, or review-analysis steps belong behind ReviewRuntimeService
  // and its worker-backed adapters, not as more model orchestration in main.ts.
  reviewRuntime.on(
    "transcription-completed",
    ({ job, segments }: ReviewRuntimeTranscriptionCompleted) => {
      if (!db) {
        return;
      }

      db.replaceTranscriptSegments(job.sessionId, segments);

      const completedSummary = db.updateSession(job.sessionId, {
        transcriptStatus: segments.length > 0 ? "completed" : "failed",
        reviewStatus: segments.length > 0 ? "ready" : "not_started",
      });

      if (completedSummary) {
        emitSessionChanged(completedSummary);
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
  };
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
