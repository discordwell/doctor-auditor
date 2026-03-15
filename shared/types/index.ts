// Review workflow contracts shared across desktop, server, and dashboard lanes.

export type ISO8601Timestamp = string;

export type CaptureMode = "audio_import" | "live_capture" | "manual_entry";

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
  transcriptConfidence?: number; // 0-1 confidence from the transcription pipeline
  speakerConfidence?: number; // 0-1 confidence from speaker attribution
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
  confidence: number; // 0-1 confidence for the specific finding
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

export interface ApprovedEvidenceExcerpt {
  sourceEvidenceSpanId: string;
  sourceTranscriptSegmentId: string;
  excerpt: string;
  startOffsetMs: number;
  endOffsetMs: number;
}

export interface ApprovedExportFinding {
  findingId: string;
  code: string;
  title: string;
  summary: string;
  reviewDecisionId: string;
  evidenceExcerpts: ApprovedEvidenceExcerpt[];
}

export interface ApprovedExport {
  id: string;
  sessionId: string;
  status: "draft" | "approved" | "sent";
  summary: string;
  findings: ApprovedExportFinding[];
  approvedBy: string;
  approvedAt: ISO8601Timestamp;
  destination?: string;
  sentAt?: ISO8601Timestamp;
}

export interface SessionBundle {
  session: ReviewSession;
  transcriptSegments: TranscriptSegment[];
  findings: Finding[];
  reviewDecisions: ReviewDecision[];
  approvedExports: ApprovedExport[];
  auditLogEntries: AuditLogEntry[];
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
