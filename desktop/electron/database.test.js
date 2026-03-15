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
    while (cleanupPaths.length > 0) {
        const target = cleanupPaths.pop();
        if (target) {
            (0, node_fs_1.rmSync)(target, { recursive: true, force: true });
        }
    }
});
(0, vitest_1.describe)("LocalDatabase review artifacts", () => {
    (0, vitest_1.it)("persists findings, review decisions, and approved exports locally", () => {
        const db = createDatabase();
        const capturedAt = "2026-03-15T10:00:00Z";
        const session = db.createImportedSession({
            clinicianId: "clinician-42",
            recordedWithConsent: true,
            exportAllowed: true,
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
});
function createDatabase() {
    const directory = (0, node_fs_1.mkdtempSync)(node_path_1.default.join((0, node_os_1.tmpdir)(), "doctor-auditor-database-test-"));
    cleanupPaths.push(directory);
    return new database_1.LocalDatabase(node_path_1.default.join(directory, "doctor-auditor.sqlite"));
}
