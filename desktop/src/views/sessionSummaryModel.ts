import type { CaptureMode } from "@doctor-auditor/shared";
import type {
  ExportStatus,
  ReviewStatus,
  TranscriptStatus,
} from "@doctor-auditor/shared/local-review";

import type { DesktopSessionSummary } from "../types/electron";

/**
 * Pure presentation/logic helpers for a review session that are shared by more
 * than one desktop view (HistoryView, RecordingView, SessionReviewView). Keeping
 * one copy here means the retry affordance and the retry guard — and the
 * clinician/capture/status labels — can never drift apart between the views.
 *
 * Note: these are the full "title-case" status labels used by HistoryView and
 * SessionReviewView. RecordingView deliberately renders its own terser variants
 * (e.g. "in progress" rather than "Review in progress") and keeps them local.
 */

/**
 * A transcript may be retried only when local audio is still on disk, no
 * transcript segments were ever produced, and the last attempt failed. All three
 * conditions must hold: a completed/in-progress transcript, a session with saved
 * segments, or one whose audio was discarded is not a retry candidate.
 */
export function canRetryTranscription(
  sessionSummary: DesktopSessionSummary
): boolean {
  return (
    Boolean(sessionSummary.audioPath) &&
    sessionSummary.transcriptSegmentCount === 0 &&
    sessionSummary.session.transcriptStatus === "failed"
  );
}

export function formatClinicianLabel(value: string): string {
  const trimmedValue = value.trim();
  return trimmedValue || "Unassigned clinician";
}

export function formatCaptureMode(value: CaptureMode): string {
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

export function formatTranscriptStatus(value: TranscriptStatus): string {
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

export function formatReviewStatus(value: ReviewStatus): string {
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

export function formatExportStatus(value: ExportStatus): string {
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
