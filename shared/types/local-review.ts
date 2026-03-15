import type { CaptureMode, ISO8601Timestamp } from "./common";
import type { ApprovedExport } from "./cloud";

export type { CaptureMode, ISO8601Timestamp } from "./common";

export type TranscriptStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "failed";

export type ReviewStatus =
  | "not_started"
  | "ready"
  | "in_review"
  | "completed";

export type ExportStatus =
  | "not_requested"
  | "draft"
  | "approved"
  | "sent";

export type FindingStatus =
  | "draft"
  | "pending_review"
  | "accepted"
  | "rejected"
  | "uncertain"
  | "revised";

export type ReviewDecisionOutcome =
  | "accepted"
  | "rejected"
  | "uncertain"
  | "edited";

export type FindingSource = "rules" | "local_llm" | "cloud_llm" | "human";

export type TranscriptSpeakerLabel =
  | "clinician"
  | "patient"
  | "caregiver"
  | "staff"
  | "speaker_a"
  | "speaker_b"
  | "unknown";

export type UserRole = "reviewer" | "quality_lead" | "admin";

export interface SessionConsent {
  recordedWithConsent: boolean;
  exportAllowed: boolean;
  remoteAssistAllowed: boolean;
  policyVersion: string;
  capturedAt?: ISO8601Timestamp;
  capturedBy?: string;
}

export interface ReviewSession {
  id: string;
  clinicianId: string;
  organizationId?: string;
  encounterStartedAt: ISO8601Timestamp;
  encounterEndedAt?: ISO8601Timestamp;
  captureMode: CaptureMode;
  transcriptStatus: TranscriptStatus;
  reviewStatus: ReviewStatus;
  exportStatus: ExportStatus;
  createdAt: ISO8601Timestamp;
  updatedAt: ISO8601Timestamp;
  consent: SessionConsent;
}

export interface TranscriptSegment {
  id: string;
  sessionId: string;
  speakerLabel: TranscriptSpeakerLabel;
  text: string;
  startOffsetMs: number;
  endOffsetMs: number;
  transcriptConfidence?: number;
  speakerConfidence?: number;
  source: "audio_import" | "live_capture" | "manual_edit";
}

export interface EvidenceSpan {
  id: string;
  transcriptSegmentId: string;
  excerpt: string;
  startOffsetMs: number;
  endOffsetMs: number;
  startTextOffset?: number;
  endTextOffset?: number;
}

export interface Finding {
  id: string;
  sessionId: string;
  code: string;
  title: string;
  summary: string;
  status: FindingStatus;
  confidence: number;
  evidenceSpans: EvidenceSpan[];
  detectedBy: FindingSource;
  createdAt: ISO8601Timestamp;
  updatedAt: ISO8601Timestamp;
  reviewDecisionId?: string;
}

export interface ReviewDecision {
  id: string;
  sessionId: string;
  findingId: string;
  outcome: ReviewDecisionOutcome;
  reviewedBy: string;
  reviewedAt: ISO8601Timestamp;
  rationale?: string;
  editedTitle?: string;
  editedSummary?: string;
  approvedEvidenceSpans?: EvidenceSpan[];
}

export type SeriousnessDisposition =
  | "routine_review"
  | "expedited_human_review"
  | "insufficient_context";

export interface MinimizedConcernPacket {
  findingCode: string;
  findingStatus: FindingStatus;
  findingConfidence: number;
  evidenceSpanCount: number;
  speakerLabels: TranscriptSpeakerLabel[];
  captureMode: CaptureMode;
  encounterDurationMs?: number;
}

export interface ModelAssistRequest {
  id: string;
  sessionId: string;
  findingId?: string;
  requestedBy: string;
  requestedAt: ISO8601Timestamp;
  policyVersion: string;
  policyMode: "minimized_no_raw_phi";
  concern: MinimizedConcernPacket;
}

export interface SeriousnessAssessment {
  disposition: SeriousnessDisposition;
  confidence: number;
  rationale: string;
  limitations: string[];
  provider: string;
  model: string;
  assessedAt: ISO8601Timestamp;
}

export interface ModelAssistReceipt {
  id: string;
  requestId: string;
  sessionId: string;
  findingId?: string;
  status: "completed" | "failed";
  policyMode: "minimized_no_raw_phi";
  requestedAt: ISO8601Timestamp;
  completedAt?: ISO8601Timestamp;
  latencyMs?: number;
  errorCode?: string;
  reviewerAction?: "accepted" | "dismissed" | "not_applied";
  assessment?: SeriousnessAssessment;
}

export interface SessionBundle {
  session: ReviewSession;
  transcriptSegments: TranscriptSegment[];
  findings: Finding[];
  reviewDecisions: ReviewDecision[];
  approvedExports: ApprovedExport[];
  auditLogEntries: AuditLogEntry[];
  modelAssistReceipts: ModelAssistReceipt[];
}

export interface AuditLogEntry {
  id: string;
  sessionId: string;
  timestamp: ISO8601Timestamp;
  action:
    | "session_created"
    | "audio_imported"
    | "transcript_viewed"
    | "finding_reviewed"
    | "assist_requested"
    | "assist_completed"
    | "assist_failed"
    | "assist_overridden"
    | "redaction_blocked"
    | "export_approved"
    | "export_sent";
  actorId?: string;
  details: Record<string, unknown>;
}

export interface ReviewUser {
  id: string;
  email: string;
  role: UserRole;
  organizationId: string;
}

export interface ClinicianProfile {
  id: string;
  specialty?: string;
  departmentId?: string;
  organizationId: string;
}
