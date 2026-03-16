import { describe, expect, it } from "vitest";
import type { ReviewSession } from "@doctor-auditor/shared/local-review";
import type { DesktopSessionSummary } from "./review-models";
import {
  canAutoRecoverTranscription,
  canManuallyRetryTranscription,
  isManagedSessionAudioPath,
} from "./transcription-recovery";

describe("transcription recovery", () => {
  const userDataPath = "/tmp/doctor-auditor";

  it("auto-recovers persisted app-managed sessions that never finished", () => {
    expect(
      canAutoRecoverTranscription(
        createSessionSummary({
          audioPath: "/tmp/doctor-auditor/sessions/session-001.wav",
          transcriptStatus: "in_progress",
        }),
        userDataPath
      )
    ).toBe(true);

    expect(
      canAutoRecoverTranscription(
        createSessionSummary({
          audioPath: "/tmp/doctor-auditor/imports/import-001.wav",
          transcriptStatus: "not_started",
        }),
        userDataPath
      )
    ).toBe(true);
  });

  it("skips sessions that are already complete or no longer recoverable", () => {
    expect(
      canAutoRecoverTranscription(
        createSessionSummary({
          audioPath: "/tmp/doctor-auditor/sessions/session-001.wav",
          transcriptStatus: "failed",
        }),
        userDataPath
      )
    ).toBe(false);

    expect(
      canAutoRecoverTranscription(
        createSessionSummary({
          audioPath: "/demo/mock-audio/awaiting-transcript.wav",
          transcriptStatus: "in_progress",
        }),
        userDataPath
      )
    ).toBe(false);

    expect(
      canAutoRecoverTranscription(
        createSessionSummary({
          audioPath: "/tmp/doctor-auditor/sessions/session-001.wav",
          transcriptSegmentCount: 1,
          transcriptStatus: "in_progress",
        }),
        userDataPath
      )
    ).toBe(false);

    expect(
      canAutoRecoverTranscription(
        createSessionSummary({
          audioPath: "/tmp/doctor-auditor/sessions/session-001.wav",
          encounterEndedAt: undefined,
          transcriptStatus: "in_progress",
        }),
        userDataPath
      )
    ).toBe(false);
  });

  it("only allows manual retries for failed sessions that still have audio", () => {
    expect(
      canManuallyRetryTranscription(
        createSessionSummary({
          audioPath: "/tmp/doctor-auditor/sessions/session-001.wav",
          transcriptStatus: "failed",
        })
      )
    ).toBe(true);

    expect(
      canManuallyRetryTranscription(
        createSessionSummary({
          audioPath: "/tmp/doctor-auditor/sessions/session-001.wav",
          transcriptStatus: "in_progress",
        })
      )
    ).toBe(false);

    expect(
      canManuallyRetryTranscription(
        createSessionSummary({
          audioPath: "/tmp/doctor-auditor/sessions/session-001.wav",
          transcriptStatus: "failed",
          transcriptSegmentCount: 1,
        })
      )
    ).toBe(false);
  });

  it("recognizes paths inside the managed app audio workspace", () => {
    expect(
      isManagedSessionAudioPath(
        "/tmp/doctor-auditor/imports/import-001.wav",
        userDataPath
      )
    ).toBe(true);
    expect(
      isManagedSessionAudioPath(
        "/tmp/doctor-auditor/sessions/session-001.wav",
        userDataPath
      )
    ).toBe(true);
    expect(
      isManagedSessionAudioPath("/tmp/external/session-001.wav", userDataPath)
    ).toBe(false);
  });
});

function createSessionSummary(
  overrides: Partial<ReviewSession> & {
    audioPath?: string;
    transcriptSegmentCount?: number;
  } = {}
): DesktopSessionSummary {
  const session: ReviewSession = {
    id: "session-001",
    clinicianId: "Dr. Jeng",
    encounterStartedAt: "2026-03-15T23:49:56.423Z",
    encounterEndedAt: "2026-03-15T23:50:09.407Z",
    captureMode: "live_capture",
    transcriptStatus: "not_started",
    reviewStatus: "not_started",
    exportStatus: "not_requested",
    createdAt: "2026-03-15T23:49:56.864Z",
    updatedAt: "2026-03-15T23:49:56.864Z",
    consent: {
      recordedWithConsent: true,
      exportAllowed: false,
      remoteAssistAllowed: true,
      policyVersion: "policy-v1",
      capturedAt: "2026-03-15T23:49:56.864Z",
      capturedBy: "desktop",
    },
    ...overrides,
  };

  return {
    session,
    audioPath: overrides.audioPath,
    transcriptSegmentCount: overrides.transcriptSegmentCount ?? 0,
  };
}
