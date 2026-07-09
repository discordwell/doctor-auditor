import type { CaptureMode } from "@doctor-auditor/shared";
import type {
  ExportStatus,
  ReviewStatus,
  TranscriptStatus,
} from "@doctor-auditor/shared/local-review";
import { describe, expect, it } from "vitest";

import type { DesktopSessionSummary } from "../types/electron";
import {
  countSessions,
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
  parseTimestamp,
} from "./historyModel";

function makeSessionSummary(
  overrides: {
    id?: string;
    clinicianId?: string;
    captureMode?: CaptureMode;
    transcriptStatus?: TranscriptStatus;
    reviewStatus?: ReviewStatus;
    exportStatus?: ExportStatus;
    audioPath?: string;
    transcriptSegmentCount?: number;
  } = {}
): DesktopSessionSummary {
  return {
    session: {
      id: overrides.id ?? "session-1",
      clinicianId: overrides.clinicianId ?? "Dr. Rivera",
      encounterStartedAt: "2026-03-15T10:00:00Z",
      encounterEndedAt: "2026-03-15T10:18:00Z",
      captureMode: overrides.captureMode ?? "audio_import",
      transcriptStatus: overrides.transcriptStatus ?? "completed",
      reviewStatus: overrides.reviewStatus ?? "ready",
      exportStatus: overrides.exportStatus ?? "not_requested",
      createdAt: "2026-03-15T10:00:00Z",
      updatedAt: "2026-03-15T10:00:00Z",
      consent: {
        recordedWithConsent: true,
        exportAllowed: true,
        remoteAssistAllowed: false,
        policyVersion: "local-only-v1",
      },
    },
    audioPath: overrides.audioPath,
    transcriptSegmentCount: overrides.transcriptSegmentCount ?? 0,
  };
}

describe("parseTimestamp", () => {
  it("returns epoch milliseconds for a valid ISO string", () => {
    expect(parseTimestamp("2026-03-15T10:00:00Z")).toBe(
      Date.parse("2026-03-15T10:00:00Z")
    );
  });

  it("returns null for an unparseable value", () => {
    expect(parseTimestamp("not-a-date")).toBeNull();
    expect(parseTimestamp("")).toBeNull();
  });
});

describe("formatDateTime", () => {
  it("reports missing data for an unparseable timestamp", () => {
    expect(formatDateTime("not-a-date")).toBe("Time unavailable");
  });

  it("renders a real timestamp without the fallback string", () => {
    const formatted = formatDateTime("2026-03-15T10:00:00Z");
    expect(formatted).not.toBe("Time unavailable");
    // Midday UTC stays within 2026 in every locale offset, so the year is stable.
    expect(formatted).toContain("2026");
  });
});

describe("formatDay", () => {
  it("reports unscheduled for an unparseable timestamp", () => {
    expect(formatDay("not-a-date")).toBe("Unscheduled");
  });

  it("renders a real day without the fallback string", () => {
    const formatted = formatDay("2026-03-15T10:00:00Z");
    expect(formatted).not.toBe("Unscheduled");
    expect(formatted.length).toBeGreaterThan(0);
  });
});

describe("formatDuration", () => {
  it("reports an open encounter when there is no end time", () => {
    expect(formatDuration("2026-03-15T10:00:00Z")).toBe("Open");
  });

  it("reports unknown for unparseable or inverted ranges", () => {
    expect(formatDuration("bad", "2026-03-15T10:10:00Z")).toBe("Unknown");
    expect(formatDuration("2026-03-15T10:00:00Z", "bad")).toBe("Unknown");
    expect(
      formatDuration("2026-03-15T10:10:00Z", "2026-03-15T10:00:00Z")
    ).toBe("Unknown");
    expect(
      formatDuration("2026-03-15T10:00:00Z", "2026-03-15T10:00:00Z")
    ).toBe("Unknown");
  });

  it("reports sub-minute encounters as <1 min", () => {
    expect(
      formatDuration("2026-03-15T10:00:00Z", "2026-03-15T10:00:20Z")
    ).toBe("<1 min");
  });

  it("formats whole minutes, whole hours, and mixed hours+minutes", () => {
    expect(
      formatDuration("2026-03-15T10:00:00Z", "2026-03-15T10:45:00Z")
    ).toBe("45 min");
    expect(
      formatDuration("2026-03-15T10:00:00Z", "2026-03-15T12:00:00Z")
    ).toBe("2 hr");
    expect(
      formatDuration("2026-03-15T10:00:00Z", "2026-03-15T11:30:00Z")
    ).toBe("1 hr 30 min");
  });

  it("rounds to the nearest minute", () => {
    // 45 seconds rounds up to a reported minute.
    expect(
      formatDuration("2026-03-15T10:00:00Z", "2026-03-15T10:00:45Z")
    ).toBe("1 min");
  });
});

describe("getSessionState", () => {
  it("treats a completed review as done, even when the transcript failed", () => {
    const state = getSessionState(
      makeSessionSummary({
        reviewStatus: "completed",
        transcriptStatus: "failed",
      })
    );
    expect(state).toMatchObject({ label: "Review complete", tone: "ready" });
  });

  it("treats an in-progress review as active", () => {
    const state = getSessionState(
      makeSessionSummary({ reviewStatus: "in_review" })
    );
    expect(state).toMatchObject({ label: "In review", tone: "active" });
  });

  it("flags a failed transcript for follow-up and tailors the detail to audio presence", () => {
    const withAudio = getSessionState(
      makeSessionSummary({
        reviewStatus: "not_started",
        transcriptStatus: "failed",
        audioPath: "/local/audio.wav",
      })
    );
    expect(withAudio).toMatchObject({
      label: "Needs follow-up",
      tone: "warning",
    });
    expect(withAudio.detail).toContain("Retry transcript processing");

    const withoutAudio = getSessionState(
      makeSessionSummary({
        reviewStatus: "not_started",
        transcriptStatus: "failed",
        audioPath: undefined,
      })
    );
    expect(withoutAudio.detail).toContain("Check the local audio file");
  });

  it("marks a completed transcript as ready for review", () => {
    const state = getSessionState(
      makeSessionSummary({
        reviewStatus: "not_started",
        transcriptStatus: "completed",
      })
    );
    expect(state).toMatchObject({ label: "Ready for review", tone: "ready" });
  });

  it("warns when the local audio asset is missing before transcription", () => {
    const state = getSessionState(
      makeSessionSummary({
        reviewStatus: "not_started",
        transcriptStatus: "not_started",
        audioPath: undefined,
      })
    );
    expect(state).toMatchObject({ label: "Needs follow-up", tone: "warning" });
    expect(state.detail).toContain("local audio asset is missing");
  });

  it("defaults to transcript-pending when audio is stored but processing has not run", () => {
    const state = getSessionState(
      makeSessionSummary({
        reviewStatus: "not_started",
        transcriptStatus: "not_started",
        audioPath: "/local/audio.wav",
      })
    );
    expect(state).toMatchObject({
      label: "Transcript pending",
      tone: "warning",
    });
  });
});

describe("matchesFilter", () => {
  it("matches everything for the all filter", () => {
    expect(matchesFilter(makeSessionSummary(), "all")).toBe(true);
  });

  it("matches ready and in-review sessions for the review filter", () => {
    expect(
      matchesFilter(makeSessionSummary({ reviewStatus: "ready" }), "review")
    ).toBe(true);
    expect(
      matchesFilter(makeSessionSummary({ reviewStatus: "in_review" }), "review")
    ).toBe(true);
    expect(
      matchesFilter(makeSessionSummary({ reviewStatus: "completed" }), "review")
    ).toBe(false);
  });

  it("matches completed transcripts for the transcript filter", () => {
    expect(
      matchesFilter(
        makeSessionSummary({ transcriptStatus: "completed" }),
        "transcript"
      )
    ).toBe(true);
    expect(
      matchesFilter(
        makeSessionSummary({ transcriptStatus: "in_progress" }),
        "transcript"
      )
    ).toBe(false);
  });

  it("matches warning-tone sessions for the attention filter", () => {
    expect(
      matchesFilter(
        makeSessionSummary({
          reviewStatus: "not_started",
          transcriptStatus: "failed",
        }),
        "attention"
      )
    ).toBe(true);
    expect(
      matchesFilter(
        makeSessionSummary({
          reviewStatus: "not_started",
          transcriptStatus: "completed",
        }),
        "attention"
      )
    ).toBe(false);
  });
});

describe("matchesSearch", () => {
  const session = makeSessionSummary({
    id: "SESSION-ABC123",
    clinicianId: "Dr. Rivera",
  });

  it("matches everything for an empty query", () => {
    expect(matchesSearch(session, "")).toBe(true);
    expect(matchesSearch(session, "   ")).toBe(true);
  });

  it("matches the clinician label case-insensitively", () => {
    expect(matchesSearch(session, "rivera")).toBe(true);
    expect(matchesSearch(session, "RIVERA")).toBe(true);
  });

  it("matches the session id case-insensitively", () => {
    expect(matchesSearch(session, "abc123")).toBe(true);
  });

  it("returns false when neither field matches", () => {
    expect(matchesSearch(session, "unrelated")).toBe(false);
  });
});

describe("countSessions", () => {
  it("counts sessions that satisfy the filter", () => {
    const sessions = [
      makeSessionSummary({ id: "a", reviewStatus: "ready" }),
      makeSessionSummary({ id: "b", reviewStatus: "in_review" }),
      makeSessionSummary({ id: "c", reviewStatus: "completed" }),
    ];

    expect(countSessions(sessions, "all")).toBe(3);
    expect(countSessions(sessions, "review")).toBe(2);
    expect(countSessions([], "all")).toBe(0);
  });
});

describe("badge tones", () => {
  it("maps capture modes", () => {
    expect(getCaptureBadgeTone("audio_import")).toBe("ready");
    expect(getCaptureBadgeTone("live_capture")).toBe("active");
    expect(getCaptureBadgeTone("manual_entry")).toBe("active");
  });

  it("maps transcript statuses", () => {
    expect(getTranscriptBadgeTone("completed")).toBe("ready");
    expect(getTranscriptBadgeTone("in_progress")).toBe("active");
    expect(getTranscriptBadgeTone("failed")).toBe("warning");
    expect(getTranscriptBadgeTone("not_started")).toBe("neutral");
  });

  it("maps review statuses", () => {
    expect(getReviewBadgeTone("completed")).toBe("ready");
    expect(getReviewBadgeTone("in_review")).toBe("active");
    expect(getReviewBadgeTone("ready")).toBe("ready");
    expect(getReviewBadgeTone("not_started")).toBe("neutral");
  });

  it("maps export statuses", () => {
    expect(getExportBadgeTone("sent")).toBe("ready");
    expect(getExportBadgeTone("approved")).toBe("ready");
    expect(getExportBadgeTone("draft")).toBe("active");
    expect(getExportBadgeTone("not_requested")).toBe("neutral");
  });
});
