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
const crypto_1 = require("crypto");
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const audio_capture_1 = require("./audio-capture");
const cloud_sync_1 = require("./cloud-sync");
const database_1 = require("./database");
const review_ml_1 = require("./review-ml");
const review_runtime_1 = require("./review-runtime");
const DESKTOP_REVIEWER_ID = "desktop";
let mainWindow = null;
let audioCapture = null;
let cloudSync = null;
let db = null;
let reviewRuntime = null;
let activeRecordingSessionId = null;
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
    cloudSync = new cloud_sync_1.CloudSyncClient();
    reviewRuntime = new review_runtime_1.ReviewRuntimeService(new review_ml_1.PythonReviewMlClient());
    // Keep Electron main limited to IPC and persistence. STT, diarization,
    // and review-analysis belong behind the Python review-ML boundary, not here.
    reviewRuntime.on("transcription-completed", ({ job, segments }) => {
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
    });
    reviewRuntime.on("transcription-failed", ({ error, job }) => {
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
    });
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
        remoteAssistAllowed: request.remoteAssistAllowed,
        policyVersion: request.policyVersion,
    };
}
function getSessionBundleOrThrow(sessionId) {
    if (!db) {
        throw new Error("Database not initialized");
    }
    const bundle = db.getSession(sessionId);
    if (!bundle) {
        throw new Error("The selected review session no longer exists.");
    }
    return bundle;
}
function getFindingOrThrow(bundle, findingId) {
    const finding = bundle.findings.find((item) => item.id === findingId);
    if (!finding) {
        throw new Error("The selected finding no longer exists.");
    }
    return finding;
}
function buildMinimizedConcernPacket(bundle, finding) {
    if (finding.evidenceSpans.length === 0) {
        throw new Error("Remote second opinion requires at least one linked evidence span.");
    }
    const speakerLabels = Array.from(new Set(finding.evidenceSpans
        .map((span) => bundle.transcriptSegments.find((segment) => segment.id === span.transcriptSegmentId)?.speakerLabel)
        .filter((value) => typeof value === "string")));
    const encounterStartedAt = Date.parse(bundle.session.encounterStartedAt);
    const encounterEndedAt = Date.parse(bundle.session.encounterEndedAt ?? bundle.session.encounterStartedAt);
    const encounterDurationMs = Number.isNaN(encounterStartedAt) || Number.isNaN(encounterEndedAt)
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
function buildModelAssistRequest(bundle, finding) {
    const requestedAt = new Date().toISOString();
    return {
        id: `assist-request-${(0, crypto_1.randomUUID)()}`,
        sessionId: bundle.session.id,
        findingId: finding.id,
        requestedBy: DESKTOP_REVIEWER_ID,
        requestedAt,
        policyVersion: bundle.session.consent.policyVersion,
        policyMode: "minimized_no_raw_phi",
        concern: buildMinimizedConcernPacket(bundle, finding),
    };
}
function buildAssistReceipt(request, assessment, latencyMs) {
    return {
        id: `assist-receipt-${(0, crypto_1.randomUUID)()}`,
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
function buildFailedAssistReceipt(request, error, latencyMs) {
    return {
        id: `assist-receipt-${(0, crypto_1.randomUUID)()}`,
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
function buildOpsEvent(payload) {
    return {
        id: `ops-${(0, crypto_1.randomUUID)()}`,
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
async function postOpsEventBestEffort(event) {
    if (!cloudSync) {
        return "Cloud sync client unavailable.";
    }
    try {
        await cloudSync.postOpsEvent(event);
        return null;
    }
    catch (error) {
        return error instanceof Error ? error.message : "Unable to sync ops event.";
    }
}
function buildApprovedExport(bundle, input) {
    if (!bundle.session.consent.exportAllowed) {
        throw new Error("This session is not approved for cloud export.");
    }
    if (bundle.session.reviewStatus !== "completed") {
        throw new Error("Complete local review before creating an approved export.");
    }
    const decisionsById = new Map(bundle.reviewDecisions.map((decision) => [decision.id, decision]));
    const findings = bundle.findings.flatMap((finding) => {
        if (!finding.reviewDecisionId) {
            return [];
        }
        const decision = decisionsById.get(finding.reviewDecisionId);
        if (!decision || (decision.outcome !== "accepted" && decision.outcome !== "edited")) {
            return [];
        }
        const approvedEvidenceSpans = decision.approvedEvidenceSpans ?? finding.evidenceSpans;
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
        id: `export-${(0, crypto_1.randomUUID)()}`,
        sessionId: bundle.session.id,
        status,
        summary: findings.length === 1
            ? `Approved export for ${findings[0]?.title ?? "reviewed finding"}.`
            : `Approved export containing ${findings.length} reviewed findings.`,
        findings,
        approvedBy: DESKTOP_REVIEWER_ID,
        approvedAt,
        destination: input.destination ?? "manual-review-hold",
        sentAt: status === "sent" ? approvedAt : undefined,
    };
}
function buildApprovedExportEnvelope(bundle, approvedExport) {
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
            clientVersion: electron_1.app.getVersion(),
            localBundleHash: (0, crypto_1.createHash)("sha256")
                .update(JSON.stringify(bundle))
                .digest("hex"),
            assistReceiptIds: bundle.modelAssistReceipts.map((receipt) => receipt.id),
        },
    };
}
function normalizeErrorCode(error) {
    const message = error instanceof Error ? error.message : "assist-request-failed";
    return message
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
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
    electron_1.ipcMain.handle("session:request-seriousness-assist", async (_event, request) => {
        if (!db)
            throw new Error("Database not initialized");
        if (!cloudSync)
            throw new Error("Cloud sync client unavailable");
        const bundle = getSessionBundleOrThrow(request.sessionId);
        if (!bundle.session.consent.remoteAssistAllowed) {
            throw new Error("Remote second opinion is not permitted for this session.");
        }
        const finding = getFindingOrThrow(bundle, request.findingId);
        const assistRequest = buildModelAssistRequest(bundle, finding);
        const syncErrors = [];
        db.recordModelAssistRequested(assistRequest);
        const requestedSyncError = await postOpsEventBestEffort(buildOpsEvent({
            sessionId: assistRequest.sessionId,
            assistReceiptId: assistRequest.id,
            type: "assist_requested",
            policyMode: assistRequest.policyMode,
        }));
        if (requestedSyncError) {
            syncErrors.push(requestedSyncError);
        }
        const startedAt = Date.now();
        try {
            const assessment = await cloudSync.requestSeriousnessAssessment(assistRequest);
            const receipt = buildAssistReceipt(assistRequest, assessment, Date.now() - startedAt);
            const nextBundle = db.saveModelAssistReceipt({
                request: assistRequest,
                receipt,
            });
            const completedSyncError = await postOpsEventBestEffort(buildOpsEvent({
                sessionId: assistRequest.sessionId,
                assistReceiptId: receipt.id,
                type: "assist_completed",
                provider: assessment.provider,
                model: assessment.model,
                policyMode: receipt.policyMode,
                latencyMs: receipt.latencyMs,
            }));
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
                syncError: syncErrors.length > 0 ? syncErrors.join("; ") : undefined,
            };
        }
        catch (error) {
            const receipt = buildFailedAssistReceipt(assistRequest, error, Date.now() - startedAt);
            const nextBundle = db.saveModelAssistReceipt({
                request: assistRequest,
                receipt,
            });
            const failedSyncError = await postOpsEventBestEffort(buildOpsEvent({
                sessionId: assistRequest.sessionId,
                assistReceiptId: receipt.id,
                type: "assist_failed",
                policyMode: receipt.policyMode,
                latencyMs: receipt.latencyMs,
                errorCode: receipt.errorCode,
            }));
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
                syncError: syncErrors.length > 0 ? syncErrors.join("; ") : undefined,
            };
        }
    });
    electron_1.ipcMain.handle("session:update-model-assist-action", async (_event, request) => {
        if (!db)
            throw new Error("Database not initialized");
        const nextBundle = db.updateModelAssistReviewerAction(request);
        if (request.reviewerAction === "dismissed") {
            await postOpsEventBestEffort(buildOpsEvent({
                sessionId: request.sessionId,
                assistReceiptId: request.receiptId,
                type: "assist_overridden",
                reviewerAction: request.reviewerAction,
            }));
        }
        const sessionSummary = db.getSessionSummary(request.sessionId);
        if (sessionSummary) {
            emitSessionChanged(sessionSummary);
        }
        return nextBundle;
    });
    electron_1.ipcMain.handle("session:create-approved-export", async (_event, request) => {
        if (!db)
            throw new Error("Database not initialized");
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
        const syncErrors = [];
        if (cloudSync) {
            try {
                await cloudSync.postApprovedExport(envelope);
            }
            catch (error) {
                syncErrors.push(error instanceof Error
                    ? error.message
                    : "Unable to sync approved export.");
            }
        }
        else {
            syncErrors.push("Cloud sync client unavailable.");
        }
        const exportSyncError = await postOpsEventBestEffort(buildOpsEvent({
            sessionId: request.sessionId,
            exportId: approvedExport.id,
            type: approvedExport.status === "sent" ? "export_sent" : "export_approved",
        }));
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
    void reviewRuntime?.dispose();
});
