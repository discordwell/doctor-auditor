import React, { useState, useEffect } from "react";
import { api, Assessment } from "../services/api";

export default function AssessmentsView() {
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [riskFilter, setRiskFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getAssessments(riskFilter ? { risk_level: riskFilter } : undefined)
      .then(setAssessments)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [riskFilter]);

  if (loading) return <div className="empty-state">Loading...</div>;

  const formatDate = (iso: string): string =>
    new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const formatDuration = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    return `${m}m`;
  };

  return (
    <div>
      <h2>Assessments</h2>

      <div style={{ marginBottom: 16, display: "flex", gap: 8 }}>
        {["", "high", "medium", "low"].map((level) => (
          <button
            key={level}
            onClick={() => setRiskFilter(level)}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background:
                riskFilter === level
                  ? "var(--accent)"
                  : "var(--bg-card)",
              color: "var(--text-primary)",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            {level || "All"}
          </button>
        ))}
      </div>

      {assessments.length === 0 ? (
        <div className="empty-state">No assessments match the filter.</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Doctor</th>
              <th>Duration</th>
              <th>Comm</th>
              <th>Clinical</th>
              <th>Behavioral</th>
              <th>Overall</th>
              <th>Risk</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {assessments.map((a) => (
              <tr key={a.id}>
                <td>{formatDate(a.timestamp)}</td>
                <td>{a.doctor_id}</td>
                <td>{formatDuration(a.duration)}</td>
                <td>{a.communication_score}</td>
                <td>{a.clinical_score}</td>
                <td>{a.behavioral_score}</td>
                <td>{a.overall_score}</td>
                <td>
                  <span className={`risk-badge ${a.overall_risk}`}>
                    {a.overall_risk}
                  </span>
                </td>
                <td>{a.analysis_source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
