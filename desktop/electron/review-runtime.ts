import { EventEmitter } from "events";
import type { TranscriptSegment } from "@doctor-auditor/shared";
import { TranscriptionService } from "./transcription";

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

export interface ReviewRuntimeTranscriptionAdapter {
  dispose(): Promise<void>;
  isModelAvailable(): Promise<boolean>;
  transcribeFile(
    audioPath: string,
    sessionId: string,
    source: TranscriptSegment["source"]
  ): Promise<TranscriptSegment[]>;
}

export class ReviewRuntimeService extends EventEmitter {
  private readonly transcription: ReviewRuntimeTranscriptionAdapter;
  private transcriptionQueue: Promise<void> = Promise.resolve();
  private isDisposed = false;

  constructor(
    transcription: ReviewRuntimeTranscriptionAdapter = new TranscriptionService()
  ) {
    super();
    this.transcription = transcription;
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

        const modelAvailable = await this.transcription.isModelAvailable();
        if (!modelAvailable) {
          throw new Error("Local transcription model not found.");
        }

        const segments = await this.transcription.transcribeFile(
          job.audioPath,
          job.sessionId,
          job.source
        );

        this.emit("transcription-completed", {
          job,
          segments,
        } satisfies ReviewRuntimeTranscriptionCompleted);
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
    await this.transcription.dispose();
  }
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
