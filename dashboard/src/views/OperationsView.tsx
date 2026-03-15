import React, { useEffect, useMemo, useState } from "react";

import { describeDashboardLoadIssue, type OpsEvent } from "../services/api";
import {
  EMPTY_OPERATIONS_SNAPSHOT,
  formatDateTime,
  formatStatusLabel,
  getOpsTone,
  loadOperationsSnapshot,
  sortOpsEvents,
  type OperationsSnapshot,
} from "../services/opsDashboard";

type OpsFilter = "all" | OpsEvent["type"];

const FILTERS: OpsFilter[] = [
  "all",
  "assist_requested",
  "assist_completed",
  "assist_failed",
  "assist_overridden",
  "redaction_blocked",
  "export_approved",
  "export_sent",
];

function matchesQuery(item: OpsEvent, query: string): boolean {
  if (!query) {
    return true;
  }

  const normalizedQuery = query.toLowerCase();

  return [
    item.id,
    item.localSessionId,
    item.exportId,
    item.assistReceiptId,
    item.actorId,
    item.provider,
    item.model,
    item.policyMode,
    item.errorCode,
    item.reviewerAction,
    item.type,
  ]
    .filter((value): value is string => typeof value === "string")
    .some((value) => value.toLowerCase().includes(normalizedQuery));
}

function buildDetails(item: OpsEvent): string {
  return (
    [
      item.provider,
      item.model,
      item.policyMode,
      item.errorCode,
      item.reviewerAction,
      item.exportId,
      item.assistReceiptId,
    ]
      .filter(Boolean)
      .join(" · ") || "No extra details"
  );
}

export default function OperationsView() {
  const [snapshot, setSnapshot] = useState<OperationsSnapshot>(
    EMPTY_OPERATIONS_SNAPSHOT
  );
  const [selectedFilter, setSelectedFilter] = useState<OpsFilter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let active = true;

    setLoading(true);
    setError(null);

    loadOperationsSnapshot()
      .then((data) => {
        if (active) {
          setSnapshot(data);
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

  const loadIssue = error ? describeDashboardLoadIssue(error) : null;
  const filteredEvents = useMemo(
    () =>
      sortOpsEvents(
        snapshot.opsEvents,
        selectedFilter === "all" ? "all" : selectedFilter
      ).filter((item) => matchesQuery(item, query)),
    [query, selectedFilter, snapshot.opsEvents]
  );

  const summary = useMemo(
    () => ({
      assistRequested: snapshot.opsEvents.filter(
        (item) => item.type === "assist_requested"
      ).length,
      assistOverrides: snapshot.opsEvents.filter(
        (item) => item.type === "assist_overridden"
      ).length,
      failures: snapshot.opsEvents.filter((item) => item.type === "assist_failed")
        .length,
      blocks: snapshot.opsEvents.filter((item) => item.type === "redaction_blocked")
        .length,
    }),
    [snapshot.opsEvents]
  );

  if (loading) {
    return <div className="empty-state">Loading operations data...</div>;
  }

  if (loadIssue) {
    return (
      <section className={`load-issue ${loadIssue.tone}`}>
        <strong>{loadIssue.title}</strong>
        <p>{loadIssue.detail}</p>
      </section>
    );
  }

  return (
    <div className="page-shell table-shell">
      <section className="page-header">
        <div>
          <p className="section-kicker">Operations</p>
          <h2>Ops event stream</h2>
        </div>
        <input
          className="search-field"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search session, actor, provider, error code"
          aria-label="Search operations events"
        />
      </section>

      <section className="stats-grid">
        <article className="stat-card">
          <div className="stat-label">Assist requests</div>
          <div className="stat-value active">{summary.assistRequested}</div>
          <p className="stat-detail">Requested by reviewers.</p>
        </article>
        <article className="stat-card">
          <div className="stat-label">Overrides</div>
          <div className="stat-value active">{summary.assistOverrides}</div>
          <p className="stat-detail">Assist outcomes overruled.</p>
        </article>
        <article className="stat-card">
          <div className="stat-label">Failures</div>
          <div className="stat-value attention">{summary.failures}</div>
          <p className="stat-detail">Assist or gateway failures.</p>
        </article>
        <article className="stat-card">
          <div className="stat-label">Redaction blocks</div>
          <div className="stat-value attention">{summary.blocks}</div>
          <p className="stat-detail">Sessions blocked by privacy rules.</p>
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
                {filter === "all" ? "All events" : formatStatusLabel(filter)}
              </button>
            ))}
          </div>
          <p className="view-status-copy">{filteredEvents.length} events shown</p>
        </div>

        {filteredEvents.length === 0 ? (
          <div className="empty-state compact">
            No operations events matched the current filter.
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Session</th>
                  <th>Actor</th>
                  <th>Details</th>
                  <th>Recorded</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="table-stack">
                        <span className={`status-badge ${getOpsTone(item.type)}`}>
                          {formatStatusLabel(item.type)}
                        </span>
                        <span className="mono-code">{item.id}</span>
                      </div>
                    </td>
                    <td>
                      <div className="table-stack">
                        <strong>{item.localSessionId}</strong>
                        <span className="table-meta">
                          {item.exportId ?? item.assistReceiptId ?? "No linked record"}
                        </span>
                      </div>
                    </td>
                    <td>{item.actorId ?? "System"}</td>
                    <td>{buildDetails(item)}</td>
                    <td>{formatDateTime(item.recordedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
