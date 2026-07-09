import React, { useCallback, useEffect, useRef, useState } from "react";
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
import {
  canRetryTranscription,
  formatCaptureMode,
  formatClinicianLabel,
} from "./sessionSummaryModel";
import { formatMicrophoneAccess } from "./liveCaptureModel";

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
  { key: "creating-session", label: "Session created" },
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
    "Use the red button to record, or upload an audio file beside it.",
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
  const [remoteAssistAllowed] = useState(true);
  const [importState, setImportState] = useState<{
    stage: ImportStage;
    message: string;
    fileName?: string;
    sessionId?: string;
  }>({
    stage: "idle",
    message:
      "Choose a local audio file to create a review session.",
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
  const [isRetryingRecentSession, setIsRetryingRecentSession] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshLiveCaptureStatus = useCallback(async () => {
    if (!window.doctorAuditor) {
      setLiveCaptureStatus(
        createUnavailableLiveCaptureStatus(
          "Live recording is only available inside the desktop app."
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
            : "Unable to inspect live recording prerequisites."
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
          "Live recording is only available inside the desktop app. You can still load audio in the browser preview.",
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
          "Stopping recording and saving the audio locally.",
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
            ? "Recording saved locally. Transcript processing started."
            : "Recording saved locally.",
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
            : "Recording could not be finalized.",
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
          "Live recording is unavailable on this machine.",
      });
      return;
    }

    try {
      setCaptureTransition("starting");
      setLiveCaptureNotice({
        tone: "active",
        message: "Starting live recording from the default microphone.",
      });
      const result = await window.doctorAuditor.audio.startRecording(intake);
      setCaptureTransition("idle");
      setIsRecording(true);
      setDuration(0);
      setAudioLevels(createEmptyAudioLevels());
      setRecentSession(result.session);
      setLiveCaptureNotice({
        tone: "active",
        message: "Recording in progress. Stop when you're ready to transcribe.",
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
            : "Live recording could not be started.",
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
        message: "Loading audio is only available inside the desktop app.",
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
      message: "Waiting for you to choose an audio file.",
    });
    setLiveCaptureNotice(DEFAULT_LIVE_CAPTURE_NOTICE);

    try {
      const result = await window.doctorAuditor.session.importAudio(intake);

      if (result.cancelled) {
        setImportState({
          stage: "cancelled",
          message: "Load cancelled. No session was created.",
        });
        return;
      }

      setRecentSession(result.session);
      setImportState((current) => ({
        stage: current.stage === "completed" ? current.stage : "completed",
        message:
          current.stage === "completed"
            ? current.message
            : "Audio loaded. Review session created and transcription queued.",
        fileName: current.fileName ?? getFileName(result.session.audioPath),
        sessionId: current.sessionId ?? result.session.session.id,
      }));
    } catch (error) {
      setImportState({
        stage: "error",
        message:
          error instanceof Error
            ? error.message
            : "Audio could not be loaded.",
      });
    } finally {
      setIsImporting(false);
    }
  }, [clinicianId, exportAllowed, remoteAssistAllowed, recordedWithConsent]);

  const retryRecentSession = useCallback(async () => {
    if (!window.doctorAuditor || !recentSession) {
      return;
    }

    if (!canRetryTranscription(recentSession) || isRetryingRecentSession) {
      return;
    }

    setIsRetryingRecentSession(true);
    setLiveCaptureNotice({
      tone: "active",
      message: `Retrying transcript processing for ${formatClinicianLabel(
        recentSession.session.clinicianId
      )}.`,
    });

    try {
      const nextSession = await window.doctorAuditor.session.retryTranscription(
        recentSession.session.id
      );

      if (nextSession) {
        setRecentSession(nextSession);
      }

      setLiveCaptureNotice({
        tone: "success",
        message: "Transcript processing restarted for the latest session.",
      });
    } catch (error) {
      setLiveCaptureNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Transcript processing could not be restarted.",
      });
    } finally {
      setIsRetryingRecentSession(false);
    }
  }, [isRetryingRecentSession, recentSession]);

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
      ? "Getting the recorder ready on the default microphone."
      : captureTransition === "stopping"
        ? "Saving the recording and preparing transcription."
        : isLoadingLiveCaptureStatus
          ? "Checking the recorder and microphone."
          : liveCaptureAvailable
            ? "Recorder is ready. Live recording uses the default microphone."
            : liveCaptureStatus?.issues[0] ??
              "Live recording is unavailable on this machine.";
  const liveCaptureHeading =
    captureTransition === "starting"
      ? "Starting Recording"
      : captureTransition === "stopping"
        ? "Saving Recording"
        : isRecording
          ? "Recording In Progress"
          : "Ready To Record";
  const liveCaptureDescription =
    captureTransition === "starting"
      ? "Opening the microphone and creating the session."
      : captureTransition === "stopping"
        ? "Finishing the audio file before transcription starts."
        : isRecording
          ? `Recording from the default microphone - ${formatDuration(duration)}`
          : "Record from the default microphone here. Upload is available in the next card.";
  const trimmedClinicianId = clinicianId.trim();
  const setupReady = trimmedClinicianId.length > 0 && recordedWithConsent;
  const setupSummaryHeading = setupReady
    ? "Ready to capture"
    : "Finish setup below";
  const setupSummaryMessage = setupReady
    ? "Recording and upload are enabled for this session."
    : "Add a clinician label and recorded consent below before capture starts.";
  const recordActionLabel =
    captureTransition === "starting"
      ? "Starting..."
      : captureTransition === "stopping"
        ? "Saving..."
        : isRecording
          ? "Stop recording"
          : "Start recording";
  const recordActionSummary =
    captureTransition === "starting"
      ? "Preparing the microphone."
      : captureTransition === "stopping"
        ? "Saving the audio and queuing transcription."
        : isRecording
          ? "Press again to stop and save this session."
          : !setupReady
            ? "Add a clinician label and recorded consent below to enable recording."
            : liveCaptureUnavailable
              ? "Resolve recorder issues before starting."
              : "Press to record from the default microphone.";
  const transportDisplay =
    captureTransition === "starting"
      ? "ARMING"
      : captureTransition === "stopping"
        ? "SAVING"
        : isRecording
          ? formatDuration(duration)
          : "00:00";
  const importHelperText = !setupReady
    ? "Add a clinician label and recorded consent below to enable upload."
    : "Choose a local audio file. It is copied into app storage for review.";

  return (
    <div className="recording-view">
      <header className="capture-shell">
        <div className="capture-shell__intro">
          <span className="section-kicker">Record or upload</span>
          <h2>Create a session</h2>
          <p>
            Start with live audio or an uploaded file. The session rules below
            apply to both.
          </p>
        </div>

        <div
          className={`capture-shell__readiness ${
            setupReady ? "ready" : "pending"
          }`}
        >
          <span className="capture-shell__readiness-label">
            {setupSummaryHeading}
          </span>
          <p>{setupSummaryMessage}</p>
        </div>
      </header>

      <section className="capture-grid">
        <article className="capture-card capture-card--primary">
          <div className="capture-card__header">
            <div>
              <span className="section-kicker">Live capture</span>
              <h3>{liveCaptureHeading}</h3>
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
              {isLoadingLiveCaptureStatus ? "Checking..." : "Refresh"}
            </button>
          </div>

          <div className="capture-card__meta">
            <span className="status-chip">
              {liveCaptureStatus?.recorder
                ? `Recorder ${liveCaptureStatus.recorder}`
                : "Recorder missing"}
            </span>
            <span className="status-chip">
              {liveCaptureStatus
                ? formatMicrophoneAccess(liveCaptureStatus.microphoneAccess)
                : "Checking microphone"}
            </span>
            <span className="status-chip">Default microphone</span>
          </div>

          <div className="transport-panel">
            <div className="transport-panel__display">{transportDisplay}</div>
            <p className="transport-panel__copy">{liveCaptureDescription}</p>
            <button
              type="button"
              className={`record-button ${isRecording ? "recording" : ""}`}
              onClick={toggleRecording}
              disabled={
                isImporting ||
                captureTransition !== "idle" ||
                (!isRecording && liveCaptureUnavailable)
              }
              aria-label={recordActionLabel}
            >
              <span className="record-button-inner" aria-hidden="true" />
            </button>
            <div className="transport-panel__action">
              <strong>{recordActionLabel}</strong>
              <span>{recordActionSummary}</span>
            </div>
          </div>

          <div className="waveform" aria-hidden="true">
            {audioLevels.map((level, index) => (
              <div
                key={index}
                className="waveform-bar"
                style={{ height: `${Math.max(6, level * 78)}px` }}
              />
            ))}
          </div>

          <div
            className={`capture-notice ${
              liveCaptureNotice.tone === "active"
                ? "active"
                : liveCaptureNotice.tone
            }`}
            role="status"
          >
            {liveCaptureNotice.message}
          </div>

          {liveCaptureStatus?.issues.length ? (
            <ul className="capture-inline-list capture-inline-list--issues">
              {liveCaptureStatus.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </article>

        <article className="capture-card">
          <div className="capture-card__header">
            <div>
              <span className="section-kicker">Upload audio</span>
              <h3>Upload an existing file</h3>
              <p>Use local audio when the encounter was recorded elsewhere.</p>
            </div>
          </div>

          <div className="intake-actions">
            <button
              className="import-button"
              onClick={importAudio}
              disabled={!canImport}
            >
              {isImporting ? "Loading audio..." : "Choose audio file"}
            </button>
            <p className="intake-helper">{importHelperText}</p>
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
              {importState.fileName ? (
                <span className="status-chip">{importState.fileName}</span>
              ) : null}
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
        </article>
      </section>

      <section className="session-setup">
        <div className="session-setup__header">
          <div>
            <span className="section-kicker">Session rules</span>
            <h3>Details and permissions</h3>
            <p>These rules apply to both recording and upload.</p>
          </div>
          <p className="session-setup__required">
            Required: clinician label and recorded consent.
          </p>
        </div>

        <div className="session-setup__form">
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
            <p className="field-help">Shown in local session history.</p>
          </div>

          <div className="checkbox-group">
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={recordedWithConsent}
                onChange={(event) => setRecordedWithConsent(event.target.checked)}
                disabled={inputsLocked}
              />
              <span className="checkbox-copy">
                <strong>Recorded with consent</strong>
                <span>Required before a session can be created.</span>
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
                <strong>Allow approved export</strong>
                <span>Optional. Keeps the session eligible for later export.</span>
              </span>
            </label>

            <div className="checkbox-field">
              <span className="checkbox-copy">
                <strong>Remote assist is available during review</strong>
                <span>
                  It uses minimized metadata only. Raw audio and full transcript
                  stay on the device.
                </span>
              </span>
            </div>
          </div>
        </div>
      </section>

      {recentSession ? (
        <section className="latest-session-card">
          <div className="latest-session-card__summary">
            <span className="section-kicker">Latest review session</span>
            <h3>{formatClinicianLabel(recentSession.session.clinicianId)}</h3>
            <p>
              {formatCaptureMode(recentSession.session.captureMode)} /
              Transcript{" "}
              {formatTranscriptStatus(
                recentSession.session.transcriptStatus
              ).toLowerCase()}{" "}
              / Review{" "}
              {formatReviewStatus(
                recentSession.session.reviewStatus
              ).toLowerCase()}.
            </p>
          </div>
          <div className="latest-session-card__meta">
            <span className="status-chip">{getFileName(recentSession.audioPath)}</span>
            <span className="status-chip">
              {recentSession.transcriptSegmentCount} segments
            </span>
            <span className="status-chip">
              {recentSession.session.consent.exportAllowed
                ? "Export allowed"
                : "Local review only"}
            </span>
            <span className="status-chip">
              Remote assist available
            </span>
            {canRetryTranscription(recentSession) ? (
              <button
                type="button"
                className="capture-status-button"
                onClick={() => void retryRecentSession()}
                disabled={isRetryingRecentSession}
              >
                {isRetryingRecentSession ? "Retrying..." : "Retry transcript"}
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
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
      "You can still load an audio file while live recording is unavailable.",
      "Only the system default microphone is supported in this build.",
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

function getFileName(filePath?: string): string {
  if (!filePath) {
    return "Local audio";
  }

  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || "Local audio";
}
