import React, { useCallback, useEffect, useState } from "react";
import "./HistoryView.css";
import type { DesktopSessionSummary } from "../types/electron";
import {
  countSessions,
  FILTER_LABELS,
  formatDateTime,
  formatDay,
  formatDuration,
  getCaptureBadgeTone,
  getExportBadgeTone,
  getReviewBadgeTone,
  getSessionState,
  getTranscriptBadgeTone,
  matchesFilter,
  matchesSearch,
  type HistoryFilter,
} from "./historyModel";
import {
  canRetryTranscription,
  formatCaptureMode,
  formatClinicianLabel,
  formatExportStatus,
  formatReviewStatus,
  formatTranscriptStatus,
} from "./sessionSummaryModel";

type LoadState = "loading" | "ready" | "error";
type ArchiveActionTone = "success" | "warning";

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
  const [pendingRetrySessionId, setPendingRetrySessionId] = useState<
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

  const retryTranscription = useCallback(
    async (sessionSummary: DesktopSessionSummary) => {
      if (!window.doctorAuditor) {
        setArchiveActionMessage({
          tone: "warning",
          text: "Desktop session API unavailable.",
        });
        return;
      }

      if (!canRetryTranscription(sessionSummary)) {
        setArchiveActionMessage({
          tone: "warning",
          text: "Only failed sessions with saved local audio can be retried.",
        });
        return;
      }

      setArchiveActionMessage(null);
      setPendingRetrySessionId(sessionSummary.session.id);

      try {
        const nextSession = await window.doctorAuditor.session.retryTranscription(
          sessionSummary.session.id
        );

        if (nextSession) {
          setSessions((currentSessions) =>
            currentSessions.map((currentSession) =>
              currentSession.session.id === nextSession.session.id
                ? nextSession
                : currentSession
            )
          );
        }

        setArchiveActionMessage({
          tone: "success",
          text: `Transcript retry started for ${formatClinicianLabel(
            sessionSummary.session.clinicianId
          )}.`,
        });
      } catch (error) {
        setArchiveActionMessage({
          tone: "warning",
          text:
            error instanceof Error
              ? error.message
              : "Unable to retry the selected transcript.",
        });
      } finally {
        setPendingRetrySessionId((currentSessionId) =>
          currentSessionId === sessionSummary.session.id
            ? null
            : currentSessionId
        );
      }
    },
    []
  );

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
                const isRetrying = pendingRetrySessionId === session.id;
                const canRetry = canRetryTranscription(sessionSummary);

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
                        {canRetry ? (
                          <button
                            type="button"
                            className="history-shell__button"
                            onClick={() => void retryTranscription(sessionSummary)}
                            disabled={isDeleting || isRetrying}
                          >
                            {isRetrying ? "Retrying..." : "Retry transcript"}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="history-shell__button history-shell__button--secondary"
                          onClick={() => onOpenSession(session.id)}
                          disabled={isDeleting || isRetrying}
                        >
                          Open review
                        </button>
                        <button
                          type="button"
                          className="history-shell__button history-shell__button--danger"
                          onClick={() => void deleteSession(sessionSummary)}
                          disabled={isDeleting || isRetrying}
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
