import React, { useState, useEffect, useCallback, useRef } from "react";
import type {
  ImportedSessionShell,
  SessionImportProgress,
} from "../types/electron";

interface TranscriptEntry {
  speaker: string;
  text: string;
  startTime: number;
  endTime: number;
}

interface RiskState {
  communication: number;
  clinical: number;
  behavioral: number;
  overall: string;
}

type ImportStage =
  | "idle"
  | "cancelled"
  | SessionImportProgress["stage"];

const IMPORT_STEPS: Array<{
  key: SessionImportProgress["stage"];
  label: string;
}> = [
  { key: "selected", label: "Audio selected" },
  { key: "copying", label: "Local copy created" },
  { key: "creating-session", label: "Session shell created" },
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
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [audioLevels, setAudioLevels] = useState<number[]>(
    new Array(60).fill(0)
  );
  const [risk, setRisk] = useState<RiskState | null>(null);
  const [duration, setDuration] = useState(0);
  const [clinicianLabel, setClinicianLabel] = useState("Imported encounter");
  const [importState, setImportState] = useState<{
    stage: ImportStage;
    message: string;
    fileName?: string;
    sessionId?: string;
  }>({
    stage: "idle",
    message: "Choose an audio file to create a local encounter shell.",
  });
  const [isImporting, setIsImporting] = useState(false);
  const [importedSession, setImportedSession] =
    useState<ImportedSessionShell | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (window.doctorAuditor) {
      window.doctorAuditor.audio.onAudioLevel((level) => {
        setAudioLevels((prev) => [...prev.slice(1), level]);
      });

      window.doctorAuditor.audio.onTranscriptUpdate((segment) => {
        setTranscript((prev) => [...prev, segment]);
      });

      window.doctorAuditor.analysis.onRiskUpdate((assessment) => {
        setRisk((prev) => ({
          ...prev,
          overall: assessment.overallRisk,
          communication: prev?.communication ?? 0,
          clinical: prev?.clinical ?? 0,
          behavioral: prev?.behavioral ?? 0,
        }));
      });
    }
  }, []);

  useEffect(() => {
    if (!window.doctorAuditor) return undefined;

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
      await window.doctorAuditor.audio.stopRecording();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    } else {
      await window.doctorAuditor.audio.startRecording();
      setIsRecording(true);
      setDuration(0);
      setTranscript([]);
      setRisk(null);
      timerRef.current = setInterval(() => {
        setDuration((d) => d + 1);
      }, 1000);
    }
  }, [isRecording]);

  const importAudio = useCallback(async () => {
    if (!window.doctorAuditor) {
      setImportState({
        stage: "error",
        message: "Desktop import is only available inside the Electron app.",
      });
      return;
    }

    setIsImporting(true);
    setImportedSession(null);
    setImportState({
      stage: "idle",
      message: "Waiting for you to select an audio file.",
    });

    try {
      const result = await window.doctorAuditor.session.importAudio(
        clinicianLabel.trim()
      );

      if (result.cancelled) {
        setImportState({
          stage: "cancelled",
          message: "Import cancelled. No local session was created.",
        });
        return;
      }

      setImportedSession(result.session);
      setImportState((current) => ({
        stage: current.stage === "completed" ? current.stage : "completed",
        message:
          current.stage === "completed"
            ? current.message
            : "Import complete. Session shell is ready in history.",
        fileName:
          current.fileName ?? getFileName(result.session.audioPath),
        sessionId: current.sessionId ?? result.session.id,
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
  }, [clinicianLabel]);

  const formatDuration = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const getRiskClass = (score: number): string => {
    if (score >= 7) return "high";
    if (score >= 4) return "medium";
    return "low";
  };

  const completedImportSteps =
    importState.stage === "idle" ||
    importState.stage === "cancelled" ||
    importState.stage === "error"
      ? -1
      : IMPORT_STEP_ORDER[importState.stage];

  return (
    <div className="recording-view">
      <div className="recording-hero">
        <div className="recording-status recording-status-primary">
          <span className="section-kicker">Import-first intake</span>
          <h2>Start from existing encounter audio</h2>
          <p>
            Pull in a local recording, keep the file on-device, and create a
            session shell before live capture is production-ready.
          </p>
        </div>

        <div className="intake-panel">
          <label className="field-label" htmlFor="clinician-label">
            Clinician label
          </label>
          <input
            id="clinician-label"
            className="text-input"
            value={clinicianLabel}
            onChange={(event) => setClinicianLabel(event.target.value)}
            placeholder="Imported encounter"
          />

          <div className="intake-actions">
            <button
              className="import-button"
              onClick={importAudio}
              disabled={isImporting}
            >
              {isImporting ? "Importing audio..." : "Import Audio File"}
            </button>
            <p className="intake-helper">
              Supports common local audio formats and creates a session shell in
              the local database.
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

          {importedSession && (
            <div className="import-result-card">
              <div>
                <span className="section-kicker">Local session shell</span>
                <h3>{importedSession.doctorId}</h3>
                <p>
                  Created {new Date(importedSession.startTime).toLocaleString()}
                </p>
              </div>
              <div className="import-result-meta">
                <span className="status-chip">
                  {getFileName(importedSession.audioPath)}
                </span>
                <span className="status-chip">{importedSession.id}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="recording-status">
        <h2>{isRecording ? "Recording Session" : "Live Capture Beta"}</h2>
        <p>
          {isRecording
            ? `Session in progress — ${formatDuration(duration)}`
            : "Use live recording when you need a fresh capture. Import remains the faster path."}
        </p>
      </div>

      <button
        className={`record-button ${isRecording ? "recording" : ""}`}
        onClick={toggleRecording}
      >
        <div className="record-button-inner" />
      </button>

      <div className="waveform">
        {audioLevels.map((level, i) => (
          <div
            key={i}
            className="waveform-bar"
            style={{ height: `${Math.max(4, level * 70)}px` }}
          />
        ))}
      </div>

      {risk && (
        <div className="risk-indicator">
          <div className="risk-category">
            <div className="risk-category-label">Communication</div>
            <div className={`risk-score ${getRiskClass(risk.communication)}`}>
              {risk.communication}
            </div>
          </div>
          <div className="risk-category">
            <div className="risk-category-label">Clinical</div>
            <div className={`risk-score ${getRiskClass(risk.clinical)}`}>
              {risk.clinical}
            </div>
          </div>
          <div className="risk-category">
            <div className="risk-category-label">Behavioral</div>
            <div className={`risk-score ${getRiskClass(risk.behavioral)}`}>
              {risk.behavioral}
            </div>
          </div>
        </div>
      )}

      {transcript.length > 0 && (
        <div className="transcript-panel">
          <h3>Live Transcript</h3>
          {transcript.map((entry, i) => (
            <div key={i} className="transcript-segment">
              <div className={`transcript-speaker ${entry.speaker}`}>
                {entry.speaker === "doctor" ? "Doctor" : "Patient"}
              </div>
              <div className="transcript-text">{entry.text}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function getFileName(filePath?: string): string {
  if (!filePath) {
    return "Local audio";
  }

  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || "Local audio";
}
