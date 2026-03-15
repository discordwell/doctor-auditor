import type { TranscriptSegment } from "@doctor-auditor/shared";

interface TranscriptionWorkerRequestBase {
  requestId: string;
  modelPath: string;
}

export interface ModelAvailabilityRequest
  extends TranscriptionWorkerRequestBase {
  kind: "model-availability";
}

export interface TranscribeFileRequest
  extends TranscriptionWorkerRequestBase {
  kind: "transcribe-file";
  audioPath: string;
  sessionId: string;
  source: TranscriptSegment["source"];
  language: string;
}

export type TranscriptionWorkerRequest =
  | ModelAvailabilityRequest
  | TranscribeFileRequest;

export interface TranscriptionWorkerSuccess<T> {
  requestId: string;
  ok: true;
  result: T;
}

export interface TranscriptionWorkerFailure {
  requestId: string;
  ok: false;
  error: string;
  stack?: string;
}

export type TranscriptionWorkerResponse<T = unknown> =
  | TranscriptionWorkerSuccess<T>
  | TranscriptionWorkerFailure;
