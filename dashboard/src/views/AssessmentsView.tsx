import React, { useEffect, useState } from "react";
import type { Finding, FindingStatus } from "../services/api";
import {
  formatDateTime,
  formatStatusLabel,
  getFindingTone,
  loadFindings,
  type ResourceSourceMode,
} from "../services/reviewDashboard";

type FindingFilter = "all" | FindingStatus;

const FILTERS: FindingFilter[] = [
  "all",
  "pending_review",
  "accepted",
  "rejected",
  "uncertain",
];

export default function AssessmentsView() {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [selectedFilter, setSelectedFilter] = useState<FindingFilter>("all");
  const [loading, setLoading] = useState(true);
  const [sourceMode, setSourceMode] = useState<ResourceSourceMode>("live");
  const [sourceMessage, setSourceMessage] = useState("");

  useEffect(() => {
    let active = true;

    setLoading(true);

    loadFindings(selectedFilter)
      .then((result) => {
        if (!active) {
          return;
        }

        setFindings(result.data);
        setSourceMode(result.sourceMode);
        setSourceMessage(result.message);
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [selectedFilter]);

  if (loading) {
    return <div className="empty-state">Loading findings...</div>;
  }

  return (
    <div className="table-shell">
      <div className="table-header">
        <div>
          <h2>Findings</h2>
          <p>
            Evidence-linked findings waiting for reviewer confirmation, edits,
            or rejection.
          </p>
        </div>
        <div className="filter-row">
          {FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              className={`filter-chip ${
                selectedFilter === filter ? "active" : ""
              }`}
              onClick={() => setSelectedFilter(filter)}
            >
              {filter === "all" ? "All findings" : formatStatusLabel(filter)}
            </button>
          ))}
        </div>
      </div>

      <div className="view-status">
        <span className={`source-pill ${sourceMode}`}>
          {sourceMode === "live" ? "Live review data" : "Preview fallback"}
        </span>
        <span className="view-status-copy">{sourceMessage}</span>
      </div>

      {findings.length === 0 ? (
        <div className="empty-state">
          No findings matched the current review state.
        </div>
      ) : null}

      {findings.length > 0 ? (
        <table className="data-table">
          <thead>
            <tr>
              <th>Updated</th>
              <th>Finding</th>
              <th>Session</th>
              <th>Status</th>
              <th>Confidence</th>
              <th>Source</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {findings.map((finding) => (
              <tr key={finding.id}>
                <td>{formatDateTime(finding.updatedAt)}</td>
                <td>
                  <div>{finding.title}</div>
                  <div className="table-meta">{finding.code}</div>
                </td>
                <td>
                  <span className="mono-code">{finding.sessionId}</span>
                </td>
                <td>
                  <span className={`status-badge ${getFindingTone(finding.status)}`}>
                    {formatStatusLabel(finding.status)}
                  </span>
                </td>
                <td>{Math.round(finding.confidence * 100)}%</td>
                <td>{formatStatusLabel(finding.detectedBy)}</td>
                <td>{finding.evidenceSpans.length} span(s)</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
