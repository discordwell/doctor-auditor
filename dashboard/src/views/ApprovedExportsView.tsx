import React, { useEffect, useMemo, useState } from "react";
import { api, ApprovedExport } from "../services/api";
import {
  formatDateTime,
  getExportTone,
  previewApprovedExports,
  sortApprovedExports,
} from "../services/reviewDashboard";

type ExportFilter = "all" | ApprovedExport["status"];

const FILTERS: ExportFilter[] = ["all", "draft", "approved", "sent"];

export default function ApprovedExportsView() {
  const [exportsList, setExportsList] =
    useState<ApprovedExport[]>(previewApprovedExports);
  const [selectedFilter, setSelectedFilter] = useState<ExportFilter>("all");
  const [loading, setLoading] = useState(true);
  const [sourceMode, setSourceMode] = useState<"live" | "preview">("preview");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;

    setLoading(true);
    setNotice("");

    api
      .getApprovedExports()
      .then((data) => {
        if (active) {
          setExportsList(data);
          setSourceMode("live");
        }
      })
      .catch((fetchError) => {
        if (active) {
          setExportsList(previewApprovedExports);
          setSourceMode("preview");
          setNotice(
            fetchError instanceof Error
              ? `Live export lane unavailable. Showing preview data instead. ${fetchError.message}`
              : "Live export lane unavailable. Showing preview data instead."
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

  const visibleExports = useMemo(
    () => sortApprovedExports(exportsList, selectedFilter),
    [exportsList, selectedFilter]
  );

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
          {sourceMode === "live" ? "Live exports" : "Preview fallback"}
        </span>
        {notice ? <span className="view-status-copy">{notice}</span> : null}
      </div>

      {visibleExports.length === 0 ? (
        <div className="empty-state">
          No approved exports matched the current delivery state.
        </div>
      ) : null}

      {visibleExports.length > 0 ? (
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
            {visibleExports.map((item) => (
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
