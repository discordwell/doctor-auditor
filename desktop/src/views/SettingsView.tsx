import React, { useState } from "react";

export default function SettingsView() {
  const [cloudConsent, setCloudConsent] = useState(false);

  const toggleCloudConsent = async () => {
    const newValue = !cloudConsent;
    if (window.doctorAuditor) {
      await window.doctorAuditor.settings.setCloudConsent(newValue);
    }
    setCloudConsent(newValue);
  };

  return (
    <div className="settings-view">
      <h2>Settings</h2>

      <div className="settings-section">
        <h3>Cloud Analysis (Claude API)</h3>
        <p>
          Enable cloud-based analysis for higher accuracy risk assessments.
          Transcripts will be de-identified before sending — all patient names,
          dates, addresses, and medical record numbers are stripped.
        </p>
        <div className="toggle" onClick={toggleCloudConsent}>
          <div className={`toggle-track ${cloudConsent ? "active" : ""}`}>
            <div className="toggle-thumb" />
          </div>
          <span className="toggle-label">
            {cloudConsent
              ? "Cloud analysis enabled"
              : "Cloud analysis disabled (local only)"}
          </span>
        </div>
        {cloudConsent && (
          <div className="consent-warning">
            De-identified transcript snippets will be sent to Anthropic's Claude
            API for analysis. No patient names, dates, or identifying
            information will be transmitted. All transmissions are logged in the
            audit trail.
          </div>
        )}
      </div>

      <div className="settings-section">
        <h3>Audio Device</h3>
        <p>Select the microphone to use for recording consultations.</p>
        <select
          style={{
            background: "var(--bg-secondary)",
            color: "var(--text-primary)",
            border: "1px solid var(--border)",
            padding: "8px 12px",
            borderRadius: "6px",
            width: "100%",
            fontSize: "14px",
          }}
        >
          <option>Default Microphone</option>
        </select>
      </div>

      <div className="settings-section">
        <h3>Local LLM Model</h3>
        <p>
          The local analysis model running via Ollama. Larger models are more
          accurate but slower.
        </p>
        <select
          style={{
            background: "var(--bg-secondary)",
            color: "var(--text-primary)",
            border: "1px solid var(--border)",
            padding: "8px 12px",
            borderRadius: "6px",
            width: "100%",
            fontSize: "14px",
          }}
        >
          <option>llama3.1:8b (Recommended)</option>
          <option>mistral:7b</option>
          <option>llama3.1:70b (Slower, more accurate)</option>
        </select>
      </div>

      <div className="settings-section">
        <h3>Data Retention</h3>
        <p>
          How long to keep audio recordings and transcripts on this device.
          Risk assessments sent to the cloud are managed separately.
        </p>
        <select
          style={{
            background: "var(--bg-secondary)",
            color: "var(--text-primary)",
            border: "1px solid var(--border)",
            padding: "8px 12px",
            borderRadius: "6px",
            width: "100%",
            fontSize: "14px",
          }}
        >
          <option>30 days</option>
          <option>90 days</option>
          <option>1 year</option>
          <option>Indefinite</option>
        </select>
      </div>
    </div>
  );
}
