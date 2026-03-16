import React, { useEffect, useMemo, useState } from "react";

import { describeDashboardLoadIssue, type OpsEvent } from "../services/api";
import {
  buildAssistAssessmentCards,
  EMPTY_OPERATIONS_SNAPSHOT,
  formatAssistDisposition,
  formatDateTime,
  formatLatency,
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

function formatConfidence(confidence: number | null): string {
  if (confidence === null) {
    return "No assessment returned";
  }

  return `${Math.round(confidence * 100)}% confidence`;
}

function formatReviewerAction(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

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
    item.assessment?.disposition,
    item.assessment?.rationale,
    ...(item.assessment?.limitations ?? []),
  ]
    .filter((value): value is string => typeof value === "string")
    .some((value) => value.toLowerCase().includes(normalizedQuery));
}

function buildDetails(item: OpsEvent): string {
  if (item.assessment) {
    return [
      `${formatAssistDisposition(item.assessment.disposition)} · ${Math.round(
        item.assessment.confidence * 100
      )}% confidence`,
      item.assessment.rationale,
    ].join(" · ");
  }

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
  const assistCards = useMemo(
    () => buildAssistAssessmentCards(snapshot.opsEvents),
    [snapshot.opsEvents]
  );
  const spotlightCard = useMemo(
    () =>
      assistCards.find(
        (item) =>
          item.status === "completed" &&
          item.disposition === "expedited_human_review"
      ) ?? assistCards[0] ?? null,
    [assistCards]
  );
  const summary = useMemo(
    () => ({
      requested: snapshot.opsEvents.filter((item) => item.type === "assist_requested")
        .length,
      expedited: assistCards.filter(
        (item) => item.disposition === "expedited_human_review"
      ).length,
      insufficient: assistCards.filter(
        (item) => item.disposition === "insufficient_context"
      ).length,
      failures: assistCards.filter((item) => item.status === "failed").length,
    }),
    [assistCards, snapshot.opsEvents]
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
    <div className="page-shell operations-shell">
      <section className="page-header operations-hero">
        <div>
          <p className="section-kicker">Operations</p>
          <h2>Remote assist and delivery activity</h2>
          <p className="page-copy">
            Actual gateway assessments are shown below exactly as they were
            returned for minimized assist requests. No raw transcript or audio is
            present in this view.
          </p>
        </div>
        {spotlightCard ? (
          <article className={`operations-spotlight ${spotlightCard.tone}`}>
            <span className="operations-spotlight__eyebrow">
              {spotlightCard.status === "failed"
                ? "Latest assist failure"
                : "Assessment spotlight"}
            </span>
            <h3>
              {spotlightCard.disposition
                ? formatAssistDisposition(spotlightCard.disposition)
                : "Remote assist failed"}
            </h3>
            <p>{spotlightCard.rationale}</p>
            <div className="operations-spotlight__meta">
              <span>{spotlightCard.localSessionId}</span>
              <span>{formatConfidence(spotlightCard.confidence)}</span>
              <span>{formatLatency(spotlightCard.latencyMs)}</span>
            </div>
          </article>
        ) : null}
      </section>

      <section className="stats-grid">
        <article className="stat-card">
          <div className="stat-label">Assist requests</div>
          <div className="stat-value active">{summary.requested}</div>
          <p className="stat-detail">Reviewers who asked the cloud gateway for help.</p>
        </article>
        <article className="stat-card">
          <div className="stat-label">High-acuity assists</div>
          <div className="stat-value attention">{summary.expedited}</div>
          <p className="stat-detail">Returned as expedited human review.</p>
        </article>
        <article className="stat-card">
          <div className="stat-label">Thin context</div>
          <div className="stat-value neutral">{summary.insufficient}</div>
          <p className="stat-detail">
            Completed assists that came back as insufficient context.
          </p>
        </article>
        <article className="stat-card">
          <div className="stat-label">Failures</div>
          <div className="stat-value attention">{summary.failures}</div>
          <p className="stat-detail">Requests that failed before an assessment returned.</p>
        </article>
      </section>

      <section className="panel-card assist-panel">
        <div className="panel-header">
          <div>
            <p className="section-kicker">Assist Results</p>
            <h3>Latest gateway assessments</h3>
          </div>
          <p>
            Disposition, rationale, limitations, and reviewer overrides for the
            newest Remote assist receipts.
          </p>
        </div>

        {assistCards.length === 0 ? (
          <div className="empty-state compact">
            No Remote assist results have been recorded yet.
          </div>
        ) : (
          <div className="assist-card-grid">
            {assistCards.map((card) => (
              <article key={card.id} className={`assist-card ${card.tone}`}>
                <div className="assist-card__top">
                  <div>
                    <span className="assist-card__eyebrow">
                      {card.localSessionId} · {card.actorId ?? "System"}
                    </span>
                    <h4>
                      {card.disposition
                        ? formatAssistDisposition(card.disposition)
                        : "Remote assist failed"}
                    </h4>
                  </div>
                  <span className={`status-badge ${card.tone}`}>
                    {card.status === "failed"
                      ? "Failed"
                      : card.disposition
                        ? formatAssistDisposition(card.disposition)
                        : "Completed"}
                  </span>
                </div>

                <p className="assist-card__summary">{card.rationale}</p>

                <div className="assist-card__metrics">
                  <span>{formatConfidence(card.confidence)}</span>
                  <span>{formatLatency(card.latencyMs)}</span>
                  <span>{formatDateTime(card.recordedAt)}</span>
                </div>

                {card.limitations.length > 0 ? (
                  <div className="assist-card__limitations">
                    {card.limitations.map((item) => (
                      <span key={item} className="assist-chip">
                        {item}
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="assist-card__meta">
                  <span>{card.provider ?? "Provider unavailable"}</span>
                  <span>{card.model ?? "Model unavailable"}</span>
                  <span>{card.policyMode ?? "Policy unavailable"}</span>
                  {card.reviewerAction ? (
                    <span>Reviewer: {formatReviewerAction(card.reviewerAction)}</span>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
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
          <p className="view-status-copy">
            {filteredEvents.length} events shown · {assistCards.length} assist results
          </p>
        </div>

        <input
          className="search-field operations-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search session, model, disposition, rationale, error code"
          aria-label="Search operations events"
        />

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
                  <th>Assessment or detail</th>
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
