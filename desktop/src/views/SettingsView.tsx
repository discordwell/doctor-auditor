import React, { useCallback, useEffect, useState } from "react";
import type { AudioDevice, LiveCaptureStatus } from "../types/electron";

type LoadState = "loading" | "ready" | "error";

export default function SettingsView() {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [captureStatus, setCaptureStatus] = useState<LiveCaptureStatus | null>(
    null
  );
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState("");

  const loadCaptureSettings = useCallback(async () => {
    if (!window.doctorAuditor) {
      setLoadState("error");
      setErrorMessage("Desktop audio API unavailable.");
      return;
    }

    setLoadState("loading");
    setErrorMessage("");

    try {
      const [deviceList, status] = await Promise.all([
        window.doctorAuditor.audio.getDevices(),
        window.doctorAuditor.audio.getCaptureStatus(),
      ]);

      setDevices(deviceList);
      setCaptureStatus(status);
      setLoadState("ready");
    } catch (error) {
      setLoadState("error");
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to read local audio settings."
      );
    }
  }, []);

  useEffect(() => {
    void loadCaptureSettings();
  }, [loadCaptureSettings]);

  return (
    <div className="settings-view">
      <h2>Settings</h2>

      <div className="settings-section">
        <h3>Workflow contract</h3>
        <p>
          Desktop intake now creates shared review sessions instead of the older
          assessment-only records. Imported audio starts as `audio_import` with
          a transcript state of `not_started` and a review state of
          `not_started`.
        </p>
        <ul className="settings-list">
          <li>Consent is captured explicitly during import.</li>
          <li>Audio stays local until a later approved export step exists.</li>
          <li>Review, transcript, and export state all track the shared contract.</li>
        </ul>
      </div>

      <div className="settings-section">
        <div className="settings-section__header">
          <div>
            <h3>Live capture diagnostics</h3>
            <p>
              Import audio is the current demo-path intake. Live capture remains
              experimental until the local recorder and microphone permissions
              are stable.
            </p>
          </div>
          <button
            type="button"
            className="capture-status-button"
            onClick={() => void loadCaptureSettings()}
            disabled={loadState === "loading"}
          >
            {loadState === "loading" ? "Checking..." : "Refresh status"}
          </button>
        </div>

        {loadState === "loading" && (
          <p className="settings-note">Inspecting recorder prerequisites…</p>
        )}

        {loadState === "error" && (
          <p className="settings-note">{errorMessage}</p>
        )}

        {loadState === "ready" && captureStatus && (
          <>
            <div className="capture-status-meta">
              <span className="status-chip">
                {captureStatus.available ? "Capture available" : "Capture unavailable"}
              </span>
              <span className="status-chip">
                {captureStatus.recorder
                  ? `Recorder ${captureStatus.recorder}`
                  : "Recorder missing"}
              </span>
              <span className="status-chip">
                {formatMicrophoneAccess(captureStatus.microphoneAccess)}
              </span>
            </div>

            {captureStatus.issues.length > 0 && (
              <ul className="capture-status-list capture-status-list--issues">
                {captureStatus.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            )}

            {captureStatus.notes.length > 0 && (
              <ul className="capture-status-list">
                {captureStatus.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <div className="settings-section">
        <h3>Audio devices</h3>
        <p>Devices reported by the local capture layer.</p>

        {loadState === "loading" && (
          <p className="settings-note">Loading local devices…</p>
        )}

        {loadState === "error" && (
          <p className="settings-note">{errorMessage}</p>
        )}

        {loadState === "ready" && devices.length === 0 && (
          <p className="settings-note">
            No live-capture devices are exposed until the recorder prerequisites
            pass. Import audio is still available.
          </p>
        )}

        {loadState === "ready" && devices.length > 0 && (
          <ul className="settings-device-list">
            {devices.map((device) => (
              <li key={device.id} className="settings-device">
                <span>{device.name}</span>
                {device.isDefault && (
                  <span className="status-chip">Default</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="settings-section">
        <h3>Local storage</h3>
        <p>
          Imported audio is copied into app-managed storage before the review
          session shell is created. That keeps the local archive stable even if
          the original file moves or is deleted.
        </p>
        <p className="settings-note">
          No cloud-analysis toggle is shown here because desktop no longer
          exposes the retired assessment workflow.
        </p>
      </div>
    </div>
  );
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
