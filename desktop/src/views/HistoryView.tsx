import React, { useEffect, useState } from "react";
import "./HistoryView.css";

interface SessionSummary {
  id: string;
  doctorId: string;
  startTime: string;
  endTime?: string;
  audioPath?: string;
  cloudAnalysisConsent: boolean;
  riskAssessment?: {
    overallRisk: "high" | "medium" | "low";
    overallScore: number;
  };
}

type HistoryFilter = "all" | "active" | "ready" | "attention";
type LoadState = "loading" | "ready" | "error";
type SessionTone = "active" | "ready" | "warning";

interface SessionState {
  label: string;
  tone: SessionTone;
  detail: string;
}

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const DAY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});

const FILTER_LABELS: Record<HistoryFilter, string> = {
  all: "All sessions",
  active: "Active",
  ready: "Ready for review",
  attention: "Needs follow-up",
};

function parseTimestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function formatDateTime(value: string): string {
  const timestamp = parseTimestamp(value);
  if (timestamp === null) {
    return "Time unavailable";
  }

  return DATE_TIME_FORMATTER.format(timestamp);
}

function formatDay(value: string): string {
  const timestamp = parseTimestamp(value);
  if (timestamp === null) {
    return "Unscheduled";
  }

  return DAY_FORMATTER.format(timestamp);
}

function formatDuration(startTime: string, endTime?: string): string {
  if (!endTime) {
    return "Live";
  }

  const start = parseTimestamp(startTime);
  const end = parseTimestamp(endTime);

  if (start === null || end === null || end <= start) {
    return "Unknown";
  }

  const totalMinutes = Math.round((end - start) / 60000);

  if (totalMinutes <= 0) {
    return "<1 min";
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${totalMinutes} min`;
  }

  if (minutes === 0) {
    return `${hours} hr`;
  }

  return `${hours} hr ${minutes} min`;
}

function getClinicianLabel(doctorId: string): string {
  const normalizedDoctorId = doctorId.trim();
  return normalizedDoctorId
    ? `Clinician ${normalizedDoctorId}`
    : "Unassigned clinician";
}

function getSessionState(session: SessionSummary): SessionState {
  if (!session.endTime) {
    return {
      label: "Recording now",
      tone: "active",
      detail:
        "Capture is still open. Finish the session to lock the timeline before transcript review.",
    };
  }

  if (!session.audioPath) {
    return {
      label: "Needs follow-up",
      tone: "warning",
      detail:
        "The session closed without a local audio file. Validate the capture before relying on it for review.",
    };
  }

  return {
    label: "Ready for review",
    tone: "ready",
    detail:
      "Audio and timing metadata are present, so transcript drill-down can attach here cleanly in the next review step.",
  };
}

function matchesFilter(session: SessionSummary, filter: HistoryFilter): boolean {
  const state = getSessionState(session);

  switch (filter) {
    case "active":
      return state.tone === "active";
    case "ready":
      return state.tone === "ready";
    case "attention":
      return state.tone === "warning";
    default:
      return true;
  }
}

function matchesSearch(session: SessionSummary, searchQuery: string): boolean {
  const trimmedQuery = searchQuery.trim().toLowerCase();

  if (!trimmedQuery) {
    return true;
  }

  return (
    session.doctorId.toLowerCase().includes(trimmedQuery) ||
    session.id.toLowerCase().includes(trimmedQuery)
  );
}

function countSessions(
  sessions: SessionSummary[],
  filter: HistoryFilter
): number {
  return sessions.reduce((count, session) => {
    return count + (matchesFilter(session, filter) ? 1 : 0);
  }, 0);
}

function getRiskBadgeTone(overallRisk: "high" | "medium" | "low"): string {
  return overallRisk;
}

export default function HistoryView() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedFilter, setSelectedFilter] = useState<HistoryFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function loadSessions(mode: "initial" | "refresh" = "initial") {
    if (!window.doctorAuditor) {
      setLoadState("error");
      setErrorMessage("Desktop session API unavailable.");
      return;
    }

    if (mode === "refresh") {
      setIsRefreshing(true);
    } else {
      setLoadState("loading");
    }

    setErrorMessage("");

    try {
      const data = await window.doctorAuditor.session.getAll();

      if (!Array.isArray(data)) {
        throw new Error("Session archive response was malformed.");
      }

      setSessions(data as SessionSummary[]);
      setLoadState("ready");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to load local sessions.";

      if (mode === "refresh" && sessions.length > 0) {
        setErrorMessage(message);
      } else {
        setLoadState("error");
        setErrorMessage(message);
      }
    } finally {
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    void loadSessions();
  }, []);

  const filteredSessions = sessions.filter((session) => {
    return (
      matchesFilter(session, selectedFilter) &&
      matchesSearch(session, searchQuery)
    );
  });

  const hasSessions = sessions.length > 0;
  const hasFiltersApplied =
    selectedFilter !== "all" || searchQuery.trim().length > 0;
  const summaryCards = [
    {
      label: "Total encounters",
      value: sessions.length,
      caption: "Archived locally on this device.",
    },
    {
      label: "Active now",
      value: countSessions(sessions, "active"),
      caption: "Sessions that are still recording.",
    },
    {
      label: "Ready for review",
      value: countSessions(sessions, "ready"),
      caption: "Closed captures with local audio.",
    },
    {
      label: "Needs follow-up",
      value: countSessions(sessions, "attention"),
      caption: "Sessions missing review prerequisites.",
    },
  ];

  return (
    <section className="history-shell">
      <header className="history-shell__header">
        <div>
          <p className="history-shell__eyebrow">Local encounter archive</p>
          <h2>Session history</h2>
          <p className="history-shell__intro">
            Review recent encounters on this device, confirm capture
            completeness, and see which sessions are ready for transcript review.
          </p>
        </div>
        <button
          type="button"
          className="history-shell__button history-shell__button--secondary"
          onClick={() => void loadSessions("refresh")}
          disabled={isRefreshing}
        >
          {isRefreshing ? "Refreshing..." : "Refresh list"}
        </button>
      </header>

      {loadState === "loading" && (
        <div className="history-shell__state" role="status" aria-live="polite">
          <p className="history-shell__state-label">Loading archive</p>
          <h3>Pulling local session history</h3>
          <p>
            Reading encounters from the local database so the review queue is
            ready.
          </p>
        </div>
      )}

      {loadState === "error" && (
        <div className="history-shell__state" role="alert">
          <p className="history-shell__state-label">Archive unavailable</p>
          <h3>Unable to load local sessions</h3>
          <p>{errorMessage}</p>
          <div className="history-shell__state-actions">
            <button
              type="button"
              className="history-shell__button"
              onClick={() => void loadSessions()}
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {loadState === "ready" && !hasSessions && (
        <div className="history-shell__state" role="status">
          <p className="history-shell__state-label">Archive empty</p>
          <h3>No local sessions yet</h3>
          <p>
            Recorded or imported encounters will appear here once they are saved
            on this device.
          </p>
          <div className="history-shell__state-actions">
            <button
              type="button"
              className="history-shell__button"
              onClick={() => void loadSessions("refresh")}
            >
              Refresh archive
            </button>
          </div>
        </div>
      )}

      {loadState === "ready" && hasSessions && (
        <>
          <section
            className="history-shell__summary"
            aria-label="Session archive summary"
          >
            {summaryCards.map((card) => (
              <article key={card.label} className="history-shell__summary-card">
                <p className="history-shell__summary-label">{card.label}</p>
                <p className="history-shell__summary-value">{card.value}</p>
                <p className="history-shell__summary-caption">{card.caption}</p>
              </article>
            ))}
          </section>

          <section className="history-shell__controls">
            <div className="history-shell__filters" aria-label="History filters">
              {(Object.keys(FILTER_LABELS) as HistoryFilter[]).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  className={`history-shell__filter ${
                    selectedFilter === filter ? "is-active" : ""
                  }`}
                  onClick={() => setSelectedFilter(filter)}
                  aria-pressed={selectedFilter === filter}
                >
                  <span>{FILTER_LABELS[filter]}</span>
                  <span className="history-shell__filter-count">
                    {countSessions(sessions, filter)}
                  </span>
                </button>
              ))}
            </div>

            <label className="history-shell__search">
              <span>Search sessions</span>
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search clinician or session ID"
              />
            </label>
          </section>

          {errorMessage && (
            <div className="history-shell__alert" role="status">
              Latest refresh failed: {errorMessage}
            </div>
          )}

          <div className="history-shell__results">
            <p className="history-shell__results-copy">
              {hasFiltersApplied
                ? `Showing ${filteredSessions.length} of ${sessions.length} sessions`
                : `Showing all ${sessions.length} local sessions`}
            </p>
          </div>

          {filteredSessions.length === 0 ? (
            <div className="history-shell__state" role="status">
              <p className="history-shell__state-label">No matches</p>
              <h3>No sessions match this view</h3>
              <p>
                Adjust the current filter or search query to bring encounters
                back into view.
              </p>
              <div className="history-shell__state-actions">
                <button
                  type="button"
                  className="history-shell__button"
                  onClick={() => {
                    setSelectedFilter("all");
                    setSearchQuery("");
                  }}
                >
                  Reset filters
                </button>
              </div>
            </div>
          ) : (
            <div className="history-shell__list">
              {filteredSessions.map((session) => {
                const sessionState = getSessionState(session);

                return (
                  <article key={session.id} className="history-shell__card">
                    <div className="history-shell__card-top">
                      <div>
                        <p className="history-shell__card-kicker">
                          {formatDay(session.startTime)}
                        </p>
                        <h3>{getClinicianLabel(session.doctorId)}</h3>
                        <p className="history-shell__card-subtitle">
                          Encounter {session.id.slice(0, 8).toUpperCase()} /
                          Started {formatDateTime(session.startTime)}
                        </p>
                      </div>
                      <span
                        className={`history-shell__state-pill history-shell__state-pill--${sessionState.tone}`}
                      >
                        {sessionState.label}
                      </span>
                    </div>

                    <div className="history-shell__metrics">
                      <div className="history-shell__metric">
                        <span>Started</span>
                        <strong>{formatDateTime(session.startTime)}</strong>
                      </div>
                      <div className="history-shell__metric">
                        <span>Duration</span>
                        <strong>
                          {formatDuration(session.startTime, session.endTime)}
                        </strong>
                      </div>
                      <div className="history-shell__metric">
                        <span>Audio</span>
                        <strong>
                          {session.audioPath ? "Stored locally" : "Unavailable"}
                        </strong>
                      </div>
                      <div className="history-shell__metric">
                        <span>Review mode</span>
                        <strong>
                          {session.cloudAnalysisConsent
                            ? "Cloud permitted"
                            : "Local only"}
                        </strong>
                      </div>
                    </div>

                    <div className="history-shell__badges">
                      <span
                        className={`history-shell__badge history-shell__badge--${
                          session.endTime ? "neutral" : "active"
                        }`}
                      >
                        {session.endTime ? "Completed" : "Recording live"}
                      </span>
                      <span
                        className={`history-shell__badge history-shell__badge--${
                          session.audioPath ? "ready" : "warning"
                        }`}
                      >
                        {session.audioPath ? "Local audio ready" : "Audio missing"}
                      </span>
                      <span className="history-shell__badge history-shell__badge--neutral">
                        {session.cloudAnalysisConsent
                          ? "Cloud review allowed"
                          : "Local-only review"}
                      </span>
                      <span
                        className={`history-shell__badge history-shell__badge--${
                          session.riskAssessment
                            ? getRiskBadgeTone(session.riskAssessment.overallRisk)
                            : "neutral"
                        }`}
                      >
                        {session.riskAssessment
                          ? `Latest signal ${session.riskAssessment.overallRisk}`
                          : "Analysis pending"}
                      </span>
                    </div>

                    <p className="history-shell__card-note">
                      {sessionState.detail}
                    </p>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
