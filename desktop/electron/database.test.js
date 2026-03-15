"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = __importDefault(require("node:path"));
const vitest_1 = require("vitest");
const database_1 = require("./database");
const cleanupPaths = [];
(0, vitest_1.afterEach)(() => {
    vitest_1.vi.useRealTimers();
    while (cleanupPaths.length > 0) {
        const target = cleanupPaths.pop();
        if (target) {
            (0, node_fs_1.rmSync)(target, { recursive: true, force: true });
        }
    }
});
(0, vitest_1.describe)("LocalDatabase review artifacts", () => {
    (0, vitest_1.it)("keeps review and export gated until findings are persisted", () => {
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
        (0, vitest_1.expect)(withoutFindings?.session.reviewStatus).toBe("not_started");
        (0, vitest_1.expect)(withoutFindings?.session.exportStatus).toBe("not_requested");
        (0, vitest_1.expect)(withoutFindings?.findings).toEqual([]);
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
                        excerpt: "Please schedule the procedure and let us know if the dizziness returns.",
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
        (0, vitest_1.expect)(withFindings?.session.reviewStatus).toBe("ready");
        (0, vitest_1.expect)(withFindings?.findings).toHaveLength(1);
        db.close();
    });
    (0, vitest_1.it)("clears the stored audio path when live capture fails", () => {
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
        const failed = db.failLiveCaptureSession(startedSession.session.id, "2026-03-15T09:32:00Z");
        (0, vitest_1.expect)(failed?.audioPath).toBeUndefined();
        (0, vitest_1.expect)(failed?.session.transcriptStatus).toBe("failed");
        (0, vitest_1.expect)(failed?.session.reviewStatus).toBe("not_started");
        db.close();
    });
    (0, vitest_1.it)("persists findings, review decisions, and approved exports locally", () => {
        vitest_1.vi.useFakeTimers();
        vitest_1.vi.setSystemTime(new Date("2026-03-15T10:05:00Z"));
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
        (0, vitest_1.expect)(reviewedBundle).not.toBeNull();
        (0, vitest_1.expect)(reviewedBundle?.findings).toHaveLength(1);
        (0, vitest_1.expect)(reviewedBundle?.reviewDecisions).toHaveLength(1);
        (0, vitest_1.expect)(reviewedBundle?.approvedExports).toHaveLength(0);
        (0, vitest_1.expect)(reviewedBundle?.findings[0]?.status).toBe("accepted");
        (0, vitest_1.expect)(reviewedBundle?.session.reviewStatus).toBe("completed");
        (0, vitest_1.expect)(reviewedBundle?.auditLogEntries.at(-1)?.action).toBe("finding_reviewed");
        const decisionId = reviewedBundle?.reviewDecisions[0]?.id;
        (0, vitest_1.expect)(decisionId).toBeTruthy();
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
        (0, vitest_1.expect)(exportedBundle).not.toBeNull();
        (0, vitest_1.expect)(exportedBundle?.approvedExports).toHaveLength(1);
        (0, vitest_1.expect)(exportedBundle?.session.exportStatus).toBe("approved");
        (0, vitest_1.expect)(exportedBundle?.auditLogEntries.at(-1)?.action).toBe("export_approved");
        db.close();
    });
    (0, vitest_1.it)("persists local assist receipts without mutating export state", () => {
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
        const request = {
            id: "assist-request-001",
            sessionId,
            findingId: "finding-assist-001",
            requestedBy: "reviewer-2",
            requestedAt: "2026-03-15T11:05:00Z",
            policyVersion: "policy-v1",
            policyMode: "minimized_no_raw_phi",
            concern: {
                findingCode: "medication-risk",
                findingStatus: "pending_review",
                findingConfidence: 0.77,
                evidenceSpanCount: 1,
                speakerLabels: ["patient"],
                captureMode: "audio_import",
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
        (0, vitest_1.expect)(bundle?.modelAssistReceipts).toHaveLength(1);
        (0, vitest_1.expect)(bundle?.session.exportStatus).toBe("not_requested");
        (0, vitest_1.expect)(bundle?.auditLogEntries.some((entry) => entry.action === "assist_completed")).toBe(true);
        db.close();
    });
});
function createDatabase() {
    const directory = (0, node_fs_1.mkdtempSync)(node_path_1.default.join((0, node_os_1.tmpdir)(), "doctor-auditor-database-test-"));
    cleanupPaths.push(directory);
    return new database_1.LocalDatabase(node_path_1.default.join(directory, "doctor-auditor.sqlite"));
}
