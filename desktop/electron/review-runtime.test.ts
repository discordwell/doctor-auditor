import { afterEach, describe, expect, it, vi } from "vitest";
import type { TranscriptSegment } from "@doctor-auditor/shared";
import {
  ReviewRuntimeService,
  type ReviewRuntimeTranscriptionAdapter,
  type ReviewRuntimeTranscriptionCompleted,
  type ReviewRuntimeTranscriptionFailed,
} from "./review-runtime";

describe("ReviewRuntimeService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("serializes transcription jobs off the Electron main process", async () => {
    const order: string[] = [];
    let resolveFirst: () => void = () => {
      throw new Error("First transcription resolver was not initialized.");
    };
    let resolveSecond: () => void = () => {
      throw new Error("Second transcription resolver was not initialized.");
    };

    const transcription: ReviewRuntimeTranscriptionAdapter = {
      dispose: vi.fn().mockResolvedValue(undefined),
      isModelAvailable: vi.fn().mockResolvedValue(true),
      transcribeFile: vi.fn((audioPath: string, sessionId: string, source) => {
        order.push(`start:${sessionId}`);

        return new Promise<TranscriptSegment[]>((resolve) => {
          const finish = () => {
            order.push(`finish:${sessionId}`);
            resolve([
              {
                id: `segment-${sessionId}`,
                sessionId,
                speakerLabel: "unknown",
                text: audioPath,
                startOffsetMs: 0,
                endOffsetMs: 1000,
                transcriptConfidence: 0.8,
                source,
              },
            ]);
          };

          if (sessionId === "session-1") {
            resolveFirst = finish;
            return;
          }

          resolveSecond = finish;
        });
      }),
    };

    const runtime = new ReviewRuntimeService(transcription);
    const firstCompleted = waitForEvent<ReviewRuntimeTranscriptionCompleted>(
      runtime,
      "transcription-completed",
      (payload) => payload.job.sessionId === "session-1"
    );
    const secondCompleted = waitForEvent<ReviewRuntimeTranscriptionCompleted>(
      runtime,
      "transcription-completed",
      (payload) => payload.job.sessionId === "session-2"
    );

    runtime.enqueueTranscription({
      audioPath: "audio-1.wav",
      sessionId: "session-1",
      source: "audio_import",
    });
    runtime.enqueueTranscription({
      audioPath: "audio-2.wav",
      sessionId: "session-2",
      source: "live_capture",
    });

    await vi.waitFor(() => {
      expect(order).toEqual(["start:session-1"]);
    });

    resolveFirst();

    await expect(firstCompleted).resolves.toMatchObject({
      job: { sessionId: "session-1" },
    });

    await vi.waitFor(() => {
      expect(order).toEqual([
        "start:session-1",
        "finish:session-1",
        "start:session-2",
      ]);
    });

    resolveSecond();

    await expect(secondCompleted).resolves.toMatchObject({
      job: { sessionId: "session-2" },
    });
  });

  it("surfaces runtime failures through a single failure channel", async () => {
    const transcription: ReviewRuntimeTranscriptionAdapter = {
      dispose: vi.fn().mockResolvedValue(undefined),
      isModelAvailable: vi.fn().mockResolvedValue(false),
      transcribeFile: vi.fn(),
    };
    const runtime = new ReviewRuntimeService(transcription);
    const failed = waitForEvent<ReviewRuntimeTranscriptionFailed>(
      runtime,
      "transcription-failed"
    );

    runtime.enqueueTranscription({
      audioPath: "audio.wav",
      sessionId: "session-1",
      source: "audio_import",
    });

    await expect(failed).resolves.toMatchObject({
      error: expect.objectContaining({
        message: "Local transcription model not found.",
      }),
      job: { sessionId: "session-1" },
    });
    expect(transcription.transcribeFile).not.toHaveBeenCalled();
  });
});

function waitForEvent<T>(
  runtime: ReviewRuntimeService,
  eventName: "transcription-completed" | "transcription-failed",
  predicate?: (payload: T) => boolean
): Promise<T> {
  return new Promise<T>((resolve) => {
    const listener = (payload: T) => {
      if (predicate && !predicate(payload)) {
        return;
      }

      runtime.off(eventName, listener);
      resolve(payload);
    };

    runtime.on(eventName, listener);
  });
}
