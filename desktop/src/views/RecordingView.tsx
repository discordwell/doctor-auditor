import React, { useCallback, useEffect, useRef, useState } from "react";
import type { CaptureMode } from "@doctor-auditor/shared";
import type {
  ReviewStatus,
  TranscriptStatus,
} from "@doctor-auditor/shared/local-review";
import type {
  DesktopSessionSummary,
  LiveCaptureStatus,
  SessionImportProgress,
  SessionIntakeRequest,
} from "../types/electron";

type ImportStage = "idle" | "cancelled" | SessionImportProgress["stage"];
type LiveCaptureNoticeTone = "info" | "active" | "success" | "error";
type CaptureTransition = "idle" | "starting" | "stopping";

interface LiveCaptureNotice {
  tone: LiveCaptureNoticeTone;
  message: string;
}

const IMPORT_STEPS: Array<{
  key: SessionImportProgress["stage"];
  label: string;
}> = [
  { key: "selected", label: "Audio selected" },
  { key: "copying", label: "Local copy created" },
  { key: "creating-session", label: "Review session created" },
  { key: "completed", label: "Transcription queued" },
];

const IMPORT_STEP_ORDER = IMPORT_STEPS.reduce<Record<string, number>>(
  (accumulator, step, index) => {
    accumulator[step.key] = index;
    return accumulator;
  },
  {}
);

const DEFAULT_LIVE_CAPTURE_NOTICE: LiveCaptureNotice = {
  tone: "info",
  message:
    "Import audio is the recommended demo path. Live capture remains experimental and uses the system default microphone only.",
};

export default function RecordingView() {
  const [isRecording, setIsRecording] = useState(false);
  const [audioLevels, setAudioLevels] = useState<number[]>(
    createEmptyAudioLevels()
  );
  const [duration, setDuration] = useState(0);
  const [clinicianId, setClinicianId] = useState("");
  const [recordedWithConsent, setRecordedWithConsent] = useState(false);
  const [exportAllowed, setExportAllowed] = useState(false);
  const [remoteAssistAllowed, setRemoteAssistAllowed] = useState(false);
  const [importState, setImportState] = useState<{
    stage: ImportStage;
    message: string;
    fileName?: string;
    sessionId?: string;
  }>({
    stage: "idle",
    message:
      "Choose a local audio file, confirm consent, and create a review session shell.",
  });
  const [isImporting, setIsImporting] = useState(false);
  const [liveCaptureNotice, setLiveCaptureNotice] = useState<LiveCaptureNotice>(
    DEFAULT_LIVE_CAPTURE_NOTICE
  );
  const [liveCaptureStatus, setLiveCaptureStatus] =
    useState<LiveCaptureStatus | null>(null);
  const [isLoadingLiveCaptureStatus, setIsLoadingLiveCaptureStatus] =
    useState(true);
  const [captureTransition, setCaptureTransition] =
    useState<CaptureTransition>("idle");
  const [recentSession, setRecentSession] =
    useState<DesktopSessionSummary | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshLiveCaptureStatus = useCallback(async () => {
    if (!window.doctorAuditor) {
      setLiveCaptureStatus(
        createUnavailableLiveCaptureStatus(
          "Live capture is only available inside the Electron shell."
        )
      );
      setIsLoadingLiveCaptureStatus(false);
      return;
    }

    setIsLoadingLiveCaptureStatus(true);

    try {
      const status = await window.doctorAuditor.audio.getCaptureStatus();
      setLiveCaptureStatus(status);
    } catch (error) {
      setLiveCaptureStatus(
        createUnavailableLiveCaptureStatus(
          error instanceof Error
            ? error.message
            : "Unable to inspect live capture prerequisites."
        )
      );
    } finally {
      setIsLoadingLiveCaptureStatus(false);
    }
  }, []);

  useEffect(() => {
    if (!window.doctorAuditor) {
      return undefined;
    }

    return window.doctorAuditor.audio.onAudioLevel((level) => {
      setAudioLevels((prev) => [...prev.slice(1), level]);
    });
  }, []);

  useEffect(() => {
    void refreshLiveCaptureStatus();
  }, [refreshLiveCaptureStatus]);

  useEffect(() => {
    if (!window.doctorAuditor) {
      return undefined;
    }

    return window.doctorAuditor.audio.onCaptureError((captureError) => {
      stopRecordingTimer(timerRef);
      setCaptureTransition("idle");
      setIsRecording(false);
      setDuration(0);
      setAudioLevels(createEmptyAudioLevels());
      setLiveCaptureNotice({
        tone: "error",
        message: captureError.message,
      });

      if (captureError.session) {
        setRecentSession(captureError.session);
      }

      void refreshLiveCaptureStatus();
    });
  }, [refreshLiveCaptureStatus]);

  useEffect(() => {
    if (!window.doctorAuditor) {
      return undefined;
    }

    return window.doctorAuditor.session.onImportProgress((update) => {
      setImportState({
        stage: update.stage,
        message: update.message,
        fileName: update.fileName,
        sessionId: update.sessionId,
      });
    });
  }, []);

  useEffect(() => {
    if (!window.doctorAuditor) {
      return undefined;
    }

    return window.doctorAuditor.session.onSessionChanged((sessionSummary) => {
      setRecentSession((currentSession) => {
        if (!currentSession) {
          return currentSession;
        }

        return currentSession.session.id === sessionSummary.session.id
          ? sessionSummary
          : currentSession;
      });
    });
  }, []);

  useEffect(() => {
    return () => {
      stopRecordingTimer(timerRef);
    };
  }, []);

  const toggleRecording = useCallback(async () => {
    if (!window.doctorAuditor) {
      setLiveCaptureNotice({
        tone: "error",
        message:
          "Live capture is only available inside the Electron shell. Use imported audio in the browser preview.",
      });
      return;
    }

    if (isImporting || captureTransition !== "idle") {
      return;
    }

    if (isRecording) {
      setCaptureTransition("stopping");
      setLiveCaptureNotice({
        tone: "active",
        message:
          "Stopping live capture. Waiting for the local recorder to flush audio and queue transcription.",
      });

      try {
        const result = await window.doctorAuditor.audio.stopRecording();
        stopRecordingTimer(timerRef);
        setCaptureTransition("idle");
        setIsRecording(false);
        setDuration(0);
        setAudioLevels(createEmptyAudioLevels());
        setLiveCaptureNotice({
          tone: "success",
          message: result.session
            ? "Live capture saved locally. Transcript processing started."
            : "Live capture saved locally.",
        });

        if (result.session) {
          setRecentSession(result.session);
        }
      } catch (error) {
        stopRecordingTimer(timerRef);
        setCaptureTransition("idle");
        setIsRecording(false);
        setDuration(0);
        setAudioLevels(createEmptyAudioLevels());
        setLiveCaptureNotice({
          tone: "error",
          message:
            error instanceof Error
              ? error.message
              : "Live capture could not be finalized.",
        });
        void refreshLiveCaptureStatus();
      }
      return;
    }

    const intake = getValidatedIntakeRequest({
      clinicianId,
      recordedWithConsent,
      exportAllowed,
      remoteAssistAllowed,
      policyVersion: "policy-v1",
    });

    if ("error" in intake) {
      setLiveCaptureNotice({
        tone: "error",
        message: intake.error,
      });
      return;
    }

    if (!liveCaptureStatus?.available) {
      setLiveCaptureNotice({
        tone: "error",
        message:
          liveCaptureStatus?.issues[0] ??
          "Live capture is unavailable on this machine. Import audio instead.",
      });
      return;
    }

    try {
      setCaptureTransition("starting");
      setLiveCaptureNotice({
        tone: "active",
        message:
          "Starting live capture against the system default microphone. Import audio remains the safer demo path.",
      });
      const result = await window.doctorAuditor.audio.startRecording(intake);
      setCaptureTransition("idle");
      setIsRecording(true);
      setDuration(0);
      setAudioLevels(createEmptyAudioLevels());
      setRecentSession(result.session);
      setLiveCaptureNotice({
        tone: "active",
        message:
          "Live capture session created. Stop recording to queue local transcription.",
      });
      stopRecordingTimer(timerRef);
      timerRef.current = setInterval(() => {
        setDuration((currentDuration) => currentDuration + 1);
      }, 1000);
    } catch (error) {
      stopRecordingTimer(timerRef);
      setCaptureTransition("idle");
      setIsRecording(false);
      setDuration(0);
      setAudioLevels(createEmptyAudioLevels());
      setLiveCaptureNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Live capture could not be started.",
      });
      void refreshLiveCaptureStatus();
    }
  }, [
    clinicianId,
    captureTransition,
    exportAllowed,
    isImporting,
    isRecording,
    liveCaptureStatus,
    remoteAssistAllowed,
    recordedWithConsent,
    refreshLiveCaptureStatus,
  ]);

  const importAudio = useCallback(async () => {
    if (!window.doctorAuditor) {
      setImportState({
        stage: "error",
        message: "Desktop import is only available inside the Electron app.",
      });
      return;
    }

    const intake = getValidatedIntakeRequest({
      clinicianId,
      recordedWithConsent,
      exportAllowed,
      remoteAssistAllowed,
      policyVersion: "policy-v1",
    });

    if ("error" in intake) {
      setImportState({
        stage: "error",
        message: intake.error,
      });
      return;
    }

    setIsImporting(true);
    setImportState({
      stage: "idle",
      message: "Waiting for you to select an audio file.",
    });
    setLiveCaptureNotice(DEFAULT_LIVE_CAPTURE_NOTICE);

    try {
      const result = await window.doctorAuditor.session.importAudio(intake);

      if (result.cancelled) {
        setImportState({
          stage: "cancelled",
          message: "Import cancelled. No local session was created.",
        });
        return;
      }

      setRecentSession(result.session);
      setImportState((current) => ({
        stage: current.stage === "completed" ? current.stage : "completed",
        message:
          current.stage === "completed"
            ? current.message
            : "Import complete. Review session created and transcription queued.",
        fileName: current.fileName ?? getFileName(result.session.audioPath),
        sessionId: current.sessionId ?? result.session.session.id,
      }));
    } catch (error) {
      setImportState({
        stage: "error",
        message:
          error instanceof Error
            ? error.message
            : "Import failed while preparing the encounter.",
      });
    } finally {
      setIsImporting(false);
    }
  }, [clinicianId, exportAllowed, remoteAssistAllowed, recordedWithConsent]);

  const completedImportSteps =
    importState.stage === "idle" ||
    importState.stage === "cancelled" ||
    importState.stage === "error"
      ? -1
      : IMPORT_STEP_ORDER[importState.stage];

  const canImport =
    clinicianId.trim().length > 0 &&
    recordedWithConsent &&
    !isImporting &&
    !isRecording &&
    captureTransition === "idle";
  const inputsLocked =
    isImporting || isRecording || captureTransition !== "idle";
  const liveCaptureAvailable = liveCaptureStatus?.available ?? false;
  const liveCaptureUnavailable = !liveCaptureAvailable;
  const captureStatusSummary =
    captureTransition === "starting"
      ? "Recorder preflight is running against the default microphone."
      : captureTransition === "stopping"
        ? "Finalizing the capture file before local transcription is queued."
        : isLoadingLiveCaptureStatus
          ? "Checking local recorder prerequisites."
          : liveCaptureAvailable
            ? "Recorder preflight passed. Default microphone only; import audio is still the safer demo path."
            : liveCaptureStatus?.issues[0] ??
              "Live capture is unavailable on this machine. Import audio instead.";
  const liveCaptureHeading =
    captureTransition === "starting"
      ? "Starting Live Capture"
      : captureTransition === "stopping"
        ? "Finalizing Live Capture"
        : isRecording
          ? "Recording Session"
          : "Live Capture";
  const liveCaptureDescription =
    captureTransition === "starting"
      ? "Creating the local live-capture session shell before audio starts streaming."
      : captureTransition === "stopping"
        ? "Waiting for the recorder to stop cleanly so the audio file can move into transcription."
        : isRecording
          ? `Local capture in progress — ${formatDuration(duration)}`
          : "Use live capture when you need a fresh recording. Imported and recorded sessions now queue the same local transcription path.";

  return (
    <div className="recording-view">
      <div className="recording-hero">
        <div className="recording-status recording-status-primary">
          <span className="section-kicker">Import-first intake</span>
          <h2>Start from existing encounter audio</h2>
          <p>
            Imported audio creates a shared-contract review session shell with
            explicit transcript, review, export, and consent state.
          </p>
        </div>

        <div className="intake-panel">
          <div className="input-grid">
            <label className="field-label" htmlFor="clinician-label">
              Clinician label
            </label>
            <input
              id="clinician-label"
              className="text-input"
              value={clinicianId}
              onChange={(event) => setClinicianId(event.target.value)}
              placeholder="Dr. Morales"
              disabled={inputsLocked}
            />
          </div>

          <div className="checkbox-group">
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={recordedWithConsent}
                onChange={(event) =>
                  setRecordedWithConsent(event.target.checked)
                }
                disabled={inputsLocked}
              />
              <span className="checkbox-copy">
                <strong>Recorded with consent</strong>
                <span>Required before a local review session can be created.</span>
              </span>
            </label>

            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={exportAllowed}
                onChange={(event) => setExportAllowed(event.target.checked)}
                disabled={inputsLocked}
              />
              <span className="checkbox-copy">
                <strong>Export permitted</strong>
                <span>
                  Marks the session as eligible for later approved export.
                </span>
              </span>
            </label>

            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={remoteAssistAllowed}
                onChange={(event) =>
                  setRemoteAssistAllowed(event.target.checked)
                }
                disabled={inputsLocked}
              />
              <span className="checkbox-copy">
                <strong>Remote assist permitted</strong>
                <span>
                  Allows minimized finding metadata to be sent through the
                  Remote assist gateway from the review screen.
                </span>
              </span>
            </label>
          </div>

          <div className="intake-actions">
            <button
              className="import-button"
              onClick={importAudio}
              disabled={!canImport}
            >
              {isImporting ? "Importing audio..." : "Import Audio File"}
            </button>
            <p className="intake-helper">
              Supports common local audio formats. Imported audio is copied into
              app storage and tracked as `audio_import`.
            </p>
          </div>

          <div
            className={`import-status-card ${
              importState.stage === "error"
                ? "error"
                : importState.stage === "completed"
                  ? "success"
                  : ""
            }`}
          >
            <div className="import-status-header">
              <div>
                <h3>Import status</h3>
                <p>{importState.message}</p>
              </div>
              {importState.fileName && (
                <span className="status-chip">{importState.fileName}</span>
              )}
            </div>

            <div className="import-step-list">
              {IMPORT_STEPS.map((step, index) => {
                const isDone = completedImportSteps >= index;
                const isActive = importState.stage === step.key;

                return (
                  <div
                    key={step.key}
                    className={`import-step ${
                      isDone ? "done" : ""
                    } ${isActive ? "active" : ""}`}
                  >
                    <span className="import-step-dot" />
                    <span>{step.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {recentSession && (
            <div className="import-result-card">
              <div>
                <span className="section-kicker">Latest review session</span>
                <h3>{formatClinicianLabel(recentSession.session.clinicianId)}</h3>
                <p>
                  {formatCaptureMode(recentSession.session.captureMode)} /
                  Transcript {formatTranscriptStatus(
                    recentSession.session.transcriptStatus
                  ).toLowerCase()} /
                  Review {formatReviewStatus(
                    recentSession.session.reviewStatus
                  ).toLowerCase()}.
                </p>
              </div>
              <div className="import-result-meta">
                <span className="status-chip">
                  {getFileName(recentSession.audioPath)}
                </span>
                <span className="status-chip">
                  {recentSession.transcriptSegmentCount} segments
                </span>
                <span className="status-chip">
                  {recentSession.session.consent.exportAllowed
                    ? "Export allowed"
                    : "Local review only"}
                </span>
                <span className="status-chip">
                  {recentSession.session.consent.remoteAssistAllowed
                    ? "Remote assist allowed"
                    : "Remote assist disabled"}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="recording-status">
        <h2>{liveCaptureHeading}</h2>
        <p>{liveCaptureDescription}</p>
        <div
          className={`capture-notice ${
            liveCaptureNotice.tone === "active"
              ? "active"
              : liveCaptureNotice.tone
          }`}
        >
          {liveCaptureNotice.message}
        </div>
      </div>

      <div
        className={`capture-status-card ${liveCaptureUnavailable ? "error" : ""}`}
      >
        <div className="capture-status-header">
          <div>
            <h3>
              {liveCaptureAvailable
                ? "Experimental live capture"
                : "Live capture unavailable"}
            </h3>
            <p>{captureStatusSummary}</p>
          </div>
          <button
            type="button"
            className="capture-status-button"
            onClick={() => void refreshLiveCaptureStatus()}
            disabled={
              isLoadingLiveCaptureStatus || captureTransition !== "idle"
            }
          >
            {isLoadingLiveCaptureStatus ? "Checking..." : "Refresh status"}
          </button>
        </div>

        {liveCaptureStatus && (
          <>
            <div className="capture-status-meta">
              <span className="status-chip">
                {liveCaptureStatus.recorder
                  ? `Recorder ${liveCaptureStatus.recorder}`
                  : "Recorder missing"}
              </span>
              <span className="status-chip">
                {formatMicrophoneAccess(liveCaptureStatus.microphoneAccess)}
              </span>
              <span className="status-chip">Default mic only</span>
            </div>

            {liveCaptureStatus.issues.length > 0 && (
              <ul className="capture-status-list capture-status-list--issues">
                {liveCaptureStatus.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            )}

            {liveCaptureStatus.notes.length > 0 && (
              <ul className="capture-status-list">
                {liveCaptureStatus.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <button
        className={`record-button ${isRecording ? "recording" : ""}`}
        onClick={toggleRecording}
        disabled={
          isImporting ||
          captureTransition !== "idle" ||
          (!isRecording && liveCaptureUnavailable)
        }
      >
        <div className="record-button-inner" />
      </button>

      <div className="waveform">
        {audioLevels.map((level, index) => (
          <div
            key={index}
            className="waveform-bar"
            style={{ height: `${Math.max(4, level * 70)}px` }}
          />
        ))}
      </div>
    </div>
  );
}

function getValidatedIntakeRequest(
  request: SessionIntakeRequest
): SessionIntakeRequest | { error: string } {
  const clinicianId = request.clinicianId.trim();
  if (!clinicianId) {
    return { error: "Add a clinician label before starting capture." };
  }

  if (!request.recordedWithConsent) {
    return { error: "Confirm recorded consent before starting capture." };
  }

  return {
    clinicianId,
    recordedWithConsent: request.recordedWithConsent,
    exportAllowed: request.exportAllowed,
    remoteAssistAllowed: request.remoteAssistAllowed,
    policyVersion: request.policyVersion,
  };
}

function createEmptyAudioLevels(): number[] {
  return new Array(60).fill(0);
}

function stopRecordingTimer(
  timerRef: React.RefObject<ReturnType<typeof setInterval> | null>
): void {
  if (timerRef.current) {
    clearInterval(timerRef.current);
    timerRef.current = null;
  }
}

function createUnavailableLiveCaptureStatus(message: string): LiveCaptureStatus {
  return {
    available: false,
    experimental: true,
    recorder: null,
    microphoneAccess: "unknown",
    issues: [message],
    notes: [
      "Import audio remains available without the live microphone path.",
      "Only the system default microphone is supported once live capture is enabled.",
    ],
  };
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${remainder
    .toString()
    .padStart(2, "0")}`;
}

function formatClinicianLabel(value: string): string {
  const trimmedValue = value.trim();
  return trimmedValue || "Unassigned clinician";
}

function formatCaptureMode(value: CaptureMode): string {
  switch (value) {
    case "audio_import":
      return "Imported audio";
    case "live_capture":
      return "Live capture";
    case "manual_entry":
      return "Manual entry";
  }

  return "Unknown";
}

function formatTranscriptStatus(value: TranscriptStatus): string {
  switch (value) {
    case "not_started":
      return "not started";
    case "in_progress":
      return "in progress";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
  }
}

function formatReviewStatus(value: ReviewStatus): string {
  switch (value) {
    case "not_started":
      return "not started";
    case "ready":
      return "ready";
    case "in_review":
      return "in progress";
    case "completed":
      return "completed";
  }
}

function formatMicrophoneAccess(value: LiveCaptureStatus["microphoneAccess"]): string {
  switch (value) {
    case "granted":
      return "Microphone granted";
    case "denied":
      return "Microphone denied";
    case "restricted":
      return "Microphone restricted";
    case "not-determined":
      return "Microphone prompt pending";
    case "unsupported":
      return "Permission status unavailable";
    case "unknown":
      return "Permission status unknown";
  }
}

function getFileName(filePath?: string): string {
  if (!filePath) {
    return "Local audio";
  }

  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || "Local audio";
}
