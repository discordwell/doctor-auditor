import type { CaptureMode, ISO8601Timestamp } from "./common";

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

export interface ApprovedExportEnvelope {
  id: string;
  organizationId?: string;
  session: {
    localSessionId: string;
    clinicianId: string;
    encounterStartedAt: ISO8601Timestamp;
    encounterEndedAt?: ISO8601Timestamp;
    captureMode: CaptureMode;
  };
  consent: {
    recordedWithConsent: boolean;
    exportAllowed: boolean;
    remoteAssistAllowed: boolean;
    policyVersion: string;
  };
  export: ApprovedExport;
  attestation: {
    reviewedBy: string;
    reviewCompletedAt: ISO8601Timestamp;
    clientVersion: string;
    localBundleHash: string;
    assistReceiptIds: string[];
  };
}

export type OpsEventType =
  | "assist_requested"
  | "assist_completed"
  | "assist_failed"
  | "assist_overridden"
  | "redaction_blocked"
  | "export_approved"
  | "export_sent";

export interface OpsEvent {
  id: string;
  organizationId?: string;
  localSessionId: string;
  exportId?: string;
  assistReceiptId?: string;
  type: OpsEventType;
  recordedAt: ISO8601Timestamp;
  actorId?: string;
  provider?: string;
  model?: string;
  policyMode?: string;
  latencyMs?: number;
  errorCode?: string;
  reviewerAction?: string;
}

export interface OpsSummary {
  totalExports: number;
  approvedExports: number;
  sentExports: number;
  assistUsageCount: number;
  assistOverrideCount: number;
  redactionBlockCount: number;
  averageSendLatencyMs: number | null;
}
