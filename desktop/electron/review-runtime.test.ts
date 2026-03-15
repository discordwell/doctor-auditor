import { describe, expect, it, vi } from "vitest";
import type { TranscriptSegment } from "@doctor-auditor/shared/local-review";
import type { ReviewMlAnalysisResult } from "./review-ml-contract";
import {
  type ReviewRuntimeAnalysisCompleted,
  type ReviewRuntimeAnalysisFailed,
  ReviewRuntimeService,
  type ReviewRuntimeMlAdapter,
  type ReviewRuntimeTranscriptionCompleted,
  type ReviewRuntimeTranscriptionFailed,
} from "./review-runtime";

describe("ReviewRuntimeService", () => {
  it("serializes transcription jobs off the Electron main process", async () => {
    const order: string[] = [];
    let resolveFirst: () => void = () => {
      throw new Error("First transcription resolver was not initialized.");
    };
    let resolveSecond: () => void = () => {
      throw new Error("Second transcription resolver was not initialized.");
    };

    const transcription: ReviewRuntimeMlAdapter = {
      analyzeTranscript: async (
        sessionId: string,
        transcriptSegments
      ): Promise<ReviewMlAnalysisResult> => {
        order.push(`analyze:${sessionId}`);
        return {
          evidenceSpans: [
            {
              id: `evidence-${sessionId}`,
              transcriptSegmentId:
                transcriptSegments[0]?.id ?? "missing-segment",
              excerpt: transcriptSegments[0]?.text ?? "",
              startOffsetMs: 0,
              endOffsetMs: 1000,
            },
          ],
          findings: [
            {
              id: `finding-${sessionId}`,
              sessionId,
              code: "follow-up-needed",
              title: "Follow-up instructions need review",
              summary: "A stub local finding was generated after transcription.",
              status: "pending_review",
              confidence: 0.61,
              evidenceSpans: [
                {
                  id: `evidence-${sessionId}`,
                  transcriptSegmentId:
                    transcriptSegments[0]?.id ?? "missing-segment",
                  excerpt: transcriptSegments[0]?.text ?? "",
                  startOffsetMs: 0,
                  endOffsetMs: 1000,
                },
              ],
              detectedBy: "rules",
              createdAt: "2026-03-15T00:00:00Z",
              updatedAt: "2026-03-15T00:00:00Z",
            },
          ],
        };
      },
      dispose: async () => undefined,
      isModelAvailable: async () => true,
      transcribeFile: (audioPath: string, sessionId: string, source) => {
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
      },
    };

    const runtime = new ReviewRuntimeService(transcription);
    const firstCompleted = waitForEvent<ReviewRuntimeTranscriptionCompleted>(
      runtime,
      "transcription-completed",
      (payload) => payload.job.sessionId === "session-1"
    );
    const firstAnalysisCompleted =
      waitForEvent<ReviewRuntimeAnalysisCompleted>(
        runtime,
        "analysis-completed",
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
      expect(order).toEqual(["start:session-1", "finish:session-1", "analyze:session-1"]);
    });

    await expect(firstAnalysisCompleted).resolves.toMatchObject({
      analysis: {
        findings: [
          {
            id: "finding-session-1",
          },
        ],
      },
      job: { sessionId: "session-1" },
    });

    await vi.waitFor(() => {
      expect(order).toEqual([
        "start:session-1",
        "finish:session-1",
        "analyze:session-1",
        "start:session-2",
      ]);
    });

    resolveSecond();

    await expect(secondCompleted).resolves.toMatchObject({
      job: { sessionId: "session-2" },
    });
  });

  it("surfaces runtime failures through a single failure channel", async () => {
    let transcribeCallCount = 0;
    const transcription: ReviewRuntimeMlAdapter = {
      analyzeTranscript: async (): Promise<ReviewMlAnalysisResult> => ({
        evidenceSpans: [],
        findings: [],
      }),
      dispose: async () => undefined,
      isModelAvailable: async () => false,
      transcribeFile: async () => {
        transcribeCallCount += 1;
        return [];
      },
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
    expect(transcribeCallCount).toBe(0);
  });

  it("surfaces transcript-analysis failures after transcript completion", async () => {
    const transcription: ReviewRuntimeMlAdapter = {
      analyzeTranscript: async (): Promise<ReviewMlAnalysisResult> => {
        throw new Error("Local transcript analysis failed.");
      },
      dispose: async () => undefined,
      isModelAvailable: async () => true,
      transcribeFile: async () => [
        {
          id: "segment-1",
          sessionId: "session-1",
          speakerLabel: "unknown",
          text: "Please call if the dizziness returns.",
          startOffsetMs: 0,
          endOffsetMs: 1200,
          source: "audio_import",
        },
      ],
    };
    const runtime = new ReviewRuntimeService(transcription);
    const completed = waitForEvent<ReviewRuntimeTranscriptionCompleted>(
      runtime,
      "transcription-completed"
    );
    const failed = waitForEvent<ReviewRuntimeAnalysisFailed>(
      runtime,
      "analysis-failed"
    );

    runtime.enqueueTranscription({
      audioPath: "audio.wav",
      sessionId: "session-1",
      source: "audio_import",
    });

    await expect(completed).resolves.toMatchObject({
      job: { sessionId: "session-1" },
    });
    await expect(failed).resolves.toMatchObject({
      error: expect.objectContaining({
        message: "Local transcript analysis failed.",
      }),
      job: { sessionId: "session-1" },
      segments: [
        {
          id: "segment-1",
        },
      ],
    });
  });
});

function waitForEvent<T>(
  runtime: ReviewRuntimeService,
  eventName:
    | "analysis-completed"
    | "analysis-failed"
    | "transcription-completed"
    | "transcription-failed",
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
