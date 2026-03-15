import React, { useState, useEffect, useCallback, useRef } from "react";
import type {
  CaptureMode,
  ReviewStatus,
  TranscriptStatus,
} from "@doctor-auditor/shared";
import type {
  DesktopSessionSummary,
  SessionImportProgress,
} from "../types/electron";

type ImportStage = "idle" | "cancelled" | SessionImportProgress["stage"];

const IMPORT_STEPS: Array<{
  key: SessionImportProgress["stage"];
  label: string;
}> = [
  { key: "selected", label: "Audio selected" },
  { key: "copying", label: "Local copy created" },
  { key: "creating-session", label: "Review session created" },
  { key: "completed", label: "Ready in history" },
];

const IMPORT_STEP_ORDER = IMPORT_STEPS.reduce<Record<string, number>>(
  (accumulator, step, index) => {
    accumulator[step.key] = index;
    return accumulator;
  },
  {}
);

export default function RecordingView() {
  const [isRecording, setIsRecording] = useState(false);
  const [audioLevels, setAudioLevels] = useState<number[]>(
    new Array(60).fill(0)
  );
  const [duration, setDuration] = useState(0);
  const [clinicianId, setClinicianId] = useState("");
  const [recordedWithConsent, setRecordedWithConsent] = useState(false);
  const [exportAllowed, setExportAllowed] = useState(false);
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
  const [recentSession, setRecentSession] =
    useState<DesktopSessionSummary | null>(null);
  const [recentSessionOrigin, setRecentSessionOrigin] = useState<
    "import" | "live" | null
  >(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!window.doctorAuditor) {
      return undefined;
    }

    return window.doctorAuditor.audio.onAudioLevel((level) => {
      setAudioLevels((prev) => [...prev.slice(1), level]);
    });
  }, []);

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
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  const toggleRecording = useCallback(async () => {
    if (!window.doctorAuditor) {
      console.warn("Electron API not available — running in browser mode");
      setIsRecording((prev) => !prev);
      return;
    }

    if (isRecording) {
      try {
        const result = await window.doctorAuditor.audio.stopRecording();
        setIsRecording(false);
        if (timerRef.current) {
          clearInterval(timerRef.current);
        }
        if (result.session) {
          setRecentSession(result.session);
          setRecentSessionOrigin("live");
        }
      } catch (error) {
        setImportState({
          stage: "error",
          message:
            error instanceof Error
              ? error.message
              : "Live capture could not be finalized.",
        });
      }
    } else {
      const trimmedClinicianId = clinicianId.trim();
      if (!trimmedClinicianId) {
        setImportState({
          stage: "error",
          message: "Add a clinician label before starting live capture.",
        });
        return;
      }

      if (!recordedWithConsent) {
        setImportState({
          stage: "error",
          message: "Confirm recorded consent before starting live capture.",
        });
        return;
      }

      try {
        await window.doctorAuditor.audio.startRecording({
          clinicianId: trimmedClinicianId,
          recordedWithConsent,
          exportAllowed,
        });
        setRecentSession(null);
        setRecentSessionOrigin(null);
        setIsRecording(true);
        setDuration(0);
        setAudioLevels(new Array(60).fill(0));
        timerRef.current = setInterval(() => {
          setDuration((currentDuration) => currentDuration + 1);
        }, 1000);
      } catch (error) {
        setImportState({
          stage: "error",
          message:
            error instanceof Error
              ? error.message
              : "Live capture could not be started.",
        });
      }
    }
  }, [clinicianId, exportAllowed, isRecording, recordedWithConsent]);

  const importAudio = useCallback(async () => {
    if (!window.doctorAuditor) {
      setImportState({
        stage: "error",
        message: "Desktop import is only available inside the Electron app.",
      });
      return;
    }

    const trimmedClinicianId = clinicianId.trim();
    if (!trimmedClinicianId) {
      setImportState({
        stage: "error",
        message: "Add a clinician label before importing audio.",
      });
      return;
    }

    if (!recordedWithConsent) {
      setImportState({
        stage: "error",
        message: "Confirm recorded consent before importing audio.",
      });
      return;
    }

    setIsImporting(true);
    setRecentSession(null);
    setRecentSessionOrigin(null);
    setImportState({
      stage: "idle",
      message: "Waiting for you to select an audio file.",
    });

    try {
      const result = await window.doctorAuditor.session.importAudio({
        clinicianId: trimmedClinicianId,
        recordedWithConsent,
        exportAllowed,
      });

      if (result.cancelled) {
        setImportState({
          stage: "cancelled",
          message: "Import cancelled. No local session was created.",
        });
        return;
      }

      setRecentSession(result.session);
      setRecentSessionOrigin("import");
      setImportState((current) => ({
        stage: current.stage === "completed" ? current.stage : "completed",
        message:
          current.stage === "completed"
            ? current.message
            : "Import complete. Review session shell is ready in history.",
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
  }, [clinicianId, exportAllowed, recordedWithConsent]);

  const completedImportSteps =
    importState.stage === "idle" ||
    importState.stage === "cancelled" ||
    importState.stage === "error"
      ? -1
      : IMPORT_STEP_ORDER[importState.stage];

  const canImport =
    clinicianId.trim().length > 0 && recordedWithConsent && !isImporting;

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
              />
              <span className="checkbox-copy">
                <strong>Export permitted</strong>
                <span>
                  Marks the session as eligible for later approved export.
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
                <span className="section-kicker">
                  {recentSessionOrigin === "live"
                    ? "Live capture session"
                    : "Review session shell"}
                </span>
                <h3>{formatClinicianLabel(recentSession.session.clinicianId)}</h3>
                <p>
                  {recentSessionOrigin === "live" ? "Captured" : "Imported"}{" "}
                  {formatDateTime(recentSession.session.createdAt)}. Transcript
                  state is{" "}
                  {formatTranscriptStatus(
                    recentSession.session.transcriptStatus
                  ).toLowerCase()}
                  .
                </p>
              </div>
              <div className="import-result-meta">
                <span className="status-chip">
                  {getFileName(recentSession.audioPath)}
                </span>
                <span className="status-chip">
                  {formatCaptureMode(recentSession.session.captureMode)}
                </span>
                <span className="status-chip">
                  {formatReviewStatus(recentSession.session.reviewStatus)}
                </span>
                <span className="status-chip">
                  {recentSession.session.consent.exportAllowed
                    ? "Export allowed"
                    : "Local review only"}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="recording-status">
        <h2>{isRecording ? "Recording Session" : "Live Capture"}</h2>
        <p>
          {isRecording
            ? `Local capture in progress — ${formatDuration(duration)}`
            : "Use live capture when you need a fresh recording. Import remains the fastest intake path."}
        </p>
      </div>

      <button
        className={`record-button ${isRecording ? "recording" : ""}`}
        onClick={toggleRecording}
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

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${remainder
    .toString()
    .padStart(2, "0")}`;
}

function formatDateTime(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return "time unavailable";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
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
}

function formatTranscriptStatus(value: TranscriptStatus): string {
  switch (value) {
    case "not_started":
      return "Transcript not started";
    case "in_progress":
      return "Transcript in progress";
    case "completed":
      return "Transcript completed";
    case "failed":
      return "Transcript failed";
  }
}

function formatReviewStatus(value: ReviewStatus): string {
  switch (value) {
    case "not_started":
      return "Review not started";
    case "ready":
      return "Ready for review";
    case "in_review":
      return "Review in progress";
    case "completed":
      return "Review complete";
  }
}

function getFileName(filePath?: string): string {
  if (!filePath) {
    return "Local audio";
  }

  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || "Local audio";
}
