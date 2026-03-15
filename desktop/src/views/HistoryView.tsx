import React, { useCallback, useEffect, useState } from "react";
import type { CaptureMode } from "@doctor-auditor/shared";
import type {
  ExportStatus,
  ReviewStatus,
  TranscriptStatus,
} from "@doctor-auditor/shared/local-review";
import "./HistoryView.css";
import type { DesktopSessionSummary } from "../types/electron";

type HistoryFilter = "all" | "review" | "transcript" | "attention";
type LoadState = "loading" | "ready" | "error";
type SessionTone = "active" | "ready" | "warning";
type BadgeTone = "active" | "ready" | "warning" | "neutral";
type ArchiveActionTone = "success" | "warning";

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
  review: "Review queue",
  transcript: "Transcript ready",
  attention: "Needs follow-up",
};

interface HistoryViewProps {
  onOpenSession: (sessionId: string) => void;
}

export default function HistoryView({ onOpenSession }: HistoryViewProps) {
  const [sessions, setSessions] = useState<DesktopSessionSummary[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [archiveActionMessage, setArchiveActionMessage] = useState<{
    tone: ArchiveActionTone;
    text: string;
  } | null>(null);
  const [selectedFilter, setSelectedFilter] = useState<HistoryFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<
    string | null
  >(null);

  const loadSessions = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
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
        setSessions(data);
        setLoadState("ready");
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unable to load local sessions.";

        setErrorMessage(message);
        setLoadState((currentState) =>
          mode === "refresh" && currentState === "ready" ? currentState : "error"
        );
      } finally {
        setIsRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (!window.doctorAuditor) {
      return undefined;
    }

    return window.doctorAuditor.session.onSessionChanged(() => {
      void loadSessions("refresh");
    });
  }, [loadSessions]);

  const deleteSession = useCallback(async (sessionSummary: DesktopSessionSummary) => {
    if (!window.doctorAuditor) {
      setArchiveActionMessage({
        tone: "warning",
        text: "Desktop session API unavailable.",
      });
      return;
    }

    const { session } = sessionSummary;
    const confirmation = window.confirm(
      [
        "Delete this local session?",
        "",
        `Clinician: ${formatClinicianLabel(session.clinicianId)}`,
        `Session: ${session.id}`,
        "",
        "This removes the local audio, transcript data, review findings, and export artifacts from this device.",
      ].join("\n")
    );

    if (!confirmation) {
      return;
    }

    setArchiveActionMessage(null);
    setPendingDeleteSessionId(session.id);

    try {
      await window.doctorAuditor.session.delete(session.id);
      setSessions((currentSessions) =>
        currentSessions.filter(
          (currentSession) => currentSession.session.id !== session.id
        )
      );
      setArchiveActionMessage({
        tone: "success",
        text: `Deleted local session ${session.id.slice(0, 8).toUpperCase()}.`,
      });
    } catch (error) {
      setArchiveActionMessage({
        tone: "warning",
        text:
          error instanceof Error
            ? error.message
            : "Unable to delete the selected local session.",
      });
    } finally {
      setPendingDeleteSessionId((currentSessionId) =>
        currentSessionId === session.id ? null : currentSessionId
      );
    }
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
      label: "Imported audio",
      value: sessions.filter(
        (session) => session.session.captureMode === "audio_import"
      ).length,
      caption: "Created through the intake import path.",
    },
    {
      label: "Transcript ready",
      value: sessions.filter(
        (session) => session.session.transcriptStatus === "completed"
      ).length,
      caption: "Prepared for reviewer attention.",
    },
    {
      label: "Review active",
      value: sessions.filter(
        (session) => session.session.reviewStatus === "in_review"
      ).length,
      caption: "Currently in the review queue.",
    },
  ];

  return (
    <section className="history-shell">
      <header className="history-shell__header">
        <div>
          <p className="history-shell__eyebrow">Local encounter archive</p>
          <h2>Session history</h2>
          <p className="history-shell__intro">
            Review local encounter shells, track transcript state, and see which
            sessions are ready to move into active review.
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
            Reading review sessions from the local database so the queue is ready.
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

          {(errorMessage || archiveActionMessage) && (
            <div
              className={`history-shell__alert ${
                archiveActionMessage?.tone === "success"
                  ? "history-shell__alert--success"
                  : "history-shell__alert--warning"
              }`}
              role="status"
            >
              {archiveActionMessage?.text ??
                `Latest refresh failed: ${errorMessage}`}
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
              {filteredSessions.map((sessionSummary) => {
                const sessionState = getSessionState(sessionSummary);
                const { session } = sessionSummary;
                const isDeleting = pendingDeleteSessionId === session.id;

                return (
                  <article key={session.id} className="history-shell__card">
                    <div className="history-shell__card-top">
                      <div>
                        <p className="history-shell__card-kicker">
                          {formatDay(session.encounterStartedAt)}
                        </p>
                        <h3>{formatClinicianLabel(session.clinicianId)}</h3>
                        <p className="history-shell__card-subtitle">
                          Encounter {session.id.slice(0, 8).toUpperCase()} /
                          Created {formatDateTime(session.createdAt)}
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
                        <strong>{formatDateTime(session.encounterStartedAt)}</strong>
                      </div>
                      <div className="history-shell__metric">
                        <span>Duration</span>
                        <strong>
                          {formatDuration(
                            session.encounterStartedAt,
                            session.encounterEndedAt
                          )}
                        </strong>
                      </div>
                      <div className="history-shell__metric">
                        <span>Transcript</span>
                        <strong>
                          {formatTranscriptStatus(session.transcriptStatus)}
                          {sessionSummary.transcriptSegmentCount > 0
                            ? ` (${sessionSummary.transcriptSegmentCount})`
                            : ""}
                        </strong>
                      </div>
                      <div className="history-shell__metric">
                        <span>Review</span>
                        <strong>{formatReviewStatus(session.reviewStatus)}</strong>
                      </div>
                    </div>

                    <div className="history-shell__badges">
                      <span
                        className={`history-shell__badge history-shell__badge--${getCaptureBadgeTone(
                          session.captureMode
                        )}`}
                      >
                        {formatCaptureMode(session.captureMode)}
                      </span>
                      <span
                        className={`history-shell__badge history-shell__badge--${
                          sessionSummary.audioPath ? "ready" : "warning"
                        }`}
                      >
                        {sessionSummary.audioPath
                          ? "Local audio stored"
                          : "Audio missing"}
                      </span>
                      <span
                        className={`history-shell__badge history-shell__badge--${getTranscriptBadgeTone(
                          session.transcriptStatus
                        )}`}
                      >
                        {formatTranscriptStatus(session.transcriptStatus)}
                      </span>
                      <span
                        className={`history-shell__badge history-shell__badge--${getReviewBadgeTone(
                          session.reviewStatus
                        )}`}
                      >
                        {formatReviewStatus(session.reviewStatus)}
                      </span>
                      <span
                        className={`history-shell__badge history-shell__badge--${getExportBadgeTone(
                          session.exportStatus
                        )}`}
                      >
                        {formatExportStatus(session.exportStatus)}
                      </span>
                      <span
                        className={`history-shell__badge history-shell__badge--${
                          session.consent.exportAllowed ? "neutral" : "warning"
                        }`}
                      >
                        {session.consent.exportAllowed
                          ? "Export allowed"
                          : "Local review only"}
                      </span>
                    </div>

                    <p className="history-shell__card-note">
                      {sessionState.detail}
                    </p>

                    <div className="history-shell__card-actions">
                      <div className="history-shell__card-action-copy">
                        <strong>
                          {sessionSummary.transcriptSegmentCount > 0
                            ? `${sessionSummary.transcriptSegmentCount} transcript segment${
                                sessionSummary.transcriptSegmentCount === 1 ? "" : "s"
                              } available`
                            : "Transcript not attached yet"}
                        </strong>
                        <span>
                          {sessionSummary.transcriptSegmentCount > 0
                            ? "Open the drill-down to inspect linked evidence and review findings."
                            : "Open the session to inspect current status and any persisted review data."}
                        </span>
                      </div>
                      <div className="history-shell__card-action-buttons">
                        <button
                          type="button"
                          className="history-shell__button history-shell__button--secondary"
                          onClick={() => onOpenSession(session.id)}
                          disabled={isDeleting}
                        >
                          Open review
                        </button>
                        <button
                          type="button"
                          className="history-shell__button history-shell__button--danger"
                          onClick={() => void deleteSession(sessionSummary)}
                          disabled={isDeleting}
                        >
                          {isDeleting ? "Deleting..." : "Delete session"}
                        </button>
                      </div>
                    </div>
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
    return "Open";
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

function formatClinicianLabel(clinicianId: string): string {
  const trimmedValue = clinicianId.trim();
  return trimmedValue || "Unassigned clinician";
}

function formatCaptureMode(value: CaptureMode): string {
  switch (value) {
    case "audio_import":
      return "Loaded audio";
    case "live_capture":
      return "Live recording";
    case "manual_entry":
      return "Manual entry";
  }

  return "Unknown";
}

function formatTranscriptStatus(value: TranscriptStatus): string {
  switch (value) {
    case "not_started":
      return "Transcript pending";
    case "in_progress":
      return "Transcript running";
    case "completed":
      return "Transcript ready";
    case "failed":
      return "Transcript failed";
  }
}

function formatReviewStatus(value: ReviewStatus): string {
  switch (value) {
    case "not_started":
      return "Review not started";
    case "ready":
      return "Ready for review";
    case "in_review":
      return "Review in progress";
    case "completed":
      return "Review complete";
  }
}

function formatExportStatus(value: ExportStatus): string {
  switch (value) {
    case "not_requested":
      return "Export not requested";
    case "draft":
      return "Export draft";
    case "approved":
      return "Export approved";
    case "sent":
      return "Export sent";
  }
}

function getSessionState(sessionSummary: DesktopSessionSummary): SessionState {
  const { session, audioPath } = sessionSummary;

  if (session.reviewStatus === "completed") {
    return {
      label: "Review complete",
      tone: "ready",
      detail:
        "Local review is complete for this encounter, so it is ready for final archive or export handling.",
    };
  }

  if (session.reviewStatus === "in_review") {
    return {
      label: "In review",
      tone: "active",
      detail:
        "This encounter is actively being reviewed. Transcript and findings should stay attached to the current bundle.",
    };
  }

  if (session.transcriptStatus === "failed") {
    return {
      label: "Needs follow-up",
      tone: "warning",
      detail:
        "Recording or transcription failed for this encounter. Check the local audio file before continuing review.",
    };
  }

  if (session.transcriptStatus === "completed") {
    return {
      label: "Ready for review",
      tone: "ready",
      detail:
        "Transcript work is complete and the session can move into reviewer attention without more intake work.",
    };
  }

  if (!audioPath) {
    return {
      label: "Needs follow-up",
      tone: "warning",
      detail:
        "The session shell exists, but the local audio asset is missing. Validate the import before relying on it downstream.",
    };
  }

  return {
    label: "Transcript pending",
    tone: "warning",
    detail:
      "Audio is stored locally and the review session is created, but transcript processing has not started yet.",
  };
}

function matchesFilter(
  sessionSummary: DesktopSessionSummary,
  filter: HistoryFilter
): boolean {
  const { session } = sessionSummary;

  switch (filter) {
    case "review":
      return session.reviewStatus === "ready" || session.reviewStatus === "in_review";
    case "transcript":
      return session.transcriptStatus === "completed";
    case "attention":
      return getSessionState(sessionSummary).tone === "warning";
    default:
      return true;
  }
}

function matchesSearch(
  sessionSummary: DesktopSessionSummary,
  searchQuery: string
): boolean {
  const trimmedQuery = searchQuery.trim().toLowerCase();
  if (!trimmedQuery) {
    return true;
  }

  return (
    sessionSummary.session.clinicianId.toLowerCase().includes(trimmedQuery) ||
    sessionSummary.session.id.toLowerCase().includes(trimmedQuery)
  );
}

function countSessions(
  sessions: DesktopSessionSummary[],
  filter: HistoryFilter
): number {
  return sessions.reduce((count, session) => {
    return count + (matchesFilter(session, filter) ? 1 : 0);
  }, 0);
}

function getCaptureBadgeTone(value: CaptureMode): BadgeTone {
  return value === "audio_import" ? "ready" : "active";
}

function getTranscriptBadgeTone(value: TranscriptStatus): BadgeTone {
  switch (value) {
    case "completed":
      return "ready";
    case "in_progress":
      return "active";
    case "failed":
      return "warning";
    case "not_started":
      return "neutral";
  }
}

function getReviewBadgeTone(value: ReviewStatus): BadgeTone {
  switch (value) {
    case "completed":
      return "ready";
    case "in_review":
      return "active";
    case "ready":
      return "ready";
    case "not_started":
      return "neutral";
  }
}

function getExportBadgeTone(value: ExportStatus): BadgeTone {
  switch (value) {
    case "sent":
      return "ready";
    case "approved":
      return "ready";
    case "draft":
      return "active";
    case "not_requested":
      return "neutral";
  }
}
