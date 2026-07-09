import type { CaptureMode } from "@doctor-auditor/shared";
import type {
  ExportStatus,
  ReviewStatus,
  TranscriptStatus,
} from "@doctor-auditor/shared/local-review";

import type { DesktopSessionSummary } from "../types/electron";

/**
 * Pure view-model helpers for HistoryView: timestamp/duration formatting, the
 * derived per-session state, and the filter/search/count predicates. Extracted
 * out of the component so the branchy logic can be unit-tested without an
 * Electron/React harness (same pattern as sessionReviewModel.ts).
 */

export type HistoryFilter = "all" | "review" | "transcript" | "attention";
export type SessionTone = "active" | "ready" | "warning";
export type BadgeTone = "active" | "ready" | "warning" | "neutral";

export interface SessionState {
  label: string;
  tone: SessionTone;
  detail: string;
}

export const FILTER_LABELS: Record<HistoryFilter, string> = {
  all: "All sessions",
  review: "Review queue",
  transcript: "Transcript ready",
  attention: "Needs follow-up",
};

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

export function parseTimestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function formatDateTime(value: string): string {
  const timestamp = parseTimestamp(value);
  if (timestamp === null) {
    return "Time unavailable";
  }

  return DATE_TIME_FORMATTER.format(timestamp);
}

export function formatDay(value: string): string {
  const timestamp = parseTimestamp(value);
  if (timestamp === null) {
    return "Unscheduled";
  }

  return DAY_FORMATTER.format(timestamp);
}

export function formatDuration(startTime: string, endTime?: string): string {
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

export function getSessionState(
  sessionSummary: DesktopSessionSummary
): SessionState {
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
      detail: audioPath
        ? "Recording or transcription failed for this encounter. Retry transcript processing after confirming the saved local audio is intact."
        : "Recording or transcription failed for this encounter. Check the local audio file before continuing review.",
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

export function matchesFilter(
  sessionSummary: DesktopSessionSummary,
  filter: HistoryFilter
): boolean {
  const { session } = sessionSummary;

  switch (filter) {
    case "review":
      return (
        session.reviewStatus === "ready" ||
        session.reviewStatus === "in_review"
      );
    case "transcript":
      return session.transcriptStatus === "completed";
    case "attention":
      return getSessionState(sessionSummary).tone === "warning";
    default:
      return true;
  }
}

export function matchesSearch(
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

export function countSessions(
  sessions: DesktopSessionSummary[],
  filter: HistoryFilter
): number {
  return sessions.reduce((count, session) => {
    return count + (matchesFilter(session, filter) ? 1 : 0);
  }, 0);
}

export function getCaptureBadgeTone(value: CaptureMode): BadgeTone {
  return value === "audio_import" ? "ready" : "active";
}

export function getTranscriptBadgeTone(value: TranscriptStatus): BadgeTone {
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

export function getReviewBadgeTone(value: ReviewStatus): BadgeTone {
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

export function getExportBadgeTone(value: ExportStatus): BadgeTone {
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
