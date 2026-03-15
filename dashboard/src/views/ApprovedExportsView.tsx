import React, { useEffect, useState } from "react";
import {
  describeDashboardLoadIssue,
  type ApprovedExportEnvelope,
} from "../services/api";
import {
  formatDateTime,
  getExportTone,
  loadApprovedExports,
} from "../services/opsDashboard";

type ExportFilter = "all" | ApprovedExportEnvelope["export"]["status"];

const FILTERS: ExportFilter[] = ["all", "draft", "approved", "sent"];

export default function ApprovedExportsView() {
  const [exportsList, setExportsList] = useState<ApprovedExportEnvelope[]>([]);
  const [selectedFilter, setSelectedFilter] = useState<ExportFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const loadIssue = error ? describeDashboardLoadIssue(error) : null;

  useEffect(() => {
    let active = true;

    setLoading(true);
    setError(null);

    loadApprovedExports(selectedFilter)
      .then((data) => {
        if (active) {
          setExportsList(data);
        }
      })
      .catch((fetchError) => {
        if (active) {
          setError(fetchError);
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
  }, [selectedFilter]);

  if (loading) {
    return <div className="empty-state">Loading approved export envelopes...</div>;
  }

  return (
    <div className="table-shell">
      <div className="table-header">
        <div>
          <h2>Approved export envelopes</h2>
          <p>
            Boundary-safe export envelopes and delivery metadata that are ready
            for manual release or already sent downstream.
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
              {filter === "all" ? "All envelopes" : filter}
            </button>
          ))}
        </div>
      </div>

      {loadIssue ? (
        <section className={`load-issue ${loadIssue.tone}`}>
          <strong>{loadIssue.title}</strong>
          <p>{loadIssue.detail}</p>
        </section>
      ) : exportsList.length === 0 ? (
        <div className="empty-state">
          No approved export envelopes matched the current delivery state.
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Approved</th>
              <th>Export</th>
              <th>Session</th>
              <th>Status</th>
              <th>Approved findings</th>
              <th>Approved by</th>
              <th>Destination</th>
            </tr>
          </thead>
          <tbody>
            {exportsList.map((item) => (
              <tr key={item.id}>
                <td>{formatDateTime(item.export.approvedAt)}</td>
                <td>
                  <div className="mono-code">{item.id}</div>
                  <div className="table-meta">{item.export.summary}</div>
                </td>
                <td>
                  <span className="mono-code">{item.session.localSessionId}</span>
                  <div className="table-meta">{item.session.clinicianId}</div>
                </td>
                <td>
                  <span
                    className={`status-badge ${getExportTone(item.export.status)}`}
                  >
                    {item.export.status}
                  </span>
                </td>
                <td>{item.export.findings.length}</td>
                <td>{item.export.approvedBy}</td>
                <td>{item.export.destination ?? "Compliance hold"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
