import React, { useEffect, useMemo, useState } from "react";

import { describeDashboardLoadIssue, type OpsEvent } from "../services/api";
import {
  buildAssistAssessmentCards,
  buildSessionActivityGroups,
  EMPTY_OPERATIONS_SNAPSHOT,
  formatAssistDisposition,
  formatDateTime,
  formatLatency,
  formatStatusLabel,
  getExportTone,
  loadOperationsSnapshot,
  type OperationsSnapshot,
  type SessionActivityGroup,
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

function formatEncounterWindow(group: SessionActivityGroup): string | null {
  if (!group.encounterStartedAt) {
    return null;
  }

  const start = new Date(group.encounterStartedAt);
  const end = group.encounterEndedAt ? new Date(group.encounterEndedAt) : null;
  const startLabel = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(start);

  if (!end) {
    return startLabel;
  }

  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();
  const endLabel = new Intl.DateTimeFormat("en-US", {
    ...(sameDay ? {} : { month: "short", day: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  }).format(end);

  return `${startLabel} to ${endLabel}`;
}

function getLatestAssistBadgeLabel(group: SessionActivityGroup): string | null {
  if (group.latestAssistStatus === "failed") {
    return "Assist failed";
  }

  if (group.latestAssistDisposition) {
    return formatAssistDisposition(group.latestAssistDisposition);
  }

  if (group.latestAssistStatus === "completed") {
    return "Assist returned";
  }

  return null;
}

function matchesSessionGroup(
  group: SessionActivityGroup,
  filter: OpsFilter,
  query: string
): boolean {
  if (filter !== "all" && !group.eventTypes.includes(filter)) {
    return false;
  }

  if (!query) {
    return true;
  }

  const normalizedQuery = query.toLowerCase();

  return [
    group.localSessionId,
    group.clinicianId,
    group.captureMode,
    group.exportStatus,
    group.exportSummary,
    group.destination,
    group.approvedBy,
    group.reviewedBy,
    group.latestAssistDisposition,
    group.latestAssistRationale,
    group.latestAssistProvider,
    group.latestAssistModel,
    group.latestAssistPolicyMode,
    group.latestAssistReviewerAction,
    group.latestAssistErrorCode,
    ...group.latestAssistLimitations,
    ...group.findings.map((item) => item.title),
    ...group.findings.map((item) => item.summary),
    ...group.activity.map((item) => item.label),
    ...group.activity.map((item) => item.detail),
  ]
    .filter((value): value is string => typeof value === "string")
    .some((value) => value.toLowerCase().includes(normalizedQuery));
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
  const sessionGroups = useMemo(
    () => buildSessionActivityGroups(snapshot),
    [snapshot]
  );
  const filteredGroups = useMemo(
    () =>
      sessionGroups.filter((group) =>
        matchesSessionGroup(group, selectedFilter, query)
      ),
    [query, selectedFilter, sessionGroups]
  );
  const assistCards = useMemo(
    () => buildAssistAssessmentCards(snapshot.opsEvents),
    [snapshot.opsEvents]
  );
  const groupedEventCount = useMemo(
    () => filteredGroups.reduce((total, group) => total + group.eventCount, 0),
    [filteredGroups]
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
            Each session card groups related assist and export actions together,
            then pairs the reviewed session summary with the latest gateway
            response. No raw transcript or audio is present in this view.
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
        <div className="panel-header">
          <div>
            <p className="section-kicker">Session Activity</p>
            <h3>Grouped assist and export activity</h3>
          </div>
          <p>
            Related actions collapse into one session card so you can see the
            reviewed session context, the latest LLM response, and the event
            timeline together.
          </p>
        </div>

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
            {filteredGroups.length} sessions shown · {groupedEventCount} grouped events
          </p>
        </div>

        <input
          className="search-field operations-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search session, clinician, summary, finding, model, rationale, error code"
          aria-label="Search grouped operations sessions"
        />

        {filteredGroups.length === 0 ? (
          <div className="empty-state compact">
            No grouped sessions matched the current filter.
          </div>
        ) : (
          <div className="session-activity-grid">
            {filteredGroups.map((group) => {
              const encounterWindow = formatEncounterWindow(group);
              const latestAssistBadge = getLatestAssistBadgeLabel(group);

              return (
                <article
                  key={group.id}
                  className={`session-activity-card ${group.tone}`}
                >
                  <div className="session-activity-card__top">
                    <div>
                      <span className="assist-card__eyebrow">
                        {group.clinicianId ?? "Clinician unavailable"} ·{" "}
                        {group.localSessionId}
                      </span>
                      <h4>
                        {group.exportSummary ??
                          "No reviewed export summary is available for this session yet."}
                      </h4>
                    </div>
                    <div className="session-activity-card__badges">
                      {group.exportStatus ? (
                        <span
                          className={`status-badge ${getExportTone(group.exportStatus)}`}
                        >
                          {formatStatusLabel(group.exportStatus)}
                        </span>
                      ) : null}
                      {latestAssistBadge ? (
                        <span
                          className={`status-badge ${
                            group.latestAssistStatus === "failed"
                              ? "attention"
                              : group.tone
                          }`}
                        >
                          {latestAssistBadge}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <section className="session-activity-section">
                    <div className="session-activity-section__header">
                      <span className="session-activity-section__label">
                        Session context
                      </span>
                    </div>
                    <div className="session-activity-card__meta">
                      {group.captureMode ? (
                        <span>{formatStatusLabel(group.captureMode)}</span>
                      ) : null}
                      {encounterWindow ? <span>{encounterWindow}</span> : null}
                      {group.destination ? <span>{group.destination}</span> : null}
                      {group.reviewedBy ? (
                        <span>Reviewed by {group.reviewedBy}</span>
                      ) : null}
                    </div>
                    {group.findings.length > 0 ? (
                      <div className="session-activity-card__findings">
                        {group.findings.slice(0, 3).map((item) => (
                          <span
                            key={item.findingId}
                            className="assist-chip"
                            title={item.summary}
                          >
                            {item.title}
                          </span>
                        ))}
                        {group.findings.length > 3 ? (
                          <span className="assist-chip">
                            +{group.findings.length - 3} more findings
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </section>

                  {group.latestAssistStatus ? (
                    <section className="session-activity-section">
                      <div className="session-activity-section__header">
                        <span className="session-activity-section__label">
                          LLM response
                        </span>
                        {group.latestAssistRecordedAt ? (
                          <time>{formatDateTime(group.latestAssistRecordedAt)}</time>
                        ) : null}
                      </div>
                      <p className="session-activity-card__copy">
                        {group.latestAssistRationale ??
                          "No assessment text was returned for this session."}
                      </p>
                      <div className="session-activity-card__meta">
                        {group.latestAssistDisposition ? (
                          <span>
                            {formatAssistDisposition(group.latestAssistDisposition)}
                          </span>
                        ) : null}
                        {group.latestAssistConfidence !== null ? (
                          <span>
                            {formatConfidence(group.latestAssistConfidence)}
                          </span>
                        ) : null}
                        {group.latestAssistLatencyMs !== null ? (
                          <span>{formatLatency(group.latestAssistLatencyMs)}</span>
                        ) : null}
                        {group.latestAssistProvider ? (
                          <span>{group.latestAssistProvider}</span>
                        ) : null}
                        {group.latestAssistModel ? (
                          <span>{group.latestAssistModel}</span>
                        ) : null}
                        {group.latestAssistPolicyMode ? (
                          <span>{group.latestAssistPolicyMode}</span>
                        ) : null}
                        {group.latestAssistReviewerAction ? (
                          <span>
                            Reviewer:{" "}
                            {formatReviewerAction(group.latestAssistReviewerAction)}
                          </span>
                        ) : null}
                        {group.latestAssistErrorCode ? (
                          <span>Error: {group.latestAssistErrorCode}</span>
                        ) : null}
                      </div>
                      {group.latestAssistLimitations.length > 0 ? (
                        <div className="assist-card__limitations">
                          {group.latestAssistLimitations.map((item) => (
                            <span key={item} className="assist-chip">
                              {item}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </section>
                  ) : null}

                  <section className="session-activity-section">
                    <div className="session-activity-section__header">
                      <span className="session-activity-section__label">
                        Timeline
                      </span>
                      <span className="view-status-copy">
                        {group.eventCount} events
                      </span>
                    </div>
                    {group.activity.length === 0 ? (
                      <p className="session-timeline__empty">
                        No assist or delivery events have been recorded for this
                        session yet.
                      </p>
                    ) : (
                      <div className="session-timeline">
                        {group.activity.map((item) => (
                          <div key={item.id} className="session-timeline__item">
                            <div className="session-timeline__top">
                              <div className="session-timeline__label">
                                <span className={`status-dot ${item.tone}`} />
                                <strong>{item.label}</strong>
                              </div>
                              <time>{formatDateTime(item.timestamp)}</time>
                            </div>
                            {item.detail ? <p>{item.detail}</p> : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
