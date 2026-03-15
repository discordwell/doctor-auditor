import React, { useEffect, useMemo, useState } from "react";

import {
  describeDashboardLoadIssue,
  type ApprovedExportEnvelope,
} from "../services/api";
import {
  formatDateTime,
  formatRelativeAge,
  formatStatusLabel,
  getExportTone,
  loadApprovedExports,
} from "../services/opsDashboard";

type ExportFilter = "all" | ApprovedExportEnvelope["export"]["status"];

const FILTERS: ExportFilter[] = ["all", "draft", "approved", "sent"];

function getUpdatedAt(item: ApprovedExportEnvelope): string {
  if (item.export.status === "sent" && item.export.sentAt) {
    return item.export.sentAt;
  }

  if (item.export.status === "draft") {
    return item.attestation.reviewCompletedAt;
  }

  return item.export.approvedAt;
}

function matchesQuery(item: ApprovedExportEnvelope, query: string): boolean {
  if (!query) {
    return true;
  }

  const normalizedQuery = query.toLowerCase();

  return [
    item.id,
    item.session.localSessionId,
    item.session.clinicianId,
    item.export.summary,
    item.export.destination,
    item.attestation.reviewedBy,
    item.export.approvedBy,
    item.session.captureMode,
  ]
    .filter((value): value is string => typeof value === "string")
    .some((value) => value.toLowerCase().includes(normalizedQuery));
}

export default function ApprovedExportsView() {
  const [allExports, setAllExports] = useState<ApprovedExportEnvelope[]>([]);
  const [selectedFilter, setSelectedFilter] = useState<ExportFilter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const loadIssue = error ? describeDashboardLoadIssue(error) : null;

  useEffect(() => {
    let active = true;

    setLoading(true);
    setError(null);

    loadApprovedExports("all")
      .then((data) => {
        if (active) {
          setAllExports(data);
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
  }, []);

  const filteredExports = useMemo(
    () =>
      allExports.filter(
        (item) =>
          (selectedFilter === "all" || item.export.status === selectedFilter) &&
          matchesQuery(item, query)
      ),
    [allExports, query, selectedFilter]
  );

  const summary = useMemo(
    () => ({
      total: allExports.length,
      draft: allExports.filter((item) => item.export.status === "draft").length,
      approved: allExports.filter((item) => item.export.status === "approved")
        .length,
      sent: allExports.filter((item) => item.export.status === "sent").length,
    }),
    [allExports]
  );

  if (loading) {
    return <div className="empty-state">Loading export data...</div>;
  }

  return (
    <div className="page-shell table-shell">
      <section className="page-header">
        <div>
          <p className="section-kicker">Exports</p>
          <h2>Release queue</h2>
          <p className="page-copy">
            Review approved exports, what is still in review, and what has
            already been delivered downstream.
          </p>
        </div>
        <input
          className="search-field"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search clinician, session, destination, summary"
          aria-label="Search approved exports"
        />
      </section>

      <section className="stats-grid">
        <article className="stat-card">
          <div className="stat-label">All exports</div>
          <div className="stat-value neutral">{summary.total}</div>
          <p className="stat-detail">Every export envelope in the current org.</p>
        </article>
        <article className="stat-card">
          <div className="stat-label">In review</div>
          <div className="stat-value active">{summary.draft}</div>
          <p className="stat-detail">Reviewed locally but not approved yet.</p>
        </article>
        <article className="stat-card">
          <div className="stat-label">Ready to send</div>
          <div className="stat-value attention">{summary.approved}</div>
          <p className="stat-detail">Approved and waiting for release.</p>
        </article>
        <article className="stat-card">
          <div className="stat-label">Sent</div>
          <div className="stat-value success">{summary.sent}</div>
          <p className="stat-detail">Delivered after review and approval.</p>
        </article>
      </section>

      <section className="panel-card">
        <div className="table-toolbar">
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
                {filter === "all" ? "All exports" : formatStatusLabel(filter)}
              </button>
            ))}
          </div>
          <p className="view-status-copy">{filteredExports.length} exports shown</p>
        </div>

        {loadIssue ? (
          <section className={`load-issue ${loadIssue.tone}`}>
            <strong>{loadIssue.title}</strong>
            <p>{loadIssue.detail}</p>
          </section>
        ) : filteredExports.length === 0 ? (
          <div className="empty-state compact">
            No exports matched the current filter.
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Summary</th>
                  <th>Status</th>
                  <th>Owner</th>
                  <th>Destination</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {filteredExports.map((item) => {
                  const updatedAt = getUpdatedAt(item);

                  return (
                    <tr key={item.id}>
                      <td>
                        <div className="table-stack">
                          <strong>{item.session.clinicianId}</strong>
                          <span className="table-meta">
                            {item.session.localSessionId} · {item.session.captureMode}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="table-stack">
                          <span className="mono-code">{item.id}</span>
                          <strong>{item.export.summary}</strong>
                          <span className="table-meta">
                            {item.export.findings.length} approved findings
                          </span>
                        </div>
                      </td>
                      <td>
                        <span
                          className={`status-badge ${getExportTone(item.export.status)}`}
                        >
                          {formatStatusLabel(item.export.status)}
                        </span>
                      </td>
                      <td>
                        <div className="table-stack">
                          <strong>{item.attestation.reviewedBy}</strong>
                          <span className="table-meta">
                            Approved by {item.export.approvedBy}
                          </span>
                        </div>
                      </td>
                      <td>{item.export.destination ?? "Destination not set"}</td>
                      <td>
                        <div className="table-stack">
                          <strong>{formatDateTime(updatedAt)}</strong>
                          <span className="table-meta">
                            {formatRelativeAge(updatedAt)}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
