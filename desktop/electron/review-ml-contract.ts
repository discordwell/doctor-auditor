import type { TranscriptSegment } from "@doctor-auditor/shared/local-review";

interface ReviewMlRequestBase {
  requestId: string;
  modelRef?: string;
  modelPath: string;
}

export interface ReviewMlModelAvailabilityRequest extends ReviewMlRequestBase {
  kind: "model-availability";
}

export interface ReviewMlTranscribeFileRequest extends ReviewMlRequestBase {
  kind: "transcribe-file";
  audioPath: string;
  sessionId: string;
  source: TranscriptSegment["source"];
  language: string;
}

export type ReviewMlRequest =
  | ReviewMlModelAvailabilityRequest
  | ReviewMlTranscribeFileRequest;

export interface ReviewMlSuccess<T> {
  requestId: string;
  ok: true;
  result: T;
}

export interface ReviewMlFailure {
  requestId: string;
  ok: false;
  error: string;
  stack?: string;
}

export type ReviewMlResponse<T = unknown> = ReviewMlSuccess<T> | ReviewMlFailure;
