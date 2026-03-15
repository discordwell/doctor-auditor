import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  ModelAssistReceipt,
  ModelAssistRequest,
} from "@doctor-auditor/shared/local-review";
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
  it("keeps review and export gated until findings are persisted", () => {
    const db = createDatabase();
    const session = db.createImportedSession({
      clinicianId: "clinician-11",
      recordedWithConsent: true,
      exportAllowed: true,
      remoteAssistAllowed: false,
      policyVersion: "policy-v1",
      audioPath: "/tmp/gated.wav",
      capturedAt: "2026-03-15T09:00:00Z",
      sourceFileName: "gated.wav",
    });
    const sessionId = session.session.id;

    db.replaceTranscriptSegments(sessionId, [
      {
        id: "segment-gated-001",
        sessionId,
        speakerLabel: "unknown",
        text: "Please schedule the procedure and let us know if the dizziness returns.",
        startOffsetMs: 0,
        endOffsetMs: 2800,
        source: "audio_import",
      },
    ]);

    const withoutFindings = db.getSession(sessionId);
    expect(withoutFindings?.session.reviewStatus).toBe("not_started");
    expect(withoutFindings?.session.exportStatus).toBe("not_requested");
    expect(withoutFindings?.findings).toEqual([]);

    db.replaceFindings(sessionId, [
      {
        id: "finding-gated-001",
        sessionId,
        code: "missing-risk-discussion",
        title: "Treatment risks were not discussed",
        summary: "The transcript references a procedure without risk language.",
        status: "pending_review",
        confidence: 0.68,
        evidenceSpans: [
          {
            id: "evidence-gated-001",
            transcriptSegmentId: "segment-gated-001",
            excerpt:
              "Please schedule the procedure and let us know if the dizziness returns.",
            startOffsetMs: 0,
            endOffsetMs: 2800,
          },
        ],
        detectedBy: "rules",
        createdAt: "2026-03-15T09:00:00Z",
        updatedAt: "2026-03-15T09:00:00Z",
      },
    ]);

    const withFindings = db.getSession(sessionId);
    expect(withFindings?.session.reviewStatus).toBe("ready");
    expect(withFindings?.findings).toHaveLength(1);

    db.close();
  });

  it("clears stale review artifacts before fresh local analysis findings land", () => {
    const db = createDatabase();
    const capturedAt = "2026-03-15T09:15:00Z";
    const session = db.createImportedSession({
      clinicianId: "clinician-reanalysis",
      recordedWithConsent: true,
      exportAllowed: true,
      remoteAssistAllowed: true,
      policyVersion: "policy-v1",
      audioPath: "/tmp/reanalysis.wav",
      capturedAt,
      sourceFileName: "reanalysis.wav",
    });
    const sessionId = session.session.id;

    db.replaceTranscriptSegments(sessionId, [
      {
        id: "segment-original-001",
        sessionId,
        speakerLabel: "unknown",
        text: "Please schedule the biopsy and call us if the dizziness worsens.",
        startOffsetMs: 0,
        endOffsetMs: 2400,
        source: "audio_import",
      },
    ]);

    db.replaceFindings(sessionId, [
      {
        id: "finding-original-001",
        sessionId,
        code: "missing-risk-discussion",
        title: "Treatment risks were not discussed",
        summary: "The original transcript referenced a biopsy without risk language.",
        status: "pending_review",
        confidence: 0.71,
        evidenceSpans: [
          {
            id: "evidence-original-001",
            transcriptSegmentId: "segment-original-001",
            excerpt:
              "Please schedule the biopsy and call us if the dizziness worsens.",
            startOffsetMs: 0,
            endOffsetMs: 2400,
          },
        ],
        detectedBy: "rules",
        createdAt: capturedAt,
        updatedAt: capturedAt,
      },
    ]);

    const reviewedBundle = db.saveReviewDecision({
      sessionId,
      findingId: "finding-original-001",
      outcome: "accepted",
      reviewedBy: "reviewer-2",
    });
    expect(reviewedBundle?.session.reviewStatus).toBe("completed");

    const decisionId = reviewedBundle?.reviewDecisions[0]?.id;
    expect(decisionId).toBeTruthy();

    db.saveApprovedExport({
      id: "export-original-001",
      sessionId,
      status: "approved",
      summary: "Approved export for the first local analysis pass.",
      findings: [
        {
          findingId: "finding-original-001",
          code: "missing-risk-discussion",
          title: "Treatment risks were not discussed",
          summary: "The original transcript referenced a biopsy without risk language.",
          reviewDecisionId: decisionId ?? "missing-decision",
          evidenceExcerpts: [
            {
              sourceEvidenceSpanId: "evidence-original-001",
              sourceTranscriptSegmentId: "segment-original-001",
              excerpt:
                "Please schedule the biopsy and call us if the dizziness worsens.",
              startOffsetMs: 0,
              endOffsetMs: 2400,
            },
          ],
        },
      ],
      approvedBy: "quality-lead-2",
      approvedAt: "2026-03-15T09:20:00Z",
      destination: "manual-review-hold",
    });

    const assistRequest: ModelAssistRequest = {
      id: "assist-request-reanalysis-001",
      sessionId,
      findingId: "finding-original-001",
      requestedBy: "reviewer-2",
      requestedAt: "2026-03-15T09:18:00Z",
      policyVersion: "policy-v1",
      policyMode: "minimized_no_raw_phi",
      concern: {
        findingCode: "missing-risk-discussion",
        findingStatus: "pending_review",
        findingConfidence: 0.71,
        evidenceSpanCount: 1,
        speakerLabels: ["unknown"],
        captureMode: "audio_import",
      },
    };
    const assistReceipt: ModelAssistReceipt = {
      id: "assist-receipt-reanalysis-001",
      requestId: assistRequest.id,
      sessionId,
      findingId: "finding-original-001",
      status: "completed",
      policyMode: assistRequest.policyMode,
      requestedAt: assistRequest.requestedAt,
      completedAt: "2026-03-15T09:18:01Z",
      latencyMs: 120,
      reviewerAction: "not_applied",
      assessment: {
        disposition: "routine_review",
        confidence: 0.73,
        rationale: "The original finding can stay in the normal review lane.",
        limitations: ["Local transcript was still being refreshed."],
        provider: "demo-provider",
        model: "demo-model",
        assessedAt: "2026-03-15T09:18:01Z",
      },
    };

    const assistedBundle = db.saveModelAssistReceipt({
      request: assistRequest,
      receipt: assistReceipt,
    });
    expect(assistedBundle?.modelAssistReceipts).toHaveLength(1);

    const resetSummary = db.resetLocalReviewArtifacts(sessionId);
    expect(resetSummary?.session.reviewStatus).toBe("not_started");
    expect(resetSummary?.session.exportStatus).toBe("not_requested");

    const queuedSummary = db.updateSession(sessionId, {
      transcriptStatus: "in_progress",
    });
    expect(queuedSummary?.session.transcriptStatus).toBe("in_progress");

    const clearedBundle = db.getSession(sessionId);
    expect(clearedBundle?.findings).toEqual([]);
    expect(clearedBundle?.reviewDecisions).toEqual([]);
    expect(clearedBundle?.approvedExports).toEqual([]);
    expect(clearedBundle?.modelAssistReceipts).toEqual([]);

    db.replaceTranscriptSegments(sessionId, [
      {
        id: "segment-reanalysis-001",
        sessionId,
        speakerLabel: "unknown",
        text: "Please schedule the biopsy. We reviewed the risks and call us if dizziness returns.",
        startOffsetMs: 0,
        endOffsetMs: 2600,
        source: "audio_import",
      },
    ]);

    const afterTranscript = db.getSession(sessionId);
    expect(afterTranscript?.transcriptSegments).toHaveLength(1);
    expect(afterTranscript?.transcriptSegments[0]?.id).toBe("segment-reanalysis-001");
    expect(afterTranscript?.findings).toEqual([]);
    expect(afterTranscript?.reviewDecisions).toEqual([]);
    expect(afterTranscript?.approvedExports).toEqual([]);
    expect(afterTranscript?.modelAssistReceipts).toEqual([]);

    db.replaceFindings(sessionId, [
      {
        id: "finding-reanalysis-001",
        sessionId,
        code: "medication-adherence",
        title: "Medication adherence needs review",
        summary: "The refreshed transcript now shows a refill delay instead of a risk discussion issue.",
        status: "pending_review",
        confidence: 0.78,
        evidenceSpans: [
          {
            id: "evidence-reanalysis-001",
            transcriptSegmentId: "segment-reanalysis-001",
            excerpt:
              "Please schedule the biopsy. We reviewed the risks and call us if dizziness returns.",
            startOffsetMs: 0,
            endOffsetMs: 2600,
          },
        ],
        detectedBy: "rules",
        createdAt: "2026-03-15T09:21:00Z",
        updatedAt: "2026-03-15T09:21:00Z",
      },
    ]);

    const refreshedBundle = db.getSession(sessionId);
    expect(refreshedBundle?.session.reviewStatus).toBe("ready");
    expect(refreshedBundle?.session.exportStatus).toBe("not_requested");
    expect(refreshedBundle?.findings).toHaveLength(1);
    expect(refreshedBundle?.findings[0]?.id).toBe("finding-reanalysis-001");

    db.close();
  });

  it("clears the stored audio path when live capture fails", () => {
    const db = createDatabase();
    const startedSession = db.createLiveCaptureSession({
      clinicianId: "clinician-live",
      recordedWithConsent: true,
      exportAllowed: false,
      remoteAssistAllowed: false,
      policyVersion: "policy-v1",
      startedAt: "2026-03-15T09:30:00Z",
      audioPath: "/tmp/live-capture.wav",
    });

    const failed = db.failLiveCaptureSession(
      startedSession.session.id,
      "2026-03-15T09:32:00Z"
    );

    expect(failed?.audioPath).toBeUndefined();
    expect(failed?.session.transcriptStatus).toBe("failed");
    expect(failed?.session.reviewStatus).toBe("not_started");

    db.close();
  });

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
