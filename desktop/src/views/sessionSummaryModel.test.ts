import type { CaptureMode } from "@doctor-auditor/shared";
import type {
  ExportStatus,
  ReviewStatus,
  TranscriptStatus,
} from "@doctor-auditor/shared/local-review";
import { describe, expect, it } from "vitest";

import type { DesktopSessionSummary } from "../types/electron";
import {
  canRetryTranscription,
  formatCaptureMode,
  formatClinicianLabel,
  formatExportStatus,
  formatReviewStatus,
  formatTranscriptStatus,
} from "./sessionSummaryModel";

function makeSessionSummary(
  overrides: {
    audioPath?: string;
    transcriptSegmentCount?: number;
    transcriptStatus?: TranscriptStatus;
    captureMode?: CaptureMode;
    clinicianId?: string;
  } = {}
): DesktopSessionSummary {
  return {
    session: {
      id: "session-1",
      clinicianId: overrides.clinicianId ?? "Dr. Rivera",
      encounterStartedAt: "2026-03-15T10:00:00Z",
      encounterEndedAt: "2026-03-15T10:18:00Z",
      captureMode: overrides.captureMode ?? "audio_import",
      transcriptStatus: overrides.transcriptStatus ?? "failed",
      reviewStatus: "not_started",
      exportStatus: "not_requested",
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

describe("canRetryTranscription", () => {
  it("allows retry only when audio is present, no segments exist, and it failed", () => {
    expect(
      canRetryTranscription(
        makeSessionSummary({
          audioPath: "/local/audio.wav",
          transcriptSegmentCount: 0,
          transcriptStatus: "failed",
        })
      )
    ).toBe(true);
  });

  it("blocks retry when the local audio is gone", () => {
    expect(
      canRetryTranscription(
        makeSessionSummary({
          audioPath: undefined,
          transcriptSegmentCount: 0,
          transcriptStatus: "failed",
        })
      )
    ).toBe(false);
  });

  it("blocks retry once transcript segments have been produced", () => {
    expect(
      canRetryTranscription(
        makeSessionSummary({
          audioPath: "/local/audio.wav",
          transcriptSegmentCount: 3,
          transcriptStatus: "failed",
        })
      )
    ).toBe(false);
  });

  it("blocks retry for any status other than failed", () => {
    for (const status of [
      "not_started",
      "in_progress",
      "completed",
    ] as TranscriptStatus[]) {
      expect(
        canRetryTranscription(
          makeSessionSummary({
            audioPath: "/local/audio.wav",
            transcriptSegmentCount: 0,
            transcriptStatus: status,
          })
        )
      ).toBe(false);
    }
  });
});

describe("formatClinicianLabel", () => {
  it("keeps a real clinician label, trimming surrounding whitespace", () => {
    expect(formatClinicianLabel("Dr. Rivera")).toBe("Dr. Rivera");
    expect(formatClinicianLabel("  Dr. Rivera  ")).toBe("Dr. Rivera");
  });

  it("falls back for empty and whitespace-only labels", () => {
    expect(formatClinicianLabel("")).toBe("Unassigned clinician");
    expect(formatClinicianLabel("   ")).toBe("Unassigned clinician");
  });
});

describe("formatCaptureMode", () => {
  it("labels each known capture mode", () => {
    expect(formatCaptureMode("audio_import")).toBe("Loaded audio");
    expect(formatCaptureMode("live_capture")).toBe("Live recording");
    expect(formatCaptureMode("manual_entry")).toBe("Manual entry");
  });

  it("degrades to Unknown for an unrecognized runtime value", () => {
    expect(formatCaptureMode("legacy_mode" as CaptureMode)).toBe("Unknown");
  });
});

describe("status labels", () => {
  it("labels every transcript status", () => {
    const cases: Record<TranscriptStatus, string> = {
      not_started: "Transcript pending",
      in_progress: "Transcript running",
      completed: "Transcript ready",
      failed: "Transcript failed",
    };
    for (const [status, label] of Object.entries(cases)) {
      expect(formatTranscriptStatus(status as TranscriptStatus)).toBe(label);
    }
  });

  it("labels every review status", () => {
    const cases: Record<ReviewStatus, string> = {
      not_started: "Review not started",
      ready: "Ready for review",
      in_review: "Review in progress",
      completed: "Review complete",
    };
    for (const [status, label] of Object.entries(cases)) {
      expect(formatReviewStatus(status as ReviewStatus)).toBe(label);
    }
  });

  it("labels every export status", () => {
    const cases: Record<ExportStatus, string> = {
      not_requested: "Export not requested",
      draft: "Export draft",
      approved: "Export approved",
      sent: "Export sent",
    };
    for (const [status, label] of Object.entries(cases)) {
      expect(formatExportStatus(status as ExportStatus)).toBe(label);
    }
  });
});
