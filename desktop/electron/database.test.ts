import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ModelAssistRequest } from "@doctor-auditor/shared/local-review";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalDatabase } from "./database";

const cleanupPaths: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  while (cleanupPaths.length > 0) {
    const target = cleanupPaths.pop();
    if (target) {
      rmSync(target, { recursive: true, force: true });
    }
  }
});

describe("LocalDatabase review artifacts", () => {
  it("persists findings, review decisions, and approved exports locally", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T10:05:00Z"));

    const db = createDatabase();
    const capturedAt = "2026-03-15T10:00:00Z";
    const session = db.createImportedSession({
      clinicianId: "clinician-42",
      recordedWithConsent: true,
      exportAllowed: true,
      remoteAssistAllowed: true,
      policyVersion: "policy-v1",
      audioPath: "/tmp/encounter.wav",
      capturedAt,
      sourceFileName: "encounter.wav",
    });
    const sessionId = session.session.id;

    db.replaceTranscriptSegments(sessionId, [
      {
        id: "segment-001",
        sessionId,
        speakerLabel: "patient",
        text: "I missed two doses because the refill was delayed.",
        startOffsetMs: 0,
        endOffsetMs: 4300,
        transcriptConfidence: 0.97,
        speakerConfidence: 0.91,
        source: "audio_import",
      },
    ]);

    db.replaceFindings(sessionId, [
      {
        id: "finding-001",
        sessionId,
        code: "medication-adherence",
        title: "Medication adherence needs review",
        summary: "The patient reported missing two doses due to a delayed refill.",
        status: "pending_review",
        confidence: 0.82,
        evidenceSpans: [
          {
            id: "evidence-001",
            transcriptSegmentId: "segment-001",
            excerpt: "I missed two doses because the refill was delayed.",
            startOffsetMs: 0,
            endOffsetMs: 4300,
            startTextOffset: 0,
            endTextOffset: 50,
          },
        ],
        detectedBy: "rules",
        createdAt: capturedAt,
        updatedAt: capturedAt,
      },
    ]);

    const reviewedBundle = db.saveReviewDecision({
      sessionId,
      findingId: "finding-001",
      outcome: "accepted",
      reviewedBy: "reviewer-1",
    });

    expect(reviewedBundle).not.toBeNull();
    expect(reviewedBundle?.findings).toHaveLength(1);
    expect(reviewedBundle?.reviewDecisions).toHaveLength(1);
    expect(reviewedBundle?.approvedExports).toHaveLength(0);
    expect(reviewedBundle?.findings[0]?.status).toBe("accepted");
    expect(reviewedBundle?.session.reviewStatus).toBe("completed");
    expect(reviewedBundle?.auditLogEntries.at(-1)?.action).toBe(
      "finding_reviewed"
    );

    const decisionId = reviewedBundle?.reviewDecisions[0]?.id;
    expect(decisionId).toBeTruthy();

    const exportedBundle = db.saveApprovedExport({
      id: "export-001",
      sessionId,
      status: "approved",
      summary: "Approved summary for medication adherence follow-up.",
      findings: [
        {
          findingId: "finding-001",
          code: "medication-adherence",
          title: "Medication adherence needs review",
          summary: "The patient missed doses because the refill was delayed.",
          reviewDecisionId: decisionId ?? "missing-decision",
          evidenceExcerpts: [
            {
              sourceEvidenceSpanId: "evidence-001",
              sourceTranscriptSegmentId: "segment-001",
              excerpt: "I missed two doses because the refill was delayed.",
              startOffsetMs: 0,
              endOffsetMs: 4300,
            },
          ],
        },
      ],
      approvedBy: "quality-lead-1",
      approvedAt: "2026-03-15T10:30:00Z",
      destination: "qa-review-queue",
    });

    expect(exportedBundle).not.toBeNull();
    expect(exportedBundle?.approvedExports).toHaveLength(1);
    expect(exportedBundle?.session.exportStatus).toBe("approved");
    expect(exportedBundle?.auditLogEntries.at(-1)?.action).toBe(
      "export_approved"
    );

    db.close();
  });

  it("persists local assist receipts without mutating export state", () => {
    const db = createDatabase();
    const capturedAt = "2026-03-15T11:00:00Z";
    const session = db.createImportedSession({
      clinicianId: "clinician-99",
      recordedWithConsent: true,
      exportAllowed: true,
      remoteAssistAllowed: true,
      policyVersion: "policy-v1",
      audioPath: "/tmp/assist.wav",
      capturedAt,
      sourceFileName: "assist.wav",
    });
    const sessionId = session.session.id;

    db.replaceTranscriptSegments(sessionId, [
      {
        id: "segment-assist-001",
        sessionId,
        speakerLabel: "patient",
        text: "The refill delay meant I missed another dose.",
        startOffsetMs: 0,
        endOffsetMs: 3200,
        source: "audio_import",
      },
    ]);

    db.replaceFindings(sessionId, [
      {
        id: "finding-assist-001",
        sessionId,
        code: "medication-risk",
        title: "Medication risk needs a second look",
        summary: "The patient described a delayed refill and a missed dose.",
        status: "pending_review",
        confidence: 0.77,
        evidenceSpans: [
          {
            id: "evidence-assist-001",
            transcriptSegmentId: "segment-assist-001",
            excerpt: "The refill delay meant I missed another dose.",
            startOffsetMs: 0,
            endOffsetMs: 3200,
          },
        ],
        detectedBy: "rules",
        createdAt: capturedAt,
        updatedAt: capturedAt,
      },
    ]);

    const request: ModelAssistRequest = {
      id: "assist-request-001",
      sessionId,
      findingId: "finding-assist-001",
      requestedBy: "reviewer-2",
      requestedAt: "2026-03-15T11:05:00Z",
      policyVersion: "policy-v1",
      policyMode: "minimized_no_raw_phi" as const,
      concern: {
        findingCode: "medication-risk",
        findingStatus: "pending_review" as const,
        findingConfidence: 0.77,
        evidenceSpanCount: 1,
        speakerLabels: ["patient"],
        captureMode: "audio_import" as const,
      },
    };
    db.recordModelAssistRequested(request);

    const bundle = db.saveModelAssistReceipt({
      request,
      receipt: {
        id: "assist-receipt-001",
        requestId: "assist-request-001",
        sessionId,
        findingId: "finding-assist-001",
        status: "completed",
        policyMode: "minimized_no_raw_phi",
        requestedAt: "2026-03-15T11:05:00Z",
        completedAt: "2026-03-15T11:05:01Z",
        latencyMs: 812,
        reviewerAction: "not_applied",
        assessment: {
          disposition: "expedited_human_review",
          confidence: 0.79,
          rationale: "Medication-risk packets go to the higher-acuity review lane.",
          limitations: ["Only minimized context was available."],
          provider: "doctor-auditor-assist-gateway",
          model: "policy-heuristic-v1",
          assessedAt: "2026-03-15T11:05:01Z",
        },
      },
    });

    expect(bundle?.modelAssistReceipts).toHaveLength(1);
    expect(bundle?.session.exportStatus).toBe("not_requested");
    expect(
      bundle?.auditLogEntries.some((entry) => entry.action === "assist_completed")
    ).toBe(true);

    db.close();
  });
});

function createDatabase(): LocalDatabase {
  const directory = mkdtempSync(
    path.join(tmpdir(), "doctor-auditor-database-test-")
  );
  cleanupPaths.push(directory);
  return new LocalDatabase(path.join(directory, "doctor-auditor.sqlite"));
}
