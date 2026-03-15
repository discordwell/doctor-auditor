import { EventEmitter } from "events";
import type {
  Finding,
  TranscriptSegment,
} from "@doctor-auditor/shared/local-review";
import type { ReviewMlAnalysisResult } from "./review-ml-contract";
import { PythonReviewMlClient } from "./review-ml";

export interface ReviewRuntimeTranscriptionJob {
  audioPath: string;
  sessionId: string;
  source: TranscriptSegment["source"];
}

export interface ReviewRuntimeTranscriptionCompleted {
  job: ReviewRuntimeTranscriptionJob;
  segments: TranscriptSegment[];
}

export interface ReviewRuntimeTranscriptionFailed {
  error: Error;
  job: ReviewRuntimeTranscriptionJob;
}

export interface ReviewRuntimeAnalysisCompleted {
  analysis: ReviewMlAnalysisResult;
  findings: Finding[];
  job: ReviewRuntimeTranscriptionJob;
  segments: TranscriptSegment[];
}

export interface ReviewRuntimeAnalysisFailed {
  error: Error;
  job: ReviewRuntimeTranscriptionJob;
  segments: TranscriptSegment[];
}

export interface ReviewRuntimeMlAdapter {
  dispose(): Promise<void>;
  isModelAvailable(): Promise<boolean>;
  analyzeTranscript(
    sessionId: string,
    transcriptSegments: TranscriptSegment[]
  ): Promise<ReviewMlAnalysisResult>;
  transcribeFile(
    audioPath: string,
    sessionId: string,
    source: TranscriptSegment["source"]
  ): Promise<TranscriptSegment[]>;
}

export class ReviewRuntimeService extends EventEmitter {
  private readonly reviewMl: ReviewRuntimeMlAdapter;
  private transcriptionQueue: Promise<void> = Promise.resolve();
  private isDisposed = false;

  constructor(
    reviewMl: ReviewRuntimeMlAdapter = new PythonReviewMlClient()
  ) {
    super();
    this.reviewMl = reviewMl;
  }

  enqueueTranscription(job: ReviewRuntimeTranscriptionJob): void {
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

        const segments = await this.reviewMl.transcribeFile(
          job.audioPath,
          job.sessionId,
          job.source
        );

        this.emit("transcription-completed", {
          job,
          segments,
        } satisfies ReviewRuntimeTranscriptionCompleted);

        try {
          const analysis = await this.reviewMl.analyzeTranscript(
            job.sessionId,
            segments
          );
          this.emit("analysis-completed", {
            analysis,
            findings: analysis.findings,
            job,
            segments,
          } satisfies ReviewRuntimeAnalysisCompleted);
        } catch (error) {
          this.emit("analysis-failed", {
            error: normalizeError(error),
            job,
            segments,
          } satisfies ReviewRuntimeAnalysisFailed);
        }
      })
      .catch((error) => {
        this.emit("transcription-failed", {
          error: normalizeError(error),
          job,
        } satisfies ReviewRuntimeTranscriptionFailed);
      });
  }

  async dispose(): Promise<void> {
    this.isDisposed = true;
    await this.reviewMl.dispose();
  }
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
