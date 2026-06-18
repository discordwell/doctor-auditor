import { describe, expect, it } from "vitest";
import type {
  EvidenceSpan,
  Finding,
  ModelAssistRequest,
  ReviewDecision,
  ReviewSession,
  SeriousnessAssessment,
  TranscriptSegment,
} from "@doctor-auditor/shared/local-review";
import type { DesktopSessionBundle } from "./review-models";
import {
  buildApprovedExport,
  buildApprovedExportEnvelope,
  buildAssistReceipt,
  buildFailedAssistReceipt,
  buildOpsEvent,
  DESKTOP_REVIEWER_ID,
  newAssistReceiptId,
  normalizeErrorCode,
} from "./session-artifacts";

const ISO8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

describe("buildApprovedExport", () => {
  it("refuses to build an export when consent does not allow export", () => {
    const bundle = createReviewedBundle({
      session: { consent: { exportAllowed: false } },
    });

    expect(() => buildApprovedExport(bundle, {})).toThrow(
      "This session is not approved for cloud export."
    );
  });

  it("refuses to build an export before local review is completed", () => {
    const bundle = createReviewedBundle({
      session: { reviewStatus: "in_review" },
    });

    expect(() => buildApprovedExport(bundle, {})).toThrow(
      "Complete local review before creating an approved export."
    );
  });

  it("only exports findings whose linked decision is accepted or edited", () => {
    const bundle = createReviewedBundle({
      findings: [
        createFinding({ id: "finding-accepted", reviewDecisionId: "decision-accepted" }),
        createFinding({ id: "finding-edited", reviewDecisionId: "decision-edited" }),
        createFinding({ id: "finding-rejected", reviewDecisionId: "decision-rejected" }),
        createFinding({ id: "finding-uncertain", reviewDecisionId: "decision-uncertain" }),
      ],
      reviewDecisions: [
        createDecision({ id: "decision-accepted", findingId: "finding-accepted", outcome: "accepted" }),
        createDecision({ id: "decision-edited", findingId: "finding-edited", outcome: "edited" }),
        createDecision({ id: "decision-rejected", findingId: "finding-rejected", outcome: "rejected" }),
        createDecision({ id: "decision-uncertain", findingId: "finding-uncertain", outcome: "uncertain" }),
      ],
    });

    const approvedExport = buildApprovedExport(bundle, {});

    expect(approvedExport.findings.map((finding) => finding.findingId)).toEqual([
      "finding-accepted",
      "finding-edited",
    ]);
  });

  it("excludes findings that have no review decision id even if their status looks accepted", () => {
    const bundle = createReviewedBundle({
      findings: [
        createFinding({ id: "finding-orphan", status: "accepted", reviewDecisionId: undefined }),
        createFinding({ id: "finding-linked", reviewDecisionId: "decision-1" }),
      ],
      reviewDecisions: [
        createDecision({ id: "decision-1", findingId: "finding-linked", outcome: "accepted" }),
      ],
    });

    const approvedExport = buildApprovedExport(bundle, {});

    expect(approvedExport.findings.map((finding) => finding.findingId)).toEqual([
      "finding-linked",
    ]);
  });

  it("excludes a finding whose linked decision is missing from the bundle", () => {
    const bundle = createReviewedBundle({
      findings: [createFinding({ id: "finding-1", reviewDecisionId: "decision-missing" })],
      reviewDecisions: [],
    });

    expect(() => buildApprovedExport(bundle, {})).toThrow(
      "At least one accepted or edited finding is required for export."
    );
  });

  it("prefers the reviewer's edited title and summary over the original finding", () => {
    const bundle = createReviewedBundle({
      findings: [
        createFinding({
          id: "finding-1",
          title: "Original title",
          summary: "Original summary",
          reviewDecisionId: "decision-1",
        }),
      ],
      reviewDecisions: [
        createDecision({
          id: "decision-1",
          findingId: "finding-1",
          outcome: "edited",
          editedTitle: "Reviewer edited title",
          editedSummary: "Reviewer edited summary",
        }),
      ],
    });

    const [finding] = buildApprovedExport(bundle, {}).findings;

    expect(finding.title).toBe("Reviewer edited title");
    expect(finding.summary).toBe("Reviewer edited summary");
  });

  it("exports only the reviewer-approved evidence spans when they are set", () => {
    const bundle = createReviewedBundle({
      findings: [
        createFinding({
          id: "finding-1",
          reviewDecisionId: "decision-1",
          evidenceSpans: [
            createSpan({ id: "suggested-span", transcriptSegmentId: "segment-1" }),
          ],
        }),
      ],
      reviewDecisions: [
        createDecision({
          id: "decision-1",
          findingId: "finding-1",
          outcome: "accepted",
          approvedEvidenceSpans: [
            createSpan({
              id: "approved-span",
              transcriptSegmentId: "segment-2",
              excerpt: "Reviewer approved this excerpt only.",
            }),
          ],
        }),
      ],
    });

    const [finding] = buildApprovedExport(bundle, {}).findings;

    expect(finding.evidenceExcerpts).toEqual([
      {
        sourceEvidenceSpanId: "approved-span",
        sourceTranscriptSegmentId: "segment-2",
        excerpt: "Reviewer approved this excerpt only.",
        startOffsetMs: 0,
        endOffsetMs: 1000,
      },
    ]);
  });

  it("falls back to the finding's own evidence spans when no approved set is recorded", () => {
    const bundle = createReviewedBundle({
      findings: [
        createFinding({
          id: "finding-1",
          reviewDecisionId: "decision-1",
          evidenceSpans: [createSpan({ id: "suggested-span", transcriptSegmentId: "segment-1" })],
        }),
      ],
      reviewDecisions: [
        createDecision({
          id: "decision-1",
          findingId: "finding-1",
          outcome: "accepted",
          approvedEvidenceSpans: undefined,
        }),
      ],
    });

    const [finding] = buildApprovedExport(bundle, {}).findings;

    expect(finding.evidenceExcerpts.map((excerpt) => excerpt.sourceEvidenceSpanId)).toEqual([
      "suggested-span",
    ]);
  });

  it("does not leak raw transcript text that the reviewer never approved", () => {
    const bundle = createReviewedBundle({
      transcriptSegments: [
        createSegment({
          id: "segment-1",
          text: "UNAPPROVED RAW PHI THAT MUST STAY LOCAL",
        }),
      ],
      findings: [
        createFinding({
          id: "finding-1",
          reviewDecisionId: "decision-1",
          evidenceSpans: [
            createSpan({
              id: "span-1",
              transcriptSegmentId: "segment-1",
              excerpt: "Only the approved excerpt leaves.",
            }),
          ],
        }),
      ],
      reviewDecisions: [
        createDecision({ id: "decision-1", findingId: "finding-1", outcome: "accepted" }),
      ],
    });

    const serialized = JSON.stringify(buildApprovedExport(bundle, {}));

    expect(serialized).toContain("Only the approved excerpt leaves.");
    expect(serialized).not.toContain("UNAPPROVED RAW PHI THAT MUST STAY LOCAL");
  });

  it("summarizes a single approved finding by its title", () => {
    const bundle = createReviewedBundle({
      findings: [
        createFinding({ id: "finding-1", title: "Empathy acknowledgement", reviewDecisionId: "decision-1" }),
      ],
      reviewDecisions: [
        createDecision({ id: "decision-1", findingId: "finding-1", outcome: "accepted" }),
      ],
    });

    expect(buildApprovedExport(bundle, {}).summary).toBe(
      "Approved export for Empathy acknowledgement."
    );
  });

  it("summarizes multiple approved findings by count", () => {
    const bundle = createReviewedBundle({
      findings: [
        createFinding({ id: "finding-1", reviewDecisionId: "decision-1" }),
        createFinding({ id: "finding-2", reviewDecisionId: "decision-2" }),
      ],
      reviewDecisions: [
        createDecision({ id: "decision-1", findingId: "finding-1", outcome: "accepted" }),
        createDecision({ id: "decision-2", findingId: "finding-2", outcome: "accepted" }),
      ],
    });

    expect(buildApprovedExport(bundle, {}).summary).toBe(
      "Approved export containing 2 reviewed findings."
    );
  });

  it("defaults to an approved, not-yet-sent export with a holding destination", () => {
    const approvedExport = buildApprovedExport(createReviewedBundle(), {});

    expect(approvedExport.id).toMatch(/^export-/);
    expect(approvedExport.sessionId).toBe("session-001");
    expect(approvedExport.status).toBe("approved");
    expect(approvedExport.approvedBy).toBe(DESKTOP_REVIEWER_ID);
    expect(approvedExport.approvedAt).toMatch(ISO8601);
    expect(approvedExport.destination).toBe("manual-review-hold");
    expect(approvedExport.sentAt).toBeUndefined();
  });

  it("stamps sentAt to match approvedAt when the export is created as sent", () => {
    const approvedExport = buildApprovedExport(createReviewedBundle(), {
      status: "sent",
      destination: "compliance-archive",
    });

    expect(approvedExport.status).toBe("sent");
    expect(approvedExport.destination).toBe("compliance-archive");
    expect(approvedExport.sentAt).toBe(approvedExport.approvedAt);
  });
});

describe("buildApprovedExportEnvelope", () => {
  it("keeps the envelope id, export id, and session ids aligned with the server's cross-field rules", () => {
    const bundle = createReviewedBundle();
    const approvedExport = buildApprovedExport(bundle, {});

    const envelope = buildApprovedExportEnvelope(bundle, approvedExport, "desktop-test-1.2.3");

    // Server enforces export.id === envelope.id and
    // export.sessionId === session.localSessionId.
    expect(envelope.id).toBe(approvedExport.id);
    expect(envelope.export.id).toBe(envelope.id);
    expect(envelope.export.sessionId).toBe(envelope.session.localSessionId);
    expect(envelope.session.localSessionId).toBe(bundle.session.id);
  });

  it("carries the supplied client version and a sha256 digest instead of the raw bundle", () => {
    const bundle = createReviewedBundle({
      transcriptSegments: [
        createSegment({ id: "segment-1", text: "RAW BUNDLE CONTENT STAYS LOCAL" }),
      ],
    });
    const approvedExport = buildApprovedExport(bundle, {});

    const envelope = buildApprovedExportEnvelope(bundle, approvedExport, "desktop-test-1.2.3");

    expect(envelope.attestation.clientVersion).toBe("desktop-test-1.2.3");
    expect(envelope.attestation.reviewedBy).toBe(DESKTOP_REVIEWER_ID);
    expect(envelope.attestation.reviewCompletedAt).toBe(bundle.session.updatedAt);
    expect(envelope.attestation.localBundleHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(envelope)).not.toContain("RAW BUNDLE CONTENT STAYS LOCAL");
  });

  it("forces remoteAssistAllowed true and lists receipt ids when assist receipts exist", () => {
    const bundle = createReviewedBundle({
      session: { consent: { remoteAssistAllowed: false } },
      modelAssistReceipts: [
        createReceipt("assist-receipt-001"),
        createReceipt("assist-receipt-002"),
      ],
    });
    const approvedExport = buildApprovedExport(bundle, {});

    const envelope = buildApprovedExportEnvelope(bundle, approvedExport, "desktop-test");

    // Server rejects assistReceiptIds unless remoteAssistAllowed is true, so the
    // envelope must reconcile the two whenever receipts are present.
    expect(envelope.consent.remoteAssistAllowed).toBe(true);
    expect(envelope.attestation.assistReceiptIds).toEqual([
      "assist-receipt-001",
      "assist-receipt-002",
    ]);
  });

  it("leaves remoteAssistAllowed false with no receipts when assist was never used", () => {
    const bundle = createReviewedBundle({
      session: { consent: { remoteAssistAllowed: false } },
      modelAssistReceipts: [],
    });
    const approvedExport = buildApprovedExport(bundle, {});

    const envelope = buildApprovedExportEnvelope(bundle, approvedExport, "desktop-test");

    expect(envelope.consent.remoteAssistAllowed).toBe(false);
    expect(envelope.attestation.assistReceiptIds).toEqual([]);
  });

  it("copies the session and consent metadata onto the envelope", () => {
    const bundle = createReviewedBundle();
    const approvedExport = buildApprovedExport(bundle, {});

    const envelope = buildApprovedExportEnvelope(bundle, approvedExport, "desktop-test");

    expect(envelope.session).toMatchObject({
      localSessionId: "session-001",
      clinicianId: "Dr. Test",
      captureMode: "audio_import",
    });
    expect(envelope.consent).toMatchObject({
      recordedWithConsent: true,
      exportAllowed: true,
      policyVersion: "policy-v1",
    });
  });
});

describe("assist receipts", () => {
  it("reuses an injected receipt id so the assist lifecycle stays correlatable", () => {
    const request = createAssistRequest();
    const assessment = createAssessment();
    const receiptId = "assist-receipt-shared";

    const receipt = buildAssistReceipt(request, assessment, 250, receiptId);

    expect(receipt.id).toBe(receiptId);
    expect(receipt.requestId).toBe(request.id);
    expect(receipt.status).toBe("completed");
    expect(receipt.findingId).toBe(request.findingId);
    expect(receipt.completedAt).toBe(assessment.assessedAt);
    expect(receipt.latencyMs).toBe(250);
    expect(receipt.reviewerAction).toBe("not_applied");
    expect(receipt.assessment).toEqual(assessment);
  });

  it("mints a fresh assist-receipt id when none is supplied", () => {
    const receipt = buildAssistReceipt(createAssistRequest(), createAssessment(), 10);

    expect(receipt.id).toMatch(/^assist-receipt-/);
  });

  it("records a failed receipt with a normalized error code and no assessment", () => {
    const request = createAssistRequest();

    const receipt = buildFailedAssistReceipt(
      request,
      new Error("Gateway timeout while contacting upstream!"),
      900,
      "assist-receipt-shared"
    );

    expect(receipt.id).toBe("assist-receipt-shared");
    expect(receipt.requestId).toBe(request.id);
    expect(receipt.status).toBe("failed");
    expect(receipt.errorCode).toBe("gateway-timeout-while-contacting-upstream");
    expect(receipt.assessment).toBeUndefined();
    expect(receipt.completedAt).toMatch(ISO8601);
    expect(receipt.latencyMs).toBe(900);
  });

  it("derives the same receipt id used by the assist_requested ops event (regression for lifecycle correlation)", () => {
    const request = createAssistRequest();
    const assistReceiptId = newAssistReceiptId();

    const requestedEvent = buildOpsEvent({
      sessionId: request.sessionId,
      assistReceiptId,
      type: "assist_requested",
      policyMode: request.policyMode,
    });
    const completed = buildAssistReceipt(request, createAssessment(), 120, assistReceiptId);
    const failed = buildFailedAssistReceipt(request, new Error("boom"), 120, assistReceiptId);

    expect(requestedEvent.assistReceiptId).toBe(assistReceiptId);
    expect(completed.id).toBe(assistReceiptId);
    expect(failed.id).toBe(assistReceiptId);
  });

  it("mints unique receipt ids", () => {
    expect(newAssistReceiptId()).not.toBe(newAssistReceiptId());
  });
});

describe("buildOpsEvent", () => {
  it("stamps a desktop-attributed ops event with the provided context", () => {
    const event = buildOpsEvent({
      sessionId: "session-001",
      assistReceiptId: "assist-receipt-001",
      type: "assist_completed",
      provider: "openai",
      model: "policy-heuristic-v1",
      policyMode: "minimized_no_raw_phi",
      latencyMs: 712,
    });

    expect(event.id).toMatch(/^ops-/);
    expect(event.localSessionId).toBe("session-001");
    expect(event.assistReceiptId).toBe("assist-receipt-001");
    expect(event.type).toBe("assist_completed");
    expect(event.actorId).toBe(DESKTOP_REVIEWER_ID);
    expect(event.recordedAt).toMatch(ISO8601);
    expect(event.provider).toBe("openai");
    expect(event.latencyMs).toBe(712);
  });
});

describe("normalizeErrorCode", () => {
  it("slugifies an error message", () => {
    expect(normalizeErrorCode(new Error("Connection Reset: ECONNRESET"))).toBe(
      "connection-reset-econnreset"
    );
  });

  it("falls back to a generic code for non-error inputs", () => {
    expect(normalizeErrorCode("plain string")).toBe("assist-request-failed");
    expect(normalizeErrorCode(undefined)).toBe("assist-request-failed");
  });

  it("trims leading and trailing separators and caps the length at 80 characters", () => {
    const code = normalizeErrorCode(new Error(`!!!${"a".repeat(200)}!!!`));

    expect(code).toBe("a".repeat(80));
    expect(code.startsWith("-")).toBe(false);
    expect(code.endsWith("-")).toBe(false);
  });
});

function createReviewedBundle(
  overrides: Omit<Partial<DesktopSessionBundle>, "session"> & {
    session?: Omit<Partial<ReviewSession>, "consent"> & {
      consent?: Partial<ReviewSession["consent"]>;
    };
  } = {}
): DesktopSessionBundle {
  const sessionOverrides = overrides.session ?? {};
  const session: ReviewSession = {
    id: "session-001",
    clinicianId: "Dr. Test",
    encounterStartedAt: "2026-03-15T10:00:00Z",
    encounterEndedAt: "2026-03-15T10:15:00Z",
    captureMode: "audio_import",
    transcriptStatus: "completed",
    reviewStatus: "completed",
    exportStatus: "draft",
    createdAt: "2026-03-15T10:00:00Z",
    updatedAt: "2026-03-15T10:30:00Z",
    ...sessionOverrides,
    consent: {
      recordedWithConsent: true,
      exportAllowed: true,
      remoteAssistAllowed: true,
      policyVersion: "policy-v1",
      capturedAt: "2026-03-15T10:00:00Z",
      capturedBy: "desktop",
      ...(sessionOverrides.consent ?? {}),
    },
  };

  const findings =
    overrides.findings ?? [createFinding({ id: "finding-1", reviewDecisionId: "decision-1" })];
  const reviewDecisions =
    overrides.reviewDecisions ??
    [createDecision({ id: "decision-1", findingId: "finding-1", outcome: "accepted" })];

  return {
    session,
    transcriptSegments: overrides.transcriptSegments ?? [createSegment({ id: "segment-1" })],
    findings,
    reviewDecisions,
    approvedExports: overrides.approvedExports ?? [],
    auditLogEntries: overrides.auditLogEntries ?? [],
    modelAssistReceipts: overrides.modelAssistReceipts ?? [],
    audioPath: overrides.audioPath,
  };
}

function createFinding(overrides: Partial<Finding> & { id: string }): Finding {
  return {
    sessionId: "session-001",
    code: "finding-code",
    title: "Finding title",
    summary: "Finding summary",
    status: "pending_review",
    confidence: 0.8,
    evidenceSpans: [createSpan({ id: `${overrides.id}-span`, transcriptSegmentId: "segment-1" })],
    detectedBy: "rules",
    createdAt: "2026-03-15T10:05:00Z",
    updatedAt: "2026-03-15T10:05:00Z",
    ...overrides,
  };
}

function createDecision(
  overrides: Partial<ReviewDecision> & { id: string; findingId: string }
): ReviewDecision {
  return {
    sessionId: "session-001",
    outcome: "accepted",
    reviewedBy: "desktop",
    reviewedAt: "2026-03-15T10:20:00Z",
    ...overrides,
  };
}

function createSpan(overrides: Partial<EvidenceSpan> & { id: string }): EvidenceSpan {
  return {
    transcriptSegmentId: "segment-1",
    excerpt: "Evidence excerpt.",
    startOffsetMs: 0,
    endOffsetMs: 1000,
    ...overrides,
  };
}

function createSegment(overrides: Partial<TranscriptSegment> & { id: string }): TranscriptSegment {
  return {
    sessionId: "session-001",
    speakerLabel: "clinician",
    text: "Transcript segment text.",
    startOffsetMs: 0,
    endOffsetMs: 1000,
    source: "audio_import",
    ...overrides,
  };
}

function createAssistRequest(): ModelAssistRequest {
  return {
    id: "assist-request-001",
    sessionId: "session-001",
    findingId: "finding-1",
    requestedBy: "desktop",
    requestedAt: "2026-03-15T10:06:00Z",
    policyVersion: "policy-v1",
    policyMode: "minimized_no_raw_phi",
    concern: {
      findingCode: "finding-code",
      findingStatus: "pending_review",
      findingConfidence: 0.8,
      evidenceSpanCount: 1,
      speakerLabels: ["clinician", "patient"],
      captureMode: "audio_import",
      encounterDurationMs: 15 * 60 * 1000,
    },
  };
}

function createAssessment(): SeriousnessAssessment {
  return {
    disposition: "routine_review",
    confidence: 0.7,
    rationale: "Routine review is sufficient for this minimized packet.",
    limitations: ["Only minimized structured context was provided."],
    provider: "openai",
    model: "policy-heuristic-v1",
    assessedAt: "2026-03-15T10:06:01Z",
  };
}

function createReceipt(id: string) {
  return {
    id,
    requestId: "assist-request-001",
    sessionId: "session-001",
    status: "completed" as const,
    policyMode: "minimized_no_raw_phi" as const,
    requestedAt: "2026-03-15T10:06:00Z",
    completedAt: "2026-03-15T10:06:01Z",
    latencyMs: 180,
    reviewerAction: "not_applied" as const,
    assessment: createAssessment(),
  };
}
