import type {
  EvidenceSpan,
  Finding,
  TranscriptSegment,
} from "@doctor-auditor/shared/local-review";

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

export interface ReviewMlAnalyzeTranscriptRequest extends ReviewMlRequestBase {
  kind: "analyze-transcript";
  sessionId: string;
  transcriptSegments: TranscriptSegment[];
}

export interface ReviewMlAnalysisResult {
  findings: Finding[];
  evidenceSpans: EvidenceSpan[];
}

export type ReviewMlRequest =
  | ReviewMlModelAvailabilityRequest
  | ReviewMlTranscribeFileRequest
  | ReviewMlAnalyzeTranscriptRequest;

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
