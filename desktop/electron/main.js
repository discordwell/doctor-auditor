"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const audio_capture_1 = require("./audio-capture");
const database_1 = require("./database");
const transcription_1 = require("./transcription");
const DESKTOP_REVIEWER_ID = "desktop";
let mainWindow = null;
let audioCapture = null;
let db = null;
let transcription = null;
let activeRecordingSessionId = null;
let transcriptionQueue = Promise.resolve();
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
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
async function loadWindowContent(window) {
    const bundledIndexPath = path.join(__dirname, "../dist/index.html");
    const rendererUrl = process.env.DOCTOR_AUDITOR_RENDERER_URL ?? "http://localhost:5173";
    if (!electron_1.app.isPackaged) {
        await window.loadURL(rendererUrl);
        window.webContents.openDevTools();
        return;
    }
    await window.loadFile(bundledIndexPath);
}
async function initializeServices() {
    const userDataPath = electron_1.app.getPath("userData");
    db = new database_1.LocalDatabase(path.join(userDataPath, "doctor-auditor.db"));
    audioCapture = new audio_capture_1.AudioCapture();
    transcription = new transcription_1.TranscriptionService();
    audioCapture.on("level", (level) => {
        mainWindow?.webContents.send("audio:level", level);
    });
    audioCapture.on("capture-error", (message) => {
        failActiveRecordingSession(message);
    });
}
function emitImportProgress(payload) {
    mainWindow?.webContents.send("session:import-progress", payload);
}
function emitSessionChanged(sessionSummary) {
    mainWindow?.webContents.send("session:changed", sessionSummary);
}
function emitLiveCaptureError(payload) {
    mainWindow?.webContents.send("audio:capture-error", payload);
}
function failActiveRecordingSession(message) {
    if (!db || !activeRecordingSessionId) {
        emitLiveCaptureError({
            message,
            session: null,
        });
        return null;
    }
    const failedSummary = db.failLiveCaptureSession(activeRecordingSessionId, new Date().toISOString());
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
function queueTranscription(sessionId, audioPath, source) {
    if (!db) {
        return null;
    }
    const queuedSummary = db.updateSession(sessionId, {
        transcriptStatus: "in_progress",
    });
    if (queuedSummary) {
        emitSessionChanged(queuedSummary);
    }
    transcriptionQueue = transcriptionQueue
        .catch(() => undefined)
        .then(async () => {
        if (!db || !transcription) {
            throw new Error("Transcription service unavailable.");
        }
        const modelAvailable = await transcription.isModelAvailable();
        if (!modelAvailable) {
            throw new Error("Local transcription model not found.");
        }
        const segments = await transcription.transcribeFile(audioPath, sessionId, source);
        db.replaceTranscriptSegments(sessionId, segments);
        const completedSummary = db.updateSession(sessionId, {
            transcriptStatus: segments.length > 0 ? "completed" : "failed",
            reviewStatus: segments.length > 0 ? "ready" : "not_started",
        });
        if (completedSummary) {
            emitSessionChanged(completedSummary);
        }
    })
        .catch((error) => {
        console.error("Transcription pipeline failed:", error);
        if (!db) {
            return;
        }
        const failedSummary = db.updateSession(sessionId, {
            transcriptStatus: "failed",
        });
        if (failedSummary) {
            emitSessionChanged(failedSummary);
        }
    });
    return queuedSummary;
}
function getValidatedIntake(request) {
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
function registerIpcHandlers() {
    electron_1.ipcMain.handle("audio:start-recording", async (_event, request) => {
        if (!audioCapture)
            throw new Error("Audio capture not initialized");
        if (!db)
            throw new Error("Database not initialized");
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
        }
        catch (error) {
            await audioCapture.stopRecording().catch(() => undefined);
            throw error;
        }
    });
    electron_1.ipcMain.handle("audio:stop-recording", async () => {
        if (!audioCapture)
            throw new Error("Audio capture not initialized");
        if (!db)
            throw new Error("Database not initialized");
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
            const queuedSummary = queueTranscription(sessionId, stoppedRecording.filePath, "live_capture");
            return {
                filePath: stoppedRecording.filePath,
                duration: stoppedRecording.duration,
                session: queuedSummary ?? finalizedSession,
            };
        }
        catch (error) {
            if (activeRecordingSessionId === sessionId) {
                failActiveRecordingSession(error instanceof Error
                    ? error.message
                    : "Live capture could not be finalized.");
            }
            throw error;
        }
    });
    electron_1.ipcMain.handle("audio:get-devices", async () => {
        if (!audioCapture)
            throw new Error("Audio capture not initialized");
        return audioCapture.getDevices();
    });
    electron_1.ipcMain.handle("audio:get-capture-status", async () => {
        if (!audioCapture)
            throw new Error("Audio capture not initialized");
        return audioCapture.getCaptureStatus();
    });
    electron_1.ipcMain.handle("session:get-all", async () => {
        if (!db)
            throw new Error("Database not initialized");
        return db.getAllSessions();
    });
    electron_1.ipcMain.handle("session:get", async (_event, sessionId) => {
        if (!db)
            throw new Error("Database not initialized");
        return db.getSession(sessionId);
    });
    electron_1.ipcMain.handle("session:save-review-decision", async (_event, request) => {
        if (!db)
            throw new Error("Database not initialized");
        const sessionBundle = db.saveReviewDecision({
            ...request,
            reviewedBy: DESKTOP_REVIEWER_ID,
        });
        const sessionSummary = db.getSessionSummary(request.sessionId);
        if (sessionSummary) {
            emitSessionChanged(sessionSummary);
        }
        return sessionBundle;
    });
    electron_1.ipcMain.handle("session:import-audio", async (_event, request) => {
        if (!mainWindow)
            throw new Error("Main window not initialized");
        if (!db)
            throw new Error("Database not initialized");
        const intake = getValidatedIntake(request);
        const selection = await electron_1.dialog.showOpenDialog(mainWindow, {
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
            return { cancelled: true };
        }
        const sourcePath = selection.filePaths[0];
        const fileName = path.basename(sourcePath);
        const importsDir = path.join(electron_1.app.getPath("userData"), "imports");
        const extension = path.extname(sourcePath);
        const targetPath = path.join(importsDir, `import-${Date.now()}${extension.toLowerCase()}`);
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
            const queuedSummary = queueTranscription(session.session.id, targetPath, "audio_import");
            emitImportProgress({
                stage: "completed",
                message: "Import complete. Review session created and transcription queued.",
                fileName,
                sessionId: session.session.id,
            });
            return {
                cancelled: false,
                session: queuedSummary ?? session,
            };
        }
        catch (error) {
            emitImportProgress({
                stage: "error",
                message: error instanceof Error
                    ? error.message
                    : "Import failed while preparing the encounter.",
                fileName,
            });
            throw error;
        }
    });
}
electron_1.app.whenReady()
    .then(async () => {
    await initializeServices();
    registerIpcHandlers();
    createWindow();
    electron_1.app.on("activate", () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
})
    .catch((error) => {
    const message = error instanceof Error
        ? error.message
        : "Electron failed to initialize.";
    console.error("Desktop startup failed:", error);
    electron_1.dialog.showErrorBox("Doctor Auditor failed to start", message);
    electron_1.app.quit();
});
electron_1.app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        electron_1.app.quit();
    }
});
electron_1.app.on("before-quit", () => {
    void transcription?.dispose();
});
