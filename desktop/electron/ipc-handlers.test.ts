import { describe, expect, it, vi } from "vitest";
import type { ReviewSession } from "@doctor-auditor/shared/local-review";
import type {
  DesktopSessionBundle,
  DesktopSessionSummary,
} from "./review-models";
import {
  runStopRecording,
  runUpdateModelAssistAction,
  type StopRecordingDeps,
  type UpdateModelAssistActionDeps,
} from "./ipc-handlers";

const SESSION_ID = "session-001";
const NOW = "2026-03-15T10:30:00Z";

describe("runStopRecording", () => {
  it("finalizes, queues transcription, and reports the queued summary on success", async () => {
    const finalized = createSummary({ transcriptSegmentCount: 0 });
    const queued = createSummary({ transcriptSegmentCount: 3 });
    const deps = createStopDeps({
      finalizeLiveCaptureSession: vi.fn().mockReturnValue(finalized),
      queueTranscription: vi.fn().mockReturnValue(queued),
    });

    const result = await runStopRecording(SESSION_ID, deps);

    expect(result).toEqual({
      filePath: "/tmp/import/live.wav",
      duration: 42,
      session: queued,
    });
    expect(deps.clearActiveRecording).toHaveBeenCalledTimes(1);
    expect(deps.finalizeLiveCaptureSession).toHaveBeenCalledWith(SESSION_ID, {
      endedAt: NOW,
      audioPath: "/tmp/import/live.wav",
    });
    expect(deps.queueTranscription).toHaveBeenCalledWith(
      SESSION_ID,
      "/tmp/import/live.wav",
      "live_capture"
    );
    expect(deps.emitSessionChanged).toHaveBeenCalledWith(finalized);
    // Success must not trigger either recovery path.
    expect(deps.failActiveRecordingSession).not.toHaveBeenCalled();
    expect(deps.markTranscriptFailure).not.toHaveBeenCalled();
  });

  it("falls back to the finalized summary when queueing returns no summary", async () => {
    const finalized = createSummary({ transcriptSegmentCount: 0 });
    const deps = createStopDeps({
      finalizeLiveCaptureSession: vi.fn().mockReturnValue(finalized),
      queueTranscription: vi.fn().mockReturnValue(null),
    });

    const result = await runStopRecording(SESSION_ID, deps);

    expect(result.session).toBe(finalized);
  });

  it("fails the active recording session when the recorder itself fails to stop", async () => {
    const failure = new Error("recorder pipe closed");
    const deps = createStopDeps({
      stopRecording: vi.fn().mockRejectedValue(failure),
    });

    await expect(runStopRecording(SESSION_ID, deps)).rejects.toBe(failure);

    expect(deps.failActiveRecordingSession).toHaveBeenCalledWith(
      "recorder pipe closed"
    );
    // The recorder never stopped: don't clear the pointer or touch finalize.
    expect(deps.clearActiveRecording).not.toHaveBeenCalled();
    expect(deps.finalizeLiveCaptureSession).not.toHaveBeenCalled();
    expect(deps.markTranscriptFailure).not.toHaveBeenCalled();
  });

  it("uses a generic message when the recorder rejects with a non-Error", async () => {
    const deps = createStopDeps({
      stopRecording: vi.fn().mockRejectedValue("boom"),
    });

    await expect(runStopRecording(SESSION_ID, deps)).rejects.toBe("boom");
    expect(deps.failActiveRecordingSession).toHaveBeenCalledWith(
      "Recording could not be finalized."
    );
  });

  it("marks the transcript failed when finalize throws after the recorder stopped (regression)", async () => {
    // Regression for the dead recovery branch: once the recorder has stopped the
    // audio is on disk and the active-recording pointer is cleared, so the old
    // `activeRecordingSessionId === sessionId` guard could never fire. A
    // post-stop failure must mark the transcript failed, not silently wedge.
    const failure = new Error("disk full while finalizing");
    const deps = createStopDeps({
      finalizeLiveCaptureSession: vi.fn().mockImplementation(() => {
        throw failure;
      }),
    });

    await expect(runStopRecording(SESSION_ID, deps)).rejects.toBe(failure);

    expect(deps.clearActiveRecording).toHaveBeenCalledTimes(1);
    expect(deps.markTranscriptFailure).toHaveBeenCalledWith(SESSION_ID, failure);
    // It is no longer the active recording, so the live-capture failure path
    // (which clears audio) must stay untouched.
    expect(deps.failActiveRecordingSession).not.toHaveBeenCalled();
  });

  it("marks the transcript failed when transcription queueing throws after stop (regression)", async () => {
    const failure = new Error("review runtime unavailable");
    const deps = createStopDeps({
      queueTranscription: vi.fn().mockImplementation(() => {
        throw failure;
      }),
    });

    await expect(runStopRecording(SESSION_ID, deps)).rejects.toBe(failure);

    expect(deps.markTranscriptFailure).toHaveBeenCalledWith(SESSION_ID, failure);
    expect(deps.failActiveRecordingSession).not.toHaveBeenCalled();
  });
});

describe("runUpdateModelAssistAction", () => {
  it("posts an assist_overridden ops event and reports a clean sync when dismissed", async () => {
    const bundle = createBundle();
    const summary = createSummary();
    const deps = createUpdateDeps({
      updateReviewerAction: vi.fn().mockReturnValue(bundle),
      getSessionSummary: vi.fn().mockReturnValue(summary),
    });

    const result = await runUpdateModelAssistAction(
      {
        sessionId: SESSION_ID,
        receiptId: "assist-receipt-007",
        reviewerAction: "dismissed",
      },
      deps
    );

    expect(result).toEqual({ bundle, synced: true, syncError: undefined });
    expect(deps.postOpsEvent).toHaveBeenCalledTimes(1);
    expect(deps.postOpsEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "assist_overridden",
        localSessionId: SESSION_ID,
        assistReceiptId: "assist-receipt-007",
        reviewerAction: "dismissed",
        actorId: "desktop",
      })
    );
    expect(deps.emitSessionChanged).toHaveBeenCalledWith(summary);
  });

  it("does not emit an ops event for non-dismissal actions", async () => {
    const bundle = createBundle();
    const deps = createUpdateDeps({
      updateReviewerAction: vi.fn().mockReturnValue(bundle),
    });

    const result = await runUpdateModelAssistAction(
      {
        sessionId: SESSION_ID,
        receiptId: "assist-receipt-007",
        reviewerAction: "accepted",
      },
      deps
    );

    expect(deps.postOpsEvent).not.toHaveBeenCalled();
    expect(result).toEqual({ bundle, synced: true, syncError: undefined });
  });

  it("throws without posting an ops event when the session no longer exists (regression)", async () => {
    // Regression for the missing null-guard: a null bundle means the update was
    // a no-op, so the override ops event (and session-changed emit) must not
    // fire — otherwise the cloud records an override that never happened.
    const deps = createUpdateDeps({
      updateReviewerAction: vi.fn().mockReturnValue(null),
    });

    await expect(
      runUpdateModelAssistAction(
        {
          sessionId: SESSION_ID,
          receiptId: "assist-receipt-007",
          reviewerAction: "dismissed",
        },
        deps
      )
    ).rejects.toThrow("The Remote assist record could not be updated.");

    expect(deps.postOpsEvent).not.toHaveBeenCalled();
    expect(deps.emitSessionChanged).not.toHaveBeenCalled();
  });

  it("threads the best-effort ops sync error into the result instead of dropping it (regression)", async () => {
    const bundle = createBundle();
    const deps = createUpdateDeps({
      updateReviewerAction: vi.fn().mockReturnValue(bundle),
      postOpsEvent: vi.fn().mockResolvedValue("cloud ops endpoint unreachable"),
    });

    const result = await runUpdateModelAssistAction(
      {
        sessionId: SESSION_ID,
        receiptId: "assist-receipt-007",
        reviewerAction: "dismissed",
      },
      deps
    );

    expect(result.bundle).toBe(bundle);
    expect(result.synced).toBe(false);
    expect(result.syncError).toBe("cloud ops endpoint unreachable");
  });

  it("still returns the updated bundle when no session summary is available to emit", async () => {
    const bundle = createBundle();
    const deps = createUpdateDeps({
      updateReviewerAction: vi.fn().mockReturnValue(bundle),
      getSessionSummary: vi.fn().mockReturnValue(null),
    });

    const result = await runUpdateModelAssistAction(
      {
        sessionId: SESSION_ID,
        receiptId: "assist-receipt-007",
        reviewerAction: "accepted",
      },
      deps
    );

    expect(result.bundle).toBe(bundle);
    expect(deps.emitSessionChanged).not.toHaveBeenCalled();
  });
});

function createStopDeps(
  overrides: Partial<StopRecordingDeps> = {}
): StopRecordingDeps {
  return {
    stopRecording: vi
      .fn()
      .mockResolvedValue({ filePath: "/tmp/import/live.wav", duration: 42 }),
    finalizeLiveCaptureSession: vi.fn().mockReturnValue(createSummary()),
    queueTranscription: vi.fn().mockReturnValue(createSummary()),
    emitSessionChanged: vi.fn(),
    failActiveRecordingSession: vi.fn(),
    markTranscriptFailure: vi.fn(),
    clearActiveRecording: vi.fn(),
    now: () => NOW,
    ...overrides,
  };
}

function createUpdateDeps(
  overrides: Partial<UpdateModelAssistActionDeps> = {}
): UpdateModelAssistActionDeps {
  return {
    updateReviewerAction: vi.fn().mockReturnValue(createBundle()),
    postOpsEvent: vi.fn().mockResolvedValue(null),
    getSessionSummary: vi.fn().mockReturnValue(createSummary()),
    emitSessionChanged: vi.fn(),
    ...overrides,
  };
}

function createSession(): ReviewSession {
  return {
    id: SESSION_ID,
    clinicianId: "Dr. Test",
    encounterStartedAt: "2026-03-15T10:00:00Z",
    encounterEndedAt: "2026-03-15T10:15:00Z",
    captureMode: "live_capture",
    transcriptStatus: "in_progress",
    reviewStatus: "not_started",
    exportStatus: "not_requested",
    createdAt: "2026-03-15T10:00:00Z",
    updatedAt: "2026-03-15T10:30:00Z",
    consent: {
      recordedWithConsent: true,
      exportAllowed: true,
      remoteAssistAllowed: true,
      policyVersion: "policy-v1",
      capturedAt: "2026-03-15T10:00:00Z",
      capturedBy: "desktop",
    },
  };
}

function createSummary(
  overrides: Partial<DesktopSessionSummary> = {}
): DesktopSessionSummary {
  return {
    session: createSession(),
    transcriptSegmentCount: 0,
    ...overrides,
  };
}

function createBundle(
  overrides: Partial<DesktopSessionBundle> = {}
): DesktopSessionBundle {
  return {
    session: createSession(),
    transcriptSegments: [],
    findings: [],
    reviewDecisions: [],
    approvedExports: [],
    auditLogEntries: [],
    modelAssistReceipts: [],
    ...overrides,
  };
}
