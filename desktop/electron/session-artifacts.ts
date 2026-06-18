import { createHash, randomUUID } from "crypto";
import type {
  ModelAssistReceipt,
  ModelAssistRequest,
  SeriousnessAssessment,
} from "@doctor-auditor/shared/local-review";
import type {
  ApprovedExport,
  ApprovedExportEnvelope,
  OpsEvent,
} from "@doctor-auditor/shared/cloud";
import { isRemoteAssistAllowedForExport } from "./model-assist";
import type { DesktopSessionBundle } from "./review-models";

// The desktop boundary actor. Approved exports, ops events, and assist receipts
// are all attributed to the local reviewer.
export const DESKTOP_REVIEWER_ID = "desktop";

// Mint an assist-receipt id. Generated once per assist invocation and shared by
// the assist_requested ops event, the persisted receipt, and the
// assist_completed / assist_failed ops events so the whole lifecycle is
// correlatable by `assistReceiptId`. Before this was threaded through, the
// requested event carried the *request* id while the receipt (and its
// completed/failed events) carried a different receipt id, so the two halves of
// a single assist could never be joined.
export function newAssistReceiptId(): string {
  return `assist-receipt-${randomUUID()}`;
}

export function normalizeErrorCode(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "assist-request-failed";
  return message
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function buildAssistReceipt(
  request: ModelAssistRequest,
  assessment: SeriousnessAssessment,
  latencyMs: number,
  receiptId: string = newAssistReceiptId()
): ModelAssistReceipt {
  return {
    id: receiptId,
    requestId: request.id,
    sessionId: request.sessionId,
    findingId: request.findingId,
    status: "completed",
    policyMode: request.policyMode,
    requestedAt: request.requestedAt,
    completedAt: assessment.assessedAt,
    latencyMs,
    reviewerAction: "not_applied",
    assessment,
  };
}

export function buildFailedAssistReceipt(
  request: ModelAssistRequest,
  error: unknown,
  latencyMs: number,
  receiptId: string = newAssistReceiptId()
): ModelAssistReceipt {
  return {
    id: receiptId,
    requestId: request.id,
    sessionId: request.sessionId,
    findingId: request.findingId,
    status: "failed",
    policyMode: request.policyMode,
    requestedAt: request.requestedAt,
    completedAt: new Date().toISOString(),
    latencyMs,
    errorCode: normalizeErrorCode(error),
    reviewerAction: "not_applied",
  };
}

export function buildOpsEvent(payload: {
  sessionId: string;
  type: OpsEvent["type"];
  exportId?: string;
  assistReceiptId?: string;
  provider?: string;
  model?: string;
  policyMode?: string;
  latencyMs?: number;
  errorCode?: string;
  reviewerAction?: string;
  assessment?: OpsEvent["assessment"];
}): OpsEvent {
  return {
    id: `ops-${randomUUID()}`,
    localSessionId: payload.sessionId,
    exportId: payload.exportId,
    assistReceiptId: payload.assistReceiptId,
    type: payload.type,
    recordedAt: new Date().toISOString(),
    actorId: DESKTOP_REVIEWER_ID,
    provider: payload.provider,
    model: payload.model,
    policyMode: payload.policyMode,
    latencyMs: payload.latencyMs,
    errorCode: payload.errorCode,
    reviewerAction: payload.reviewerAction,
    assessment: payload.assessment,
  };
}

export function buildApprovedExport(
  bundle: DesktopSessionBundle,
  input: {
    destination?: string;
    status?: "approved" | "sent";
  }
): ApprovedExport {
  if (!bundle.session.consent.exportAllowed) {
    throw new Error("This session is not approved for cloud export.");
  }

  if (bundle.session.reviewStatus !== "completed") {
    throw new Error("Complete local review before creating an approved export.");
  }

  const decisionsById = new Map(
    bundle.reviewDecisions.map((decision) => [decision.id, decision])
  );

  const findings = bundle.findings.flatMap((finding) => {
    if (!finding.reviewDecisionId) {
      return [];
    }

    const decision = decisionsById.get(finding.reviewDecisionId);
    if (!decision || (decision.outcome !== "accepted" && decision.outcome !== "edited")) {
      return [];
    }

    const approvedEvidenceSpans =
      decision.approvedEvidenceSpans ?? finding.evidenceSpans;

    return [
      {
        findingId: finding.id,
        code: finding.code,
        title: decision.editedTitle ?? finding.title,
        summary: decision.editedSummary ?? finding.summary,
        reviewDecisionId: decision.id,
        evidenceExcerpts: approvedEvidenceSpans.map((span) => ({
          sourceEvidenceSpanId: span.id,
          sourceTranscriptSegmentId: span.transcriptSegmentId,
          excerpt: span.excerpt,
          startOffsetMs: span.startOffsetMs,
          endOffsetMs: span.endOffsetMs,
        })),
      },
    ];
  });

  if (findings.length === 0) {
    throw new Error("At least one accepted or edited finding is required for export.");
  }

  const approvedAt = new Date().toISOString();
  const status = input.status ?? "approved";

  return {
    id: `export-${randomUUID()}`,
    sessionId: bundle.session.id,
    status,
    summary:
      findings.length === 1
        ? `Approved export for ${findings[0]?.title ?? "reviewed finding"}.`
        : `Approved export containing ${findings.length} reviewed findings.`,
    findings,
    approvedBy: DESKTOP_REVIEWER_ID,
    approvedAt,
    destination: input.destination ?? "manual-review-hold",
    sentAt: status === "sent" ? approvedAt : undefined,
  };
}

export function buildApprovedExportEnvelope(
  bundle: DesktopSessionBundle,
  approvedExport: ApprovedExport,
  clientVersion: string
): ApprovedExportEnvelope {
  return {
    id: approvedExport.id,
    session: {
      localSessionId: bundle.session.id,
      clinicianId: bundle.session.clinicianId,
      encounterStartedAt: bundle.session.encounterStartedAt,
      encounterEndedAt: bundle.session.encounterEndedAt,
      captureMode: bundle.session.captureMode,
    },
    consent: {
      recordedWithConsent: bundle.session.consent.recordedWithConsent,
      exportAllowed: bundle.session.consent.exportAllowed,
      remoteAssistAllowed: isRemoteAssistAllowedForExport(bundle),
      policyVersion: bundle.session.consent.policyVersion,
    },
    export: approvedExport,
    attestation: {
      reviewedBy: DESKTOP_REVIEWER_ID,
      reviewCompletedAt: bundle.session.updatedAt,
      clientVersion,
      localBundleHash: createHash("sha256")
        .update(JSON.stringify(bundle))
        .digest("hex"),
      assistReceiptIds: bundle.modelAssistReceipts.map((receipt) => receipt.id),
    },
  };
}
