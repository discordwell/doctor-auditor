import React, { useEffect, useMemo, useState } from "react";
import { api, ReviewSession } from "../services/api";
import {
  formatDateTime,
  formatStatusLabel,
  getSessionStatusTone,
  previewSessions,
  sortSessions,
} from "../services/reviewDashboard";

type SessionFilter = "all" | "ready" | "in_review" | "completed";

const FILTERS: SessionFilter[] = ["all", "ready", "in_review", "completed"];

export default function DoctorsView() {
  const [sessions, setSessions] = useState<ReviewSession[]>(previewSessions);
  const [selectedFilter, setSelectedFilter] = useState<SessionFilter>("all");
  const [loading, setLoading] = useState(true);
  const [sourceMode, setSourceMode] = useState<"live" | "preview">("preview");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;

    setLoading(true);
    setNotice("");

    api
      .getSessions()
      .then((data) => {
        if (active) {
          setSessions(data);
          setSourceMode("live");
        }
      })
      .catch((fetchError) => {
        if (active) {
          setSessions(previewSessions);
          setSourceMode("preview");
          setNotice(
            fetchError instanceof Error
              ? `Live review sessions unavailable. Showing preview data instead. ${fetchError.message}`
              : "Live review sessions unavailable. Showing preview data instead."
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const visibleSessions = useMemo(
    () => sortSessions(sessions, selectedFilter),
    [selectedFilter, sessions]
  );

  if (loading) {
    return <div className="empty-state">Loading review sessions...</div>;
  }

  return (
    <div className="table-shell">
      <div className="table-header">
        <div>
          <h2>Sessions</h2>
          <p>
            Review-ready encounter sessions flowing into transcript, findings,
            and export approval work.
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
              {filter === "all" ? "All sessions" : formatStatusLabel(filter)}
            </button>
          ))}
        </div>
      </div>

      <div className="view-status">
        <span className={`source-pill ${sourceMode}`}>
          {sourceMode === "live" ? "Live sessions" : "Preview fallback"}
        </span>
        {notice ? <span className="view-status-copy">{notice}</span> : null}
      </div>

      {visibleSessions.length === 0 ? (
        <div className="empty-state">
          No sessions matched the current review filter.
        </div>
      ) : null}

      {visibleSessions.length > 0 ? (
        <table className="data-table">
          <thead>
            <tr>
              <th>Session</th>
              <th>Clinician</th>
              <th>Started</th>
              <th>Capture</th>
              <th>Transcript</th>
              <th>Review</th>
              <th>Export</th>
            </tr>
          </thead>
          <tbody>
            {visibleSessions.map((session) => (
              <tr key={session.id}>
                <td>
                  <div className="mono-code">{session.id}</div>
                </td>
                <td>{session.clinicianId}</td>
                <td>
                  <div>{formatDateTime(session.encounterStartedAt)}</div>
                  <div className="table-meta">
                    Updated {formatDateTime(session.updatedAt)}
                  </div>
                </td>
                <td>{formatStatusLabel(session.captureMode)}</td>
                <td>
                  <span
                    className={`status-badge ${getSessionStatusTone(session.transcriptStatus)}`}
                  >
                    {formatStatusLabel(session.transcriptStatus)}
                  </span>
                </td>
                <td>
                  <span
                    className={`status-badge ${getSessionStatusTone(session.reviewStatus)}`}
                  >
                    {formatStatusLabel(session.reviewStatus)}
                  </span>
                </td>
                <td>
                  <span
                    className={`status-badge ${getSessionStatusTone(session.exportStatus)}`}
                  >
                    {formatStatusLabel(session.exportStatus)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
