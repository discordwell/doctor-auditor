import type { ApprovedExportEnvelope } from "@doctor-auditor/shared/cloud";
import type {
  EvidenceSpan,
  ModelAssistReceipt,
  ReviewDecisionOutcome,
  ReviewSession,
  SessionBundle,
} from "@doctor-auditor/shared/local-review";

export interface SessionIntakeRequest {
  clinicianId: string;
  recordedWithConsent: boolean;
  exportAllowed: boolean;
  remoteAssistAllowed: boolean;
  policyVersion: string;
}

export type ImportSessionRequest = SessionIntakeRequest;
export type LiveCaptureRequest = SessionIntakeRequest;

export interface DesktopSessionSummary {
  session: ReviewSession;
  audioPath?: string;
  transcriptSegmentCount: number;
}

export interface DesktopSessionBundle extends SessionBundle {
  audioPath?: string;
}

export interface PersistReviewDecisionRequest {
  sessionId: string;
  findingId: string;
  outcome: ReviewDecisionOutcome;
  rationale?: string;
  editedTitle?: string;
  editedSummary?: string;
  approvedEvidenceSpans?: EvidenceSpan[];
}

export interface RequestSeriousnessAssistRequest {
  sessionId: string;
  findingId?: string;
}

export interface RequestSeriousnessAssistResult {
  bundle: DesktopSessionBundle | null;
  receipt: ModelAssistReceipt;
  synced: boolean;
  syncError?: string;
}

export interface UpdateModelAssistActionRequest {
  sessionId: string;
  receiptId: string;
  reviewerAction: NonNullable<ModelAssistReceipt["reviewerAction"]>;
}

export interface CreateApprovedExportRequest {
  sessionId: string;
  destination?: string;
  status?: "approved" | "sent";
}

export interface CreateApprovedExportResult {
  bundle: DesktopSessionBundle | null;
  envelope: ApprovedExportEnvelope;
  synced: boolean;
  syncError?: string;
}

export interface AudioDevice {
  id: string;
  name: string;
  isDefault: boolean;
}

export type RecorderBackend = "sox" | "rec";

export type MicrophoneAccessStatus =
  | "not-determined"
  | "granted"
  | "denied"
  | "restricted"
  | "unknown"
  | "unsupported";

export interface LiveCaptureStatus {
  available: boolean;
  experimental: boolean;
  recorder: RecorderBackend | null;
  microphoneAccess: MicrophoneAccessStatus;
  issues: string[];
  notes: string[];
}
