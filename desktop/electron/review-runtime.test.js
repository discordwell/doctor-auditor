"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const review_runtime_1 = require("./review-runtime");
(0, vitest_1.describe)("ReviewRuntimeService", () => {
    (0, vitest_1.afterEach)(() => {
        vitest_1.vi.restoreAllMocks();
    });
    (0, vitest_1.it)("serializes transcription jobs off the Electron main process", async () => {
        const order = [];
        let resolveFirst = () => {
            throw new Error("First transcription resolver was not initialized.");
        };
        let resolveSecond = () => {
            throw new Error("Second transcription resolver was not initialized.");
        };
        const transcription = {
            dispose: vitest_1.vi.fn().mockResolvedValue(undefined),
            isModelAvailable: vitest_1.vi.fn().mockResolvedValue(true),
            transcribeFile: vitest_1.vi.fn((audioPath, sessionId, source) => {
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
            }),
        };
        const runtime = new review_runtime_1.ReviewRuntimeService(transcription);
        const firstCompleted = waitForEvent(runtime, "transcription-completed", (payload) => payload.job.sessionId === "session-1");
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
            (0, vitest_1.expect)(order).toEqual([
                "start:session-1",
                "finish:session-1",
                "start:session-2",
            ]);
        });
        resolveSecond();
        await (0, vitest_1.expect)(secondCompleted).resolves.toMatchObject({
            job: { sessionId: "session-2" },
        });
    });
    (0, vitest_1.it)("surfaces runtime failures through a single failure channel", async () => {
        const transcription = {
            dispose: vitest_1.vi.fn().mockResolvedValue(undefined),
            isModelAvailable: vitest_1.vi.fn().mockResolvedValue(false),
            transcribeFile: vitest_1.vi.fn(),
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
        (0, vitest_1.expect)(transcription.transcribeFile).not.toHaveBeenCalled();
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
