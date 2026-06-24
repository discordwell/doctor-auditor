import type { TranscriptSegment } from "@doctor-auditor/shared/local-review";
import type { OpsEvent } from "@doctor-auditor/shared/cloud";
import { buildOpsEvent } from "./session-artifacts";
import type {
  DesktopSessionBundle,
  DesktopSessionSummary,
  UpdateModelAssistActionRequest,
  UpdateModelAssistActionResult,
} from "./review-models";

// Testable cores for the side-effect-heavy IPC handlers in main.ts. main.ts owns
// the Electron singletons and runs app.whenReady() at import time, so it cannot
// be imported by a test; keeping the branching logic here (with side effects
// injected) lets the recovery paths be exercised without Electron. See
// session-artifacts.ts for the same pattern applied to the export builders.

export interface StopRecordingResult {
  filePath: string;
  duration: number;
  session: DesktopSessionSummary | null;
}

export interface StopRecordingDeps {
  /** Stop the live recorder and resolve the captured audio file metadata. */
  stopRecording: () => Promise<{ filePath: string; duration: number }>;
  /** Persist the encounter end time + final audio path for the live session. */
  finalizeLiveCaptureSession: (
    sessionId: string,
    input: { endedAt: string; audioPath: string }
  ) => DesktopSessionSummary | null;
  /** Queue local transcription for the freshly captured audio. */
  queueTranscription: (
    sessionId: string,
    audioPath: string,
    source: TranscriptSegment["source"]
  ) => DesktopSessionSummary | null;
  emitSessionChanged: (summary: DesktopSessionSummary) => void;
  /** Fail the still-active live capture session (the recorder never stopped). */
  failActiveRecordingSession: (message: string) => void;
  /** Mark a stopped session's transcript failed so it stays recoverable. */
  markTranscriptFailure: (sessionId: string, error?: unknown) => void;
  /** Clear the module-level active-recording pointer in main.ts. */
  clearActiveRecording: () => void;
  now: () => string;
}

/**
 * Core of the `audio:stop-recording` IPC handler, with every side effect
 * injected so the two recovery branches are testable without Electron.
 *
 * The branch split is the point: once `stopRecording()` resolves the audio file
 * is already on disk, so a later failure in finalize/queue must NOT be handled
 * like a recorder failure. The previous inline version gated recovery on the
 * mutated module global `activeRecordingSessionId`, which is nulled the instant
 * the recorder stops — so a post-stop throw matched neither the original
 * `activeRecordingSessionId === sessionId` guard nor any other recovery, leaving
 * the session stuck (never marked failed, and unstoppable because the global was
 * already cleared). Tracking a local `recordingStopped` flag fixes that: a
 * post-stop failure marks the transcript failed so History shows a recoverable
 * session, while a recorder failure still fails the live capture session.
 */
export async function runStopRecording(
  sessionId: string,
  deps: StopRecordingDeps
): Promise<StopRecordingResult> {
  let recordingStopped = false;

  try {
    const stoppedRecording = await deps.stopRecording();
    recordingStopped = true;
    deps.clearActiveRecording();

    const finalizedSession = deps.finalizeLiveCaptureSession(sessionId, {
      endedAt: deps.now(),
      audioPath: stoppedRecording.filePath,
    });
    if (finalizedSession) {
      deps.emitSessionChanged(finalizedSession);
    }

    const queuedSummary = deps.queueTranscription(
      sessionId,
      stoppedRecording.filePath,
      "live_capture"
    );

    return {
      filePath: stoppedRecording.filePath,
      duration: stoppedRecording.duration,
      session: queuedSummary ?? finalizedSession,
    };
  } catch (error) {
    if (recordingStopped) {
      // Audio is already captured; finalize or transcription queueing failed.
      // Mark the transcript failed so the session is recoverable via manual
      // retry instead of being wedged mid-finalize.
      deps.markTranscriptFailure(sessionId, error);
    } else {
      // The recorder itself failed to stop; the live session never finalized.
      deps.failActiveRecordingSession(
        error instanceof Error
          ? error.message
          : "Recording could not be finalized."
      );
    }

    throw error;
  }
}

export interface UpdateModelAssistActionDeps {
  updateReviewerAction: (
    request: UpdateModelAssistActionRequest
  ) => DesktopSessionBundle | null;
  /** Best-effort ops sync; resolves to an error message or null on success. */
  postOpsEvent: (event: OpsEvent) => Promise<string | null>;
  getSessionSummary: (sessionId: string) => DesktopSessionSummary | null;
  emitSessionChanged: (summary: DesktopSessionSummary) => void;
}

/**
 * Core of the `session:update-model-assist-action` IPC handler.
 *
 * Two correctness fixes over the inline version:
 *  - Null-guard the persisted bundle *before* emitting the `assist_overridden`
 *    ops event. A null bundle means the session is gone and the update was a
 *    no-op, so posting the override event would record cloud telemetry for an
 *    override that never happened.
 *  - Thread the best-effort ops-sync error into the result (like the assist and
 *    export handlers) instead of dropping it, so the reviewer can be told the
 *    dismissal was saved locally even when cloud ops sync failed.
 */
export async function runUpdateModelAssistAction(
  request: UpdateModelAssistActionRequest,
  deps: UpdateModelAssistActionDeps
): Promise<UpdateModelAssistActionResult> {
  const bundle = deps.updateReviewerAction(request);
  if (!bundle) {
    throw new Error("The Remote assist record could not be updated.");
  }

  // A dismissal is the only action that emits an ops event, so there is at most
  // one best-effort sync to report (unlike the assist/export handlers, which
  // have several and accumulate them).
  let syncError: string | undefined;
  if (request.reviewerAction === "dismissed") {
    syncError =
      (await deps.postOpsEvent(
        buildOpsEvent({
          sessionId: request.sessionId,
          assistReceiptId: request.receiptId,
          type: "assist_overridden",
          reviewerAction: request.reviewerAction,
        })
      )) ?? undefined;
  }

  const sessionSummary = deps.getSessionSummary(request.sessionId);
  if (sessionSummary) {
    deps.emitSessionChanged(sessionSummary);
  }

  return {
    bundle,
    synced: !syncError,
    syncError,
  };
}
