import React, { useCallback, useEffect, useState } from "react";
import type {
  AudioDevice,
  CloudSyncDisplayConfig,
  LiveCaptureStatus,
} from "../types/electron";
import { formatMicrophoneAccess } from "./liveCaptureModel";

type LoadState = "loading" | "ready" | "error";

export default function SettingsView() {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [captureStatus, setCaptureStatus] = useState<LiveCaptureStatus | null>(
    null
  );
  const [cloudConfig, setCloudConfig] = useState<CloudSyncDisplayConfig | null>(
    null
  );
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [cloudConfigError, setCloudConfigError] = useState("");
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

  useEffect(() => {
    if (!window.doctorAuditor) {
      return;
    }

    void window.doctorAuditor.cloud
      .getConfiguration()
      .then((nextConfig) => {
        setCloudConfig(nextConfig);
        setCloudConfigError("");
      })
      .catch((error) => {
        setCloudConfig(null);
        setCloudConfigError(
          error instanceof Error
            ? error.message
            : "Unable to inspect the remote boundary."
        );
      });
  }, []);

  return (
    <div className="settings-view">
      <h2>Settings</h2>

      <div className="settings-section">
        <h3>Cloud connection</h3>
        <p>
          Raw audio and transcripts stay on this machine. Approved exports and
          Remote assist requests use the hosted API.
        </p>

        {cloudConfig && (
          <>
            <div className="capture-status-meta">
              <span className="status-chip">
                {formatCloudSyncSource(cloudConfig.apiBaseUrlSource)}
              </span>
              <span className="status-chip">Org {cloudConfig.organizationId}</span>
              <span className="status-chip">Role {cloudConfig.role}</span>
            </div>

            <ul className="settings-device-list">
              <li className="settings-device">
                <span>API base</span>
                <span>{cloudConfig.apiBaseUrl}</span>
              </li>
              <li className="settings-device">
                <span>Auth email</span>
                <span>{cloudConfig.email}</span>
              </li>
              <li className="settings-device">
                <span>Organization</span>
                <span>{cloudConfig.organizationId}</span>
              </li>
            </ul>
          </>
        )}

        {!cloudConfig && (
          <p className="settings-note">
            {cloudConfigError || "Loading cloud connection..."}
          </p>
        )}
      </div>

      <div className="settings-section">
        <h3>Session workflow</h3>
        <p>
          Every recording or loaded audio file creates a review session. The
          transcript, review progress, and export state are tracked together so
          sessions are easy to resume later.
        </p>
        <ul className="settings-list">
          <li>Consent is confirmed before a session is created.</li>
          <li>Audio stays local until a later approved export step exists.</li>
          <li>Transcript, review, and export progress stay in sync.</li>
        </ul>
      </div>

      <div className="settings-section">
        <div className="settings-section__header">
          <div>
            <h3>Live recording</h3>
            <p>
              Check whether the recorder and default microphone are ready for a
              new recording.
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
                {captureStatus.available
                  ? "Recording available"
                  : "Recording unavailable"}
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
        <h3>Microphone</h3>
        <p>
          The app records from the system default microphone.
        </p>

        {loadState === "loading" && (
          <p className="settings-note">Loading local devices…</p>
        )}

        {loadState === "error" && (
          <p className="settings-note">{errorMessage}</p>
        )}

        {loadState === "ready" && devices.length === 0 && (
          <p className="settings-note">
            No recording devices are available until the recorder checks pass.
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
          Loaded audio is copied into app storage so sessions remain available
          even if the original file moves or is deleted.
        </p>
        <p className="settings-note">
          Review data stays local unless you choose an approved export or use
          Remote assist.
        </p>
      </div>
    </div>
  );
}

function formatCloudSyncSource(
  value: CloudSyncDisplayConfig["apiBaseUrlSource"]
): string {
  switch (value) {
    case "environment_override":
      return "Environment override";
    case "hosted_default":
      return "Hosted default";
  }
}
