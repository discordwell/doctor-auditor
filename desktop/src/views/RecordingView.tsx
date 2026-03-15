import React, { useState, useEffect, useCallback, useRef } from "react";

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

export default function RecordingView() {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [audioLevels, setAudioLevels] = useState<number[]>(
    new Array(60).fill(0)
  );
  const [risk, setRisk] = useState<RiskState | null>(null);
  const [duration, setDuration] = useState(0);
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

  return (
    <div className="recording-view">
      <div className="recording-status">
        <h2>{isRecording ? "Recording Session" : "Ready to Record"}</h2>
        <p>
          {isRecording
            ? `Session in progress — ${formatDuration(duration)}`
            : "Click the button to start monitoring a consultation"}
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
