import React, { useEffect, useState } from "react";

type LoadState = "loading" | "ready" | "error";

interface AudioDevice {
  id: string;
  name: string;
  isDefault: boolean;
}

export default function SettingsView() {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    async function loadDevices() {
      if (!window.doctorAuditor) {
        setLoadState("error");
        setErrorMessage("Desktop audio API unavailable.");
        return;
      }

      try {
        const deviceList = await window.doctorAuditor.audio.getDevices();
        setDevices(deviceList);
        setLoadState("ready");
      } catch (error) {
        setLoadState("error");
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Unable to read local audio devices."
        );
      }
    }

    void loadDevices();
  }, []);

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
        <h3>Audio devices</h3>
        <p>Devices reported by the local capture layer.</p>

        {loadState === "loading" && (
          <p className="settings-note">Loading local devices…</p>
        )}

        {loadState === "error" && (
          <p className="settings-note">{errorMessage}</p>
        )}

        {loadState === "ready" && (
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
