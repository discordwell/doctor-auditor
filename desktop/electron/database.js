"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalDatabase = void 0;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const uuid_1 = require("uuid");
const DESKTOP_ACTOR_ID = "desktop";
class LocalDatabase {
    db;
    constructor(dbPath) {
        this.db = new better_sqlite3_1.default(dbPath);
        this.db.pragma("journal_mode = WAL");
        this.db.pragma("foreign_keys = ON");
        this.initializeSchema();
    }
    createImportedSession(input) {
        const sessionSummary = this.createSessionShell({
            captureMode: "audio_import",
            clinicianId: input.clinicianId,
            recordedWithConsent: input.recordedWithConsent,
            exportAllowed: input.exportAllowed,
            remoteAssistAllowed: input.remoteAssistAllowed,
            policyVersion: input.policyVersion,
            encounterStartedAt: input.capturedAt,
            encounterEndedAt: input.capturedAt,
            audioPath: input.audioPath,
        });
        this.addAuditLog({
            sessionId: sessionSummary.session.id,
            action: "audio_imported",
            actorId: DESKTOP_ACTOR_ID,
            details: {
                fileName: input.sourceFileName,
                audioPath: input.audioPath,
            },
        });
        return sessionSummary;
    }
    createLiveCaptureSession(input) {
        return this.createSessionShell({
            captureMode: "live_capture",
            clinicianId: input.clinicianId,
            recordedWithConsent: input.recordedWithConsent,
            exportAllowed: input.exportAllowed,
            remoteAssistAllowed: input.remoteAssistAllowed,
            policyVersion: input.policyVersion,
            encounterStartedAt: input.startedAt,
            audioPath: input.audioPath,
        });
    }
    finalizeLiveCaptureSession(sessionId, input) {
        return this.updateSession(sessionId, {
            encounterEndedAt: input.endedAt,
            audioPath: input.audioPath,
        });
    }
    failLiveCaptureSession(sessionId, failedAt) {
        return this.updateSession(sessionId, {
            transcriptStatus: "failed",
            reviewStatus: "not_started",
            encounterEndedAt: failedAt,
        });
    }
    updateSession(sessionId, updates) {
        const currentSummary = this.getSessionSummary(sessionId);
        if (!currentSummary) {
            return null;
        }
        const nextSession = {
            ...currentSummary.session,
            transcriptStatus: updates.transcriptStatus ?? currentSummary.session.transcriptStatus,
            reviewStatus: updates.reviewStatus ?? currentSummary.session.reviewStatus,
            exportStatus: updates.exportStatus ?? currentSummary.session.exportStatus,
            encounterEndedAt: updates.encounterEndedAt ?? currentSummary.session.encounterEndedAt,
            updatedAt: new Date().toISOString(),
        };
        const nextAudioPath = updates.audioPath ?? currentSummary.audioPath;
        this.db
            .prepare(`UPDATE sessions
         SET clinician_id = ?,
             organization_id = ?,
             encounter_started_at = ?,
             encounter_ended_at = ?,
             capture_mode = ?,
             transcript_status = ?,
             review_status = ?,
             export_status = ?,
             updated_at = ?,
             consent_recorded = ?,
             consent_export_allowed = ?,
             consent_remote_assist_allowed = ?,
             consent_policy_version = ?,
             consent_captured_at = ?,
             consent_captured_by = ?,
             audio_path = ?
         WHERE id = ?`)
            .run(nextSession.clinicianId, nextSession.organizationId ?? null, nextSession.encounterStartedAt, nextSession.encounterEndedAt ?? null, nextSession.captureMode, nextSession.transcriptStatus, nextSession.reviewStatus, nextSession.exportStatus, nextSession.updatedAt, nextSession.consent.recordedWithConsent ? 1 : 0, nextSession.consent.exportAllowed ? 1 : 0, nextSession.consent.remoteAssistAllowed ? 1 : 0, nextSession.consent.policyVersion, nextSession.consent.capturedAt ?? null, nextSession.consent.capturedBy ?? null, nextAudioPath ?? null, sessionId);
        return this.getSessionSummary(sessionId);
    }
    replaceTranscriptSegments(sessionId, segments) {
        this.db
            .prepare("DELETE FROM transcript_segments WHERE session_id = ?")
            .run(sessionId);
        for (const segment of segments) {
            this.addTranscriptSegment(segment);
        }
    }
    addTranscriptSegment(segment) {
        this.db
            .prepare(`INSERT INTO transcript_segments (
          id,
          session_id,
          speaker_label,
          text,
          start_offset_ms,
          end_offset_ms,
          transcript_confidence,
          speaker_confidence,
          source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(segment.id, segment.sessionId, segment.speakerLabel, segment.text, segment.startOffsetMs, segment.endOffsetMs, segment.transcriptConfidence ?? null, segment.speakerConfidence ?? null, segment.source);
    }
    replaceFindings(sessionId, findings) {
        this.db.prepare("DELETE FROM approved_exports WHERE session_id = ?").run(sessionId);
        this.db.prepare("DELETE FROM review_decisions WHERE session_id = ?").run(sessionId);
        this.db.prepare("DELETE FROM findings WHERE session_id = ?").run(sessionId);
        for (const finding of findings) {
            this.addFinding(finding);
        }
        this.updateSession(sessionId, {
            exportStatus: "not_requested",
        });
        this.syncSessionReviewStatus(sessionId);
    }
    saveReviewDecision(input) {
        const findingRow = this.db
            .prepare(`SELECT *
         FROM findings
         WHERE id = ? AND session_id = ?`)
            .get(input.findingId, input.sessionId);
        if (!findingRow) {
            return null;
        }
        const finding = this.mapFinding(findingRow);
        const reviewedAt = new Date().toISOString();
        const existingDecisionId = normalizeString(findingRow.review_decision_id) ??
            this.db
                .prepare(`SELECT id
             FROM review_decisions
             WHERE finding_id = ? AND session_id = ?`)
                .get(input.findingId, input.sessionId)?.id;
        const decisionId = typeof existingDecisionId === "string" ? existingDecisionId : (0, uuid_1.v4)();
        const approvedEvidenceSpans = input.approvedEvidenceSpans ?? finding.evidenceSpans;
        this.db
            .prepare(`INSERT OR REPLACE INTO review_decisions (
          id,
          session_id,
          finding_id,
          outcome,
          reviewed_by,
          reviewed_at,
          rationale,
          edited_title,
          edited_summary,
          approved_evidence_spans
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(decisionId, input.sessionId, input.findingId, input.outcome, input.reviewedBy ?? DESKTOP_ACTOR_ID, reviewedAt, input.rationale ?? null, input.editedTitle ?? null, input.editedSummary ?? null, JSON.stringify(approvedEvidenceSpans));
        this.db
            .prepare(`UPDATE findings
         SET status = ?,
             review_decision_id = ?,
             updated_at = ?
         WHERE id = ? AND session_id = ?`)
            .run(reviewStatusFromOutcome(input.outcome), decisionId, reviewedAt, input.findingId, input.sessionId);
        this.syncSessionReviewStatus(input.sessionId);
        this.addAuditLog({
            sessionId: input.sessionId,
            action: "finding_reviewed",
            actorId: input.reviewedBy ?? DESKTOP_ACTOR_ID,
            details: {
                findingId: input.findingId,
                outcome: input.outcome,
            },
            timestamp: reviewedAt,
        });
        return this.getSession(input.sessionId);
    }
    saveApprovedExport(approvedExport) {
        this.db
            .prepare(`INSERT OR REPLACE INTO approved_exports (
          id,
          session_id,
          status,
          summary,
          findings_payload,
          approved_by,
          approved_at,
          destination,
          sent_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(approvedExport.id, approvedExport.sessionId, approvedExport.status, approvedExport.summary, JSON.stringify(approvedExport.findings), approvedExport.approvedBy, approvedExport.approvedAt, approvedExport.destination ?? null, approvedExport.sentAt ?? null);
        const sessionSummary = this.updateSession(approvedExport.sessionId, {
            exportStatus: approvedExport.status,
        });
        this.addAuditLog({
            sessionId: approvedExport.sessionId,
            action: approvedExport.status === "sent" ? "export_sent" : "export_approved",
            actorId: approvedExport.approvedBy,
            details: {
                exportId: approvedExport.id,
                status: approvedExport.status,
                destination: approvedExport.destination,
            },
            timestamp: approvedExport.approvedAt,
        });
        if (sessionSummary) {
            return this.getSession(approvedExport.sessionId);
        }
        return null;
    }
    recordModelAssistRequested(request) {
        this.addAuditLog({
            sessionId: request.sessionId,
            action: "assist_requested",
            actorId: request.requestedBy,
            details: {
                requestId: request.id,
                findingId: request.findingId,
                policyMode: request.policyMode,
            },
            timestamp: request.requestedAt,
        });
    }
    saveModelAssistReceipt(input) {
        this.db
            .prepare(`INSERT OR REPLACE INTO model_assist_receipts (
          id,
          request_id,
          session_id,
          finding_id,
          status,
          policy_mode,
          requested_at,
          completed_at,
          latency_ms,
          error_code,
          reviewer_action,
          provider,
          model_name,
          request_payload,
          assessment_payload
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(input.receipt.id, input.request.id, input.request.sessionId, input.request.findingId ?? null, input.receipt.status, input.receipt.policyMode, input.receipt.requestedAt, input.receipt.completedAt ?? null, input.receipt.latencyMs ?? null, input.receipt.errorCode ?? null, input.receipt.reviewerAction ?? null, input.receipt.assessment?.provider ?? null, input.receipt.assessment?.model ?? null, JSON.stringify(input.request), JSON.stringify(input.receipt.assessment ?? null));
        this.addAuditLog({
            sessionId: input.request.sessionId,
            action: input.receipt.status === "completed" ? "assist_completed" : "assist_failed",
            actorId: input.request.requestedBy,
            details: {
                receiptId: input.receipt.id,
                findingId: input.request.findingId,
                disposition: input.receipt.assessment?.disposition,
                errorCode: input.receipt.errorCode,
            },
            timestamp: input.receipt.completedAt ?? input.receipt.requestedAt,
        });
        return this.getSession(input.request.sessionId);
    }
    updateModelAssistReviewerAction(input) {
        this.db
            .prepare(`UPDATE model_assist_receipts
         SET reviewer_action = ?
         WHERE id = ? AND session_id = ?`)
            .run(input.reviewerAction, input.receiptId, input.sessionId);
        if (input.reviewerAction === "dismissed") {
            this.addAuditLog({
                sessionId: input.sessionId,
                action: "assist_overridden",
                actorId: DESKTOP_ACTOR_ID,
                details: {
                    receiptId: input.receiptId,
                    reviewerAction: input.reviewerAction,
                },
            });
        }
        return this.getSession(input.sessionId);
    }
    getSession(sessionId) {
        const sessionRow = this.db
            .prepare("SELECT * FROM sessions WHERE id = ?")
            .get(sessionId);
        if (!sessionRow) {
            return null;
        }
        const transcriptRows = this.db
            .prepare(`SELECT * FROM transcript_segments
         WHERE session_id = ?
         ORDER BY COALESCE(start_offset_ms, 0), id`)
            .all(sessionId);
        const auditRows = this.db
            .prepare("SELECT * FROM audit_log WHERE session_id = ? ORDER BY timestamp ASC")
            .all(sessionId);
        const findingRows = this.db
            .prepare(`SELECT *
         FROM findings
         WHERE session_id = ?
         ORDER BY created_at ASC, id ASC`)
            .all(sessionId);
        const reviewDecisionRows = this.db
            .prepare(`SELECT *
         FROM review_decisions
         WHERE session_id = ?
         ORDER BY reviewed_at ASC, id ASC`)
            .all(sessionId);
        const approvedExportRows = this.db
            .prepare(`SELECT *
         FROM approved_exports
         WHERE session_id = ?
         ORDER BY approved_at ASC, id ASC`)
            .all(sessionId);
        const modelAssistRows = this.db
            .prepare(`SELECT *
         FROM model_assist_receipts
         WHERE session_id = ?
         ORDER BY requested_at ASC, id ASC`)
            .all(sessionId);
        return {
            session: this.mapSession(sessionRow),
            transcriptSegments: transcriptRows.map((row) => this.mapTranscriptSegment(row)),
            findings: findingRows.map((row) => this.mapFinding(row)),
            reviewDecisions: reviewDecisionRows.map((row) => this.mapReviewDecision(row)),
            approvedExports: approvedExportRows.map((row) => this.mapApprovedExport(row)),
            auditLogEntries: auditRows.map((row) => this.mapAuditLogEntry(row)),
            modelAssistReceipts: modelAssistRows.map((row) => this.mapModelAssistReceipt(row)),
            audioPath: normalizeString(sessionRow.audio_path),
        };
    }
    getSessionSummary(sessionId) {
        const row = this.db
            .prepare(`SELECT s.*, COUNT(ts.id) AS transcript_segment_count
         FROM sessions s
         LEFT JOIN transcript_segments ts ON ts.session_id = s.id
         WHERE s.id = ?
         GROUP BY s.id`)
            .get(sessionId);
        if (!row) {
            return null;
        }
        return {
            session: this.mapSession(row),
            audioPath: normalizeString(row.audio_path),
            transcriptSegmentCount: normalizeNumber(row.transcript_segment_count) ?? 0,
        };
    }
    getAllSessions() {
        const rows = this.db
            .prepare(`SELECT s.*, COUNT(ts.id) AS transcript_segment_count
         FROM sessions s
         LEFT JOIN transcript_segments ts ON ts.session_id = s.id
         GROUP BY s.id
         ORDER BY s.created_at DESC`)
            .all();
        return rows.map((row) => ({
            session: this.mapSession(row),
            audioPath: normalizeString(row.audio_path),
            transcriptSegmentCount: normalizeNumber(row.transcript_segment_count) ?? 0,
        }));
    }
    close() {
        this.db.close();
    }
    createSessionShell(input) {
        const now = new Date().toISOString();
        const session = {
            id: (0, uuid_1.v4)(),
            clinicianId: input.clinicianId,
            encounterStartedAt: input.encounterStartedAt,
            encounterEndedAt: input.encounterEndedAt,
            captureMode: input.captureMode,
            transcriptStatus: "not_started",
            reviewStatus: "not_started",
            exportStatus: "not_requested",
            createdAt: now,
            updatedAt: now,
            consent: {
                recordedWithConsent: input.recordedWithConsent,
                exportAllowed: input.exportAllowed,
                remoteAssistAllowed: input.remoteAssistAllowed,
                policyVersion: input.policyVersion,
                capturedAt: now,
                capturedBy: DESKTOP_ACTOR_ID,
            },
        };
        this.db
            .prepare(`INSERT INTO sessions (
          id,
          clinician_id,
          organization_id,
          encounter_started_at,
          encounter_ended_at,
          capture_mode,
          transcript_status,
          review_status,
          export_status,
          created_at,
          updated_at,
          consent_recorded,
          consent_export_allowed,
          consent_remote_assist_allowed,
          consent_policy_version,
          consent_captured_at,
          consent_captured_by,
          audio_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(session.id, session.clinicianId, session.organizationId ?? null, session.encounterStartedAt, session.encounterEndedAt ?? null, session.captureMode, session.transcriptStatus, session.reviewStatus, session.exportStatus, session.createdAt, session.updatedAt, session.consent.recordedWithConsent ? 1 : 0, session.consent.exportAllowed ? 1 : 0, session.consent.remoteAssistAllowed ? 1 : 0, session.consent.policyVersion, session.consent.capturedAt ?? null, session.consent.capturedBy ?? null, input.audioPath ?? null);
        this.addAuditLog({
            sessionId: session.id,
            action: "session_created",
            actorId: DESKTOP_ACTOR_ID,
            details: {
                captureMode: session.captureMode,
                transcriptStatus: session.transcriptStatus,
                reviewStatus: session.reviewStatus,
            },
        });
        return {
            session,
            audioPath: input.audioPath,
            transcriptSegmentCount: 0,
        };
    }
    initializeSchema() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        clinician_id TEXT,
        organization_id TEXT,
        encounter_started_at TEXT,
        encounter_ended_at TEXT,
        capture_mode TEXT,
        transcript_status TEXT,
        review_status TEXT,
        export_status TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        consent_recorded INTEGER DEFAULT 0,
        consent_export_allowed INTEGER DEFAULT 0,
        consent_remote_assist_allowed INTEGER DEFAULT 0,
        consent_policy_version TEXT DEFAULT 'local-only-v1',
        consent_captured_at TEXT,
        consent_captured_by TEXT,
        audio_path TEXT
      );

      CREATE TABLE IF NOT EXISTS transcript_segments (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        speaker_label TEXT,
        text TEXT NOT NULL,
        start_offset_ms INTEGER,
        end_offset_ms INTEGER,
        transcript_confidence REAL,
        speaker_confidence REAL,
        source TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE TABLE IF NOT EXISTS findings (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        code TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL,
        confidence REAL NOT NULL,
        evidence_spans TEXT NOT NULL DEFAULT '[]',
        detected_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        review_decision_id TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE TABLE IF NOT EXISTS review_decisions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        finding_id TEXT NOT NULL UNIQUE,
        outcome TEXT NOT NULL,
        reviewed_by TEXT NOT NULL,
        reviewed_at TEXT NOT NULL,
        rationale TEXT,
        edited_title TEXT,
        edited_summary TEXT,
        approved_evidence_spans TEXT NOT NULL DEFAULT '[]',
        FOREIGN KEY (session_id) REFERENCES sessions(id),
        FOREIGN KEY (finding_id) REFERENCES findings(id)
      );

      CREATE TABLE IF NOT EXISTS approved_exports (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT NOT NULL,
        findings_payload TEXT NOT NULL DEFAULT '[]',
        approved_by TEXT NOT NULL,
        approved_at TEXT NOT NULL,
        destination TEXT,
        sent_at TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE TABLE IF NOT EXISTS model_assist_receipts (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        finding_id TEXT,
        status TEXT NOT NULL,
        policy_mode TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        completed_at TEXT,
        latency_ms INTEGER,
        error_code TEXT,
        reviewer_action TEXT,
        provider TEXT,
        model_name TEXT,
        request_payload TEXT NOT NULL,
        assessment_payload TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        action TEXT NOT NULL,
        actor_id TEXT,
        details TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_segments_session ON transcript_segments(session_id);
      CREATE INDEX IF NOT EXISTS idx_findings_session ON findings(session_id);
      CREATE INDEX IF NOT EXISTS idx_findings_status ON findings(status);
      CREATE INDEX IF NOT EXISTS idx_review_decisions_session ON review_decisions(session_id);
      CREATE INDEX IF NOT EXISTS idx_review_decisions_finding ON review_decisions(finding_id);
      CREATE INDEX IF NOT EXISTS idx_exports_session ON approved_exports(session_id);
      CREATE INDEX IF NOT EXISTS idx_assist_receipts_session ON model_assist_receipts(session_id);
      CREATE INDEX IF NOT EXISTS idx_assist_receipts_finding ON model_assist_receipts(finding_id);
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_log(session_id);
    `);
        this.ensureColumn("sessions", "clinician_id", "TEXT");
        this.ensureColumn("sessions", "organization_id", "TEXT");
        this.ensureColumn("sessions", "encounter_started_at", "TEXT");
        this.ensureColumn("sessions", "encounter_ended_at", "TEXT");
        this.ensureColumn("sessions", "capture_mode", "TEXT");
        this.ensureColumn("sessions", "transcript_status", "TEXT");
        this.ensureColumn("sessions", "review_status", "TEXT");
        this.ensureColumn("sessions", "export_status", "TEXT");
        this.ensureColumn("sessions", "updated_at", "TEXT");
        this.ensureColumn("sessions", "consent_recorded", "INTEGER DEFAULT 0");
        this.ensureColumn("sessions", "consent_export_allowed", "INTEGER DEFAULT 0");
        this.ensureColumn("sessions", "consent_remote_assist_allowed", "INTEGER DEFAULT 0");
        this.ensureColumn("sessions", "consent_policy_version", "TEXT DEFAULT 'local-only-v1'");
        this.ensureColumn("sessions", "consent_captured_at", "TEXT");
        this.ensureColumn("sessions", "consent_captured_by", "TEXT");
        this.ensureColumn("sessions", "audio_path", "TEXT");
        this.ensureColumn("transcript_segments", "speaker_label", "TEXT");
        this.ensureColumn("transcript_segments", "start_offset_ms", "INTEGER");
        this.ensureColumn("transcript_segments", "end_offset_ms", "INTEGER");
        this.ensureColumn("transcript_segments", "transcript_confidence", "REAL");
        this.ensureColumn("transcript_segments", "speaker_confidence", "REAL");
        this.ensureColumn("transcript_segments", "source", "TEXT");
        this.ensureColumn("findings", "evidence_spans", "TEXT NOT NULL DEFAULT '[]'");
        this.ensureColumn("findings", "detected_by", "TEXT");
        this.ensureColumn("findings", "review_decision_id", "TEXT");
        this.ensureColumn("review_decisions", "approved_evidence_spans", "TEXT NOT NULL DEFAULT '[]'");
        this.ensureColumn("approved_exports", "findings_payload", "TEXT NOT NULL DEFAULT '[]'");
        this.ensureColumn("model_assist_receipts", "request_payload", "TEXT NOT NULL DEFAULT '{}'");
        this.ensureColumn("model_assist_receipts", "assessment_payload", "TEXT");
        this.ensureColumn("model_assist_receipts", "provider", "TEXT");
        this.ensureColumn("model_assist_receipts", "model_name", "TEXT");
        this.ensureColumn("model_assist_receipts", "reviewer_action", "TEXT");
        this.ensureColumn("audit_log", "session_id", "TEXT");
        this.ensureColumn("audit_log", "actor_id", "TEXT");
    }
    addAuditLog(entry) {
        this.db
            .prepare(`INSERT INTO audit_log (id, session_id, timestamp, action, actor_id, details)
         VALUES (?, ?, ?, ?, ?, ?)`)
            .run((0, uuid_1.v4)(), entry.sessionId, entry.timestamp ?? new Date().toISOString(), entry.action, entry.actorId ?? null, JSON.stringify(entry.details));
    }
    addFinding(finding) {
        this.db
            .prepare(`INSERT INTO findings (
          id,
          session_id,
          code,
          title,
          summary,
          status,
          confidence,
          evidence_spans,
          detected_by,
          created_at,
          updated_at,
          review_decision_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(finding.id, finding.sessionId, finding.code, finding.title, finding.summary, finding.status, finding.confidence, JSON.stringify(finding.evidenceSpans), finding.detectedBy, finding.createdAt, finding.updatedAt, finding.reviewDecisionId ?? null);
    }
    mapFinding(row) {
        return {
            id: String(row.id),
            sessionId: String(row.session_id),
            code: normalizeString(row.code) ?? "unknown-finding",
            title: normalizeString(row.title) ?? "Untitled finding",
            summary: normalizeString(row.summary) ?? "",
            status: coerceFindingStatus(normalizeString(row.status), "draft"),
            confidence: normalizeNumber(row.confidence) ?? 0,
            evidenceSpans: parseJsonArray(row.evidence_spans),
            detectedBy: coerceFindingSource(normalizeString(row.detected_by), "rules"),
            createdAt: normalizeString(row.created_at) ?? new Date().toISOString(),
            updatedAt: normalizeString(row.updated_at) ??
                normalizeString(row.created_at) ??
                new Date().toISOString(),
            reviewDecisionId: normalizeString(row.review_decision_id),
        };
    }
    mapReviewDecision(row) {
        return {
            id: String(row.id),
            sessionId: String(row.session_id),
            findingId: String(row.finding_id),
            outcome: coerceReviewDecisionOutcome(normalizeString(row.outcome), "uncertain"),
            reviewedBy: normalizeString(row.reviewed_by) ?? DESKTOP_ACTOR_ID,
            reviewedAt: normalizeString(row.reviewed_at) ?? new Date().toISOString(),
            rationale: normalizeString(row.rationale),
            editedTitle: normalizeString(row.edited_title),
            editedSummary: normalizeString(row.edited_summary),
            approvedEvidenceSpans: parseJsonArray(row.approved_evidence_spans),
        };
    }
    mapApprovedExport(row) {
        return {
            id: String(row.id),
            sessionId: String(row.session_id),
            status: coerceApprovedExportStatus(normalizeString(row.status), "draft"),
            summary: normalizeString(row.summary) ?? "",
            findings: parseJsonArray(row.findings_payload),
            approvedBy: normalizeString(row.approved_by) ?? DESKTOP_ACTOR_ID,
            approvedAt: normalizeString(row.approved_at) ?? new Date().toISOString(),
            destination: normalizeString(row.destination),
            sentAt: normalizeString(row.sent_at),
        };
    }
    mapModelAssistReceipt(row) {
        return {
            id: String(row.id),
            requestId: String(row.request_id),
            sessionId: String(row.session_id),
            findingId: normalizeString(row.finding_id),
            status: normalizeString(row.status) === "failed" ? "failed" : "completed",
            policyMode: "minimized_no_raw_phi",
            requestedAt: normalizeString(row.requested_at) ?? new Date().toISOString(),
            completedAt: normalizeString(row.completed_at),
            latencyMs: normalizeNumber(row.latency_ms) ?? undefined,
            errorCode: normalizeString(row.error_code) ?? undefined,
            reviewerAction: coerceModelAssistReviewerAction(normalizeString(row.reviewer_action)),
            assessment: parseJsonValue(row.assessment_payload),
        };
    }
    syncSessionReviewStatus(sessionId) {
        const sessionSummary = this.getSessionSummary(sessionId);
        if (!sessionSummary) {
            return;
        }
        const counts = this.db
            .prepare(`SELECT
            COUNT(*) AS total_findings,
            SUM(CASE WHEN status IN ('draft', 'pending_review') THEN 1 ELSE 0 END) AS pending_findings
         FROM findings
         WHERE session_id = ?`)
            .get(sessionId);
        const totalFindings = normalizeNumber(counts.total_findings) ?? 0;
        const pendingFindings = normalizeNumber(counts.pending_findings) ?? 0;
        const reviewedFindings = totalFindings - pendingFindings;
        let nextReviewStatus = sessionSummary.session.reviewStatus;
        if (totalFindings > 0) {
            if (reviewedFindings === 0) {
                nextReviewStatus = "ready";
            }
            else if (pendingFindings > 0) {
                nextReviewStatus = "in_review";
            }
            else {
                nextReviewStatus = "completed";
            }
        }
        if (totalFindings > 0 ||
            nextReviewStatus !== sessionSummary.session.reviewStatus) {
            this.updateSession(sessionId, {
                reviewStatus: nextReviewStatus,
            });
        }
    }
    mapSession(row) {
        const createdAt = normalizeString(row.created_at) ?? new Date().toISOString();
        const updatedAt = normalizeString(row.updated_at) ?? createdAt;
        const encounterStartedAt = normalizeString(row.encounter_started_at) ??
            normalizeString(row.start_time) ??
            createdAt;
        const encounterEndedAt = normalizeString(row.encounter_ended_at) ?? normalizeString(row.end_time);
        const audioPath = normalizeString(row.audio_path);
        return {
            id: String(row.id),
            clinicianId: normalizeString(row.clinician_id) ??
                normalizeString(row.doctor_id) ??
                "unassigned-clinician",
            organizationId: normalizeString(row.organization_id),
            encounterStartedAt,
            encounterEndedAt,
            captureMode: coerceCaptureMode(normalizeString(row.capture_mode), audioPath ? "audio_import" : "live_capture"),
            transcriptStatus: coerceTranscriptStatus(normalizeString(row.transcript_status), "not_started"),
            reviewStatus: coerceReviewStatus(normalizeString(row.review_status), "not_started"),
            exportStatus: coerceExportStatus(normalizeString(row.export_status), "not_requested"),
            createdAt,
            updatedAt,
            consent: {
                recordedWithConsent: normalizeBoolean(row.consent_recorded),
                exportAllowed: normalizeBoolean(row.consent_export_allowed),
                remoteAssistAllowed: normalizeBoolean(row.consent_remote_assist_allowed),
                policyVersion: normalizeString(row.consent_policy_version) ?? "local-only-v1",
                capturedAt: normalizeString(row.consent_captured_at),
                capturedBy: normalizeString(row.consent_captured_by),
            },
        };
    }
    mapTranscriptSegment(row) {
        const startOffsetMs = normalizeNumber(row.start_offset_ms) ??
            Math.round((normalizeNumber(row.start_time) ?? 0) * 1000);
        const endOffsetMs = normalizeNumber(row.end_offset_ms) ??
            Math.round((normalizeNumber(row.end_time) ?? 0) * 1000);
        return {
            id: String(row.id),
            sessionId: String(row.session_id),
            speakerLabel: coerceSpeakerLabel(normalizeString(row.speaker_label) ?? normalizeString(row.speaker), "unknown"),
            text: normalizeString(row.text) ?? "",
            startOffsetMs,
            endOffsetMs,
            transcriptConfidence: normalizeNumber(row.transcript_confidence) ??
                normalizeNumber(row.confidence),
            speakerConfidence: normalizeNumber(row.speaker_confidence),
            source: coerceTranscriptSource(normalizeString(row.source), "live_capture"),
        };
    }
    mapAuditLogEntry(row) {
        return {
            id: String(row.id),
            sessionId: normalizeString(row.session_id) ?? "",
            timestamp: normalizeString(row.timestamp) ?? new Date().toISOString(),
            action: coerceAuditAction(normalizeString(row.action), "session_created"),
            actorId: normalizeString(row.actor_id),
            details: parseJsonObject(row.details),
        };
    }
    ensureColumn(tableName, columnName, definition) {
        const columns = this.db
            .prepare(`PRAGMA table_info(${tableName})`)
            .all();
        if (columns.some((column) => column.name === columnName)) {
            return;
        }
        this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
}
exports.LocalDatabase = LocalDatabase;
function normalizeString(value) {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
function normalizeBoolean(value) {
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "number") {
        return value !== 0;
    }
    if (typeof value === "string") {
        return value === "1" || value.toLowerCase() === "true";
    }
    return false;
}
function normalizeNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}
function parseJsonObject(value) {
    if (typeof value !== "string") {
        return {};
    }
    try {
        const parsed = JSON.parse(value);
        return typeof parsed === "object" && parsed !== null
            ? parsed
            : {};
    }
    catch {
        return {};
    }
}
function parseJsonArray(value) {
    if (typeof value !== "string") {
        return [];
    }
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
}
function parseJsonValue(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    try {
        const parsed = JSON.parse(value);
        return parsed === null ? undefined : parsed;
    }
    catch {
        return undefined;
    }
}
function coerceCaptureMode(value, fallback) {
    return value === "audio_import" ||
        value === "live_capture" ||
        value === "manual_entry"
        ? value
        : fallback;
}
function coerceTranscriptStatus(value, fallback) {
    return value === "not_started" ||
        value === "in_progress" ||
        value === "completed" ||
        value === "failed"
        ? value
        : fallback;
}
function coerceReviewStatus(value, fallback) {
    return value === "not_started" ||
        value === "ready" ||
        value === "in_review" ||
        value === "completed"
        ? value
        : fallback;
}
function coerceExportStatus(value, fallback) {
    return value === "not_requested" ||
        value === "draft" ||
        value === "approved" ||
        value === "sent"
        ? value
        : fallback;
}
function coerceApprovedExportStatus(value, fallback) {
    return value === "draft" || value === "approved" || value === "sent"
        ? value
        : fallback;
}
function coerceFindingStatus(value, fallback) {
    return value === "draft" ||
        value === "pending_review" ||
        value === "accepted" ||
        value === "rejected" ||
        value === "uncertain" ||
        value === "revised"
        ? value
        : fallback;
}
function coerceFindingSource(value, fallback) {
    return value === "rules" ||
        value === "local_llm" ||
        value === "cloud_llm" ||
        value === "human"
        ? value
        : fallback;
}
function coerceReviewDecisionOutcome(value, fallback) {
    return value === "accepted" ||
        value === "rejected" ||
        value === "uncertain" ||
        value === "edited"
        ? value
        : fallback;
}
function reviewStatusFromOutcome(outcome) {
    switch (outcome) {
        case "accepted":
            return "accepted";
        case "rejected":
            return "rejected";
        case "edited":
            return "revised";
        case "uncertain":
        default:
            return "uncertain";
    }
}
function coerceSpeakerLabel(value, fallback) {
    return value === "clinician" ||
        value === "patient" ||
        value === "caregiver" ||
        value === "staff" ||
        value === "speaker_a" ||
        value === "speaker_b" ||
        value === "unknown"
        ? value
        : value === "doctor"
            ? "clinician"
            : fallback;
}
function coerceTranscriptSource(value, fallback) {
    return value === "audio_import" ||
        value === "live_capture" ||
        value === "manual_edit"
        ? value
        : fallback;
}
function coerceAuditAction(value, fallback) {
    return value === "session_created" ||
        value === "audio_imported" ||
        value === "transcript_viewed" ||
        value === "finding_reviewed" ||
        value === "assist_requested" ||
        value === "assist_completed" ||
        value === "assist_failed" ||
        value === "assist_overridden" ||
        value === "redaction_blocked" ||
        value === "export_approved" ||
        value === "export_sent"
        ? value
        : fallback;
}
function coerceModelAssistReviewerAction(value) {
    return value === "accepted" ||
        value === "dismissed" ||
        value === "not_applied"
        ? value
        : undefined;
}
