"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const review_runtime_1 = require("./review-runtime");
(0, vitest_1.describe)("ReviewRuntimeService", () => {
    (0, vitest_1.it)("serializes transcription jobs off the Electron main process", async () => {
        const order = [];
        let resolveFirst = () => {
            throw new Error("First transcription resolver was not initialized.");
        };
        let resolveSecond = () => {
            throw new Error("Second transcription resolver was not initialized.");
        };
        const transcription = {
            analyzeTranscript: async (sessionId, transcriptSegments) => {
                order.push(`analyze:${sessionId}`);
                return {
                    evidenceSpans: [
                        {
                            id: `evidence-${sessionId}`,
                            transcriptSegmentId: transcriptSegments[0]?.id ?? "missing-segment",
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
                                    transcriptSegmentId: transcriptSegments[0]?.id ?? "missing-segment",
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
            transcribeFile: (audioPath, sessionId, source) => {
                order.push(`start:${sessionId}`);
                return new Promise((resolve) => {
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
        const runtime = new review_runtime_1.ReviewRuntimeService(transcription);
        const firstCompleted = waitForEvent(runtime, "transcription-completed", (payload) => payload.job.sessionId === "session-1");
        const firstAnalysisCompleted = waitForEvent(runtime, "analysis-completed", (payload) => payload.job.sessionId === "session-1");
        const secondCompleted = waitForEvent(runtime, "transcription-completed", (payload) => payload.job.sessionId === "session-2");
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
        await vitest_1.vi.waitFor(() => {
            (0, vitest_1.expect)(order).toEqual(["start:session-1"]);
        });
        resolveFirst();
        await (0, vitest_1.expect)(firstCompleted).resolves.toMatchObject({
            job: { sessionId: "session-1" },
        });
        await vitest_1.vi.waitFor(() => {
            (0, vitest_1.expect)(order).toEqual(["start:session-1", "finish:session-1", "analyze:session-1"]);
        });
        await (0, vitest_1.expect)(firstAnalysisCompleted).resolves.toMatchObject({
            analysis: {
                findings: [
                    {
                        id: "finding-session-1",
                    },
                ],
            },
            job: { sessionId: "session-1" },
        });
        await vitest_1.vi.waitFor(() => {
            (0, vitest_1.expect)(order).toEqual([
                "start:session-1",
                "finish:session-1",
                "analyze:session-1",
                "start:session-2",
            ]);
        });
        resolveSecond();
        await (0, vitest_1.expect)(secondCompleted).resolves.toMatchObject({
            job: { sessionId: "session-2" },
        });
    });
    (0, vitest_1.it)("surfaces runtime failures through a single failure channel", async () => {
        let transcribeCallCount = 0;
        const transcription = {
            analyzeTranscript: async () => ({
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
        const runtime = new review_runtime_1.ReviewRuntimeService(transcription);
        const failed = waitForEvent(runtime, "transcription-failed");
        runtime.enqueueTranscription({
            audioPath: "audio.wav",
            sessionId: "session-1",
            source: "audio_import",
        });
        await (0, vitest_1.expect)(failed).resolves.toMatchObject({
            error: vitest_1.expect.objectContaining({
                message: "Local transcription model not found.",
            }),
            job: { sessionId: "session-1" },
        });
        (0, vitest_1.expect)(transcribeCallCount).toBe(0);
    });
    (0, vitest_1.it)("surfaces transcript-analysis failures after transcript completion", async () => {
        const transcription = {
            analyzeTranscript: async () => {
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
        const runtime = new review_runtime_1.ReviewRuntimeService(transcription);
        const completed = waitForEvent(runtime, "transcription-completed");
        const failed = waitForEvent(runtime, "analysis-failed");
        runtime.enqueueTranscription({
            audioPath: "audio.wav",
            sessionId: "session-1",
            source: "audio_import",
        });
        await (0, vitest_1.expect)(completed).resolves.toMatchObject({
            job: { sessionId: "session-1" },
        });
        await (0, vitest_1.expect)(failed).resolves.toMatchObject({
            error: vitest_1.expect.objectContaining({
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
function waitForEvent(runtime, eventName, predicate) {
    return new Promise((resolve) => {
        const listener = (payload) => {
            if (predicate && !predicate(payload)) {
                return;
            }
            runtime.off(eventName, listener);
            resolve(payload);
        };
        runtime.on(eventName, listener);
    });
}
