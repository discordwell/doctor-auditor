"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReviewRuntimeService = void 0;
const events_1 = require("events");
const review_ml_1 = require("./review-ml");
class ReviewRuntimeService extends events_1.EventEmitter {
    reviewMl;
    transcriptionQueue = Promise.resolve();
    isDisposed = false;
    constructor(reviewMl = new review_ml_1.PythonReviewMlClient()) {
        super();
        this.reviewMl = reviewMl;
    }
    enqueueTranscription(job) {
        if (this.isDisposed) {
            throw new Error("Review runtime unavailable.");
        }
        this.transcriptionQueue = this.transcriptionQueue
            .catch(() => undefined)
            .then(async () => {
            if (this.isDisposed) {
                throw new Error("Review runtime shut down.");
            }
            const modelAvailable = await this.reviewMl.isModelAvailable();
            if (!modelAvailable) {
                throw new Error("Local transcription model not found.");
            }
            const segments = await this.reviewMl.transcribeFile(job.audioPath, job.sessionId, job.source);
            this.emit("transcription-completed", {
                job,
                segments,
            });
        })
            .catch((error) => {
            this.emit("transcription-failed", {
                error: normalizeError(error),
                job,
            });
        });
    }
    async dispose() {
        this.isDisposed = true;
        await this.reviewMl.dispose();
    }
}
exports.ReviewRuntimeService = ReviewRuntimeService;
function normalizeError(error) {
    return error instanceof Error ? error : new Error(String(error));
}
