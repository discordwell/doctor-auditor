import React, { useEffect, useState } from "react";
import type { ApprovedExport } from "../services/api";
import {
  formatDateTime,
  getExportTone,
  loadApprovedExports,
  type ResourceSourceMode,
} from "../services/reviewDashboard";

type ExportFilter = "all" | ApprovedExport["status"];

const FILTERS: ExportFilter[] = ["all", "draft", "approved", "sent"];

export default function ApprovedExportsView() {
  const [exportsList, setExportsList] = useState<ApprovedExport[]>([]);
  const [selectedFilter, setSelectedFilter] = useState<ExportFilter>("all");
  const [loading, setLoading] = useState(true);
  const [sourceMode, setSourceMode] = useState<ResourceSourceMode>("live");
  const [sourceMessage, setSourceMessage] = useState("");

  useEffect(() => {
    let active = true;

    setLoading(true);

    loadApprovedExports(selectedFilter)
      .then((result) => {
        if (!active) {
          return;
        }

        setExportsList(result.data);
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
    return <div className="empty-state">Loading approved exports...</div>;
  }

  return (
    <div className="table-shell">
      <div className="table-header">
        <div>
          <h2>Approved exports</h2>
          <p>
            Reviewed summaries and evidence excerpts that are ready for manual
            delivery or already sent downstream.
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
              {filter === "all" ? "All exports" : filter}
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

      {exportsList.length === 0 ? (
        <div className="empty-state">
          No approved exports matched the current delivery state.
        </div>
      ) : null}

      {exportsList.length > 0 ? (
        <table className="data-table">
          <thead>
            <tr>
              <th>Approved</th>
              <th>Export</th>
              <th>Session</th>
              <th>Status</th>
              <th>Findings</th>
              <th>Approved by</th>
              <th>Destination</th>
            </tr>
          </thead>
          <tbody>
            {exportsList.map((item) => (
              <tr key={item.id}>
                <td>{formatDateTime(item.approvedAt)}</td>
                <td>
                  <div className="mono-code">{item.id}</div>
                  <div className="table-meta">{item.summary}</div>
                </td>
                <td>
                  <span className="mono-code">{item.sessionId}</span>
                </td>
                <td>
                  <span className={`status-badge ${getExportTone(item.status)}`}>
                    {item.status}
                  </span>
                </td>
                <td>{item.findings.length}</td>
                <td>{item.approvedBy}</td>
                <td>{item.destination ?? "Manual review hold"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
