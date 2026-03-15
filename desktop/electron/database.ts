import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import type {
  AuditLogEntry,
  CaptureMode,
  EvidenceSpan,
  ExportStatus,
  Finding,
  FindingStatus,
  ModelAssistReceipt,
  ModelAssistRequest,
  ReviewDecision,
  ReviewDecisionOutcome,
  ReviewSession,
  ReviewStatus,
  TranscriptSegment,
  TranscriptSpeakerLabel,
  TranscriptStatus,
} from "@doctor-auditor/shared/local-review";
import type { ApprovedExport } from "@doctor-auditor/shared/cloud";
import type {
  DesktopSessionBundle,
  DesktopSessionSummary,
  SessionIntakeRequest,
} from "./review-models";

const DESKTOP_ACTOR_ID = "desktop";

interface LocalDatabaseOptions {
  seedDemoData?: boolean;
}

interface DeletedSessionRecord {
  sessionId: string;
  audioPath?: string;
}

export class LocalDatabase {
  private db: Database.Database;

  constructor(dbPath: string, options: LocalDatabaseOptions = {}) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initializeSchema();

    const shouldSeedDemoData =
      options.seedDemoData ?? shouldAutoSeedDemoData();
    if (shouldSeedDemoData) {
      this.seedDemoDatasetIfEmpty();
    }
  }

  createImportedSession(
    input: SessionIntakeRequest & {
      audioPath: string;
      capturedAt: string;
      sourceFileName: string;
    }
  ): DesktopSessionSummary {
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

  createLiveCaptureSession(
    input: SessionIntakeRequest & {
      startedAt: string;
      audioPath: string;
    }
  ): DesktopSessionSummary {
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

  finalizeLiveCaptureSession(
    sessionId: string,
    input: {
      endedAt: string;
      audioPath: string;
    }
  ): DesktopSessionSummary | null {
    return this.updateSession(sessionId, {
      encounterEndedAt: input.endedAt,
      audioPath: input.audioPath,
    });
  }

  failLiveCaptureSession(
    sessionId: string,
    failedAt: string
  ): DesktopSessionSummary | null {
    return this.updateSession(sessionId, {
      transcriptStatus: "failed",
      reviewStatus: "not_started",
      encounterEndedAt: failedAt,
      audioPath: null,
    });
  }

  updateSession(
    sessionId: string,
    updates: {
      transcriptStatus?: TranscriptStatus;
      reviewStatus?: ReviewStatus;
      exportStatus?: ExportStatus;
      encounterEndedAt?: string;
      audioPath?: string | null;
    }
  ): DesktopSessionSummary | null {
    const currentSummary = this.getSessionSummary(sessionId);
    if (!currentSummary) {
      return null;
    }

    const nextSession = {
      ...currentSummary.session,
      transcriptStatus:
        updates.transcriptStatus ?? currentSummary.session.transcriptStatus,
      reviewStatus: updates.reviewStatus ?? currentSummary.session.reviewStatus,
      exportStatus: updates.exportStatus ?? currentSummary.session.exportStatus,
      encounterEndedAt:
        updates.encounterEndedAt ?? currentSummary.session.encounterEndedAt,
      updatedAt: new Date().toISOString(),
    };
    const nextAudioPath =
      updates.audioPath === undefined ? currentSummary.audioPath : updates.audioPath;

    this.db
      .prepare(
        `UPDATE sessions
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
         WHERE id = ?`
      )
      .run(
        nextSession.clinicianId,
        nextSession.organizationId ?? null,
        nextSession.encounterStartedAt,
        nextSession.encounterEndedAt ?? null,
        nextSession.captureMode,
        nextSession.transcriptStatus,
        nextSession.reviewStatus,
        nextSession.exportStatus,
        nextSession.updatedAt,
        nextSession.consent.recordedWithConsent ? 1 : 0,
        nextSession.consent.exportAllowed ? 1 : 0,
        nextSession.consent.remoteAssistAllowed ? 1 : 0,
        nextSession.consent.policyVersion,
        nextSession.consent.capturedAt ?? null,
        nextSession.consent.capturedBy ?? null,
        nextAudioPath ?? null,
        sessionId
      );

    return this.getSessionSummary(sessionId);
  }

  resetLocalReviewArtifacts(sessionId: string): DesktopSessionSummary | null {
    this.clearDerivedReviewArtifacts(sessionId);
    return this.updateSession(sessionId, {
      reviewStatus: "not_started",
      exportStatus: "not_requested",
    });
  }

  replaceTranscriptSegments(
    sessionId: string,
    segments: TranscriptSegment[]
  ): void {
    this.clearDerivedReviewArtifacts(sessionId);
    this.db
      .prepare("DELETE FROM transcript_segments WHERE session_id = ?")
      .run(sessionId);

    for (const segment of segments) {
      this.addTranscriptSegment(segment);
    }
  }

  addTranscriptSegment(segment: TranscriptSegment): void {
    this.db
      .prepare(
        `INSERT INTO transcript_segments (
          id,
          session_id,
          speaker_label,
          text,
          start_offset_ms,
          end_offset_ms,
          transcript_confidence,
          speaker_confidence,
          source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        segment.id,
        segment.sessionId,
        segment.speakerLabel,
        segment.text,
        segment.startOffsetMs,
        segment.endOffsetMs,
        segment.transcriptConfidence ?? null,
        segment.speakerConfidence ?? null,
        segment.source
      );
  }

  replaceFindings(sessionId: string, findings: Finding[]): void {
    this.clearDerivedReviewArtifacts(sessionId);

    for (const finding of findings) {
      this.addFinding(finding);
    }

    this.updateSession(sessionId, {
      exportStatus: "not_requested",
      reviewStatus: findings.length > 0 ? undefined : "not_started",
    });
    this.syncSessionReviewStatus(sessionId);
  }

  saveReviewDecision(input: {
    sessionId: string;
    findingId: string;
    outcome: ReviewDecisionOutcome;
    rationale?: string;
    editedTitle?: string;
    editedSummary?: string;
    approvedEvidenceSpans?: EvidenceSpan[];
    reviewedBy?: string;
  }): DesktopSessionBundle | null {
    const findingRow = this.db
      .prepare(
        `SELECT *
         FROM findings
         WHERE id = ? AND session_id = ?`
      )
      .get(input.findingId, input.sessionId) as Record<string, unknown> | undefined;

    if (!findingRow) {
      return null;
    }

    const finding = this.mapFinding(findingRow);
    const reviewedAt = new Date().toISOString();
    const existingDecisionId =
      normalizeString(findingRow.review_decision_id) ??
      (
        this.db
          .prepare(
            `SELECT id
             FROM review_decisions
             WHERE finding_id = ? AND session_id = ?`
          )
          .get(input.findingId, input.sessionId) as
          | Record<string, unknown>
          | undefined
      )?.id;
    const decisionId =
      typeof existingDecisionId === "string" ? existingDecisionId : uuidv4();
    const approvedEvidenceSpans =
      input.approvedEvidenceSpans ?? finding.evidenceSpans;

    this.db
      .prepare(
        `INSERT OR REPLACE INTO review_decisions (
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        decisionId,
        input.sessionId,
        input.findingId,
        input.outcome,
        input.reviewedBy ?? DESKTOP_ACTOR_ID,
        reviewedAt,
        input.rationale ?? null,
        input.editedTitle ?? null,
        input.editedSummary ?? null,
        JSON.stringify(approvedEvidenceSpans)
      );

    this.db
      .prepare(
        `UPDATE findings
         SET status = ?,
             review_decision_id = ?,
             updated_at = ?
         WHERE id = ? AND session_id = ?`
      )
      .run(
        reviewStatusFromOutcome(input.outcome),
        decisionId,
        reviewedAt,
        input.findingId,
        input.sessionId
      );

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

  saveApprovedExport(approvedExport: ApprovedExport): DesktopSessionBundle | null {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO approved_exports (
          id,
          session_id,
          status,
          summary,
          findings_payload,
          approved_by,
          approved_at,
          destination,
          sent_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        approvedExport.id,
        approvedExport.sessionId,
        approvedExport.status,
        approvedExport.summary,
        JSON.stringify(approvedExport.findings),
        approvedExport.approvedBy,
        approvedExport.approvedAt,
        approvedExport.destination ?? null,
        approvedExport.sentAt ?? null
      );

    const sessionSummary = this.updateSession(approvedExport.sessionId, {
      exportStatus: approvedExport.status,
    });

    this.addAuditLog({
      sessionId: approvedExport.sessionId,
      action:
        approvedExport.status === "sent" ? "export_sent" : "export_approved",
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

  recordModelAssistRequested(request: ModelAssistRequest): void {
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

  saveModelAssistReceipt(input: {
    request: ModelAssistRequest;
    receipt: ModelAssistReceipt;
  }): DesktopSessionBundle | null {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO model_assist_receipts (
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.receipt.id,
        input.request.id,
        input.request.sessionId,
        input.request.findingId ?? null,
        input.receipt.status,
        input.receipt.policyMode,
        input.receipt.requestedAt,
        input.receipt.completedAt ?? null,
        input.receipt.latencyMs ?? null,
        input.receipt.errorCode ?? null,
        input.receipt.reviewerAction ?? null,
        input.receipt.assessment?.provider ?? null,
        input.receipt.assessment?.model ?? null,
        JSON.stringify(input.request),
        JSON.stringify(input.receipt.assessment ?? null)
      );

    this.addAuditLog({
      sessionId: input.request.sessionId,
      action:
        input.receipt.status === "completed" ? "assist_completed" : "assist_failed",
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

  updateModelAssistReviewerAction(input: {
    sessionId: string;
    receiptId: string;
    reviewerAction: NonNullable<ModelAssistReceipt["reviewerAction"]>;
  }): DesktopSessionBundle | null {
    this.db
      .prepare(
        `UPDATE model_assist_receipts
         SET reviewer_action = ?
         WHERE id = ? AND session_id = ?`
      )
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

  getSession(sessionId: string): DesktopSessionBundle | null {
    const sessionRow = this.db
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(sessionId) as Record<string, unknown> | undefined;

    if (!sessionRow) {
      return null;
    }

    const transcriptRows = this.db
      .prepare(
        `SELECT * FROM transcript_segments
         WHERE session_id = ?
         ORDER BY COALESCE(start_offset_ms, 0), id`
      )
      .all(sessionId) as Record<string, unknown>[];

    const auditRows = this.db
      .prepare(
        "SELECT * FROM audit_log WHERE session_id = ? ORDER BY timestamp ASC"
      )
      .all(sessionId) as Record<string, unknown>[];

    const findingRows = this.db
      .prepare(
        `SELECT *
         FROM findings
         WHERE session_id = ?
         ORDER BY created_at ASC, id ASC`
      )
      .all(sessionId) as Record<string, unknown>[];

    const reviewDecisionRows = this.db
      .prepare(
        `SELECT *
         FROM review_decisions
         WHERE session_id = ?
         ORDER BY reviewed_at ASC, id ASC`
      )
      .all(sessionId) as Record<string, unknown>[];

    const approvedExportRows = this.db
      .prepare(
        `SELECT *
         FROM approved_exports
         WHERE session_id = ?
         ORDER BY approved_at ASC, id ASC`
      )
      .all(sessionId) as Record<string, unknown>[];

    const modelAssistRows = this.db
      .prepare(
        `SELECT *
         FROM model_assist_receipts
         WHERE session_id = ?
         ORDER BY requested_at ASC, id ASC`
      )
      .all(sessionId) as Record<string, unknown>[];

    return {
      session: this.mapSession(sessionRow),
      transcriptSegments: transcriptRows.map((row) =>
        this.mapTranscriptSegment(row)
      ),
      findings: findingRows.map((row) => this.mapFinding(row)),
      reviewDecisions: reviewDecisionRows.map((row) =>
        this.mapReviewDecision(row)
      ),
      approvedExports: approvedExportRows.map((row) =>
        this.mapApprovedExport(row)
      ),
      auditLogEntries: auditRows.map((row) => this.mapAuditLogEntry(row)),
      modelAssistReceipts: modelAssistRows.map((row) =>
        this.mapModelAssistReceipt(row)
      ),
      audioPath: normalizeString(sessionRow.audio_path),
    };
  }

  getSessionSummary(sessionId: string): DesktopSessionSummary | null {
    const row = this.db
      .prepare(
        `SELECT s.*, COUNT(ts.id) AS transcript_segment_count
         FROM sessions s
         LEFT JOIN transcript_segments ts ON ts.session_id = s.id
         WHERE s.id = ?
         GROUP BY s.id`
      )
      .get(sessionId) as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    return {
      session: this.mapSession(row),
      audioPath: normalizeString(row.audio_path),
      transcriptSegmentCount: normalizeNumber(row.transcript_segment_count) ?? 0,
    };
  }

  getAllSessions(): DesktopSessionSummary[] {
    const rows = this.db
      .prepare(
        `SELECT s.*, COUNT(ts.id) AS transcript_segment_count
         FROM sessions s
         LEFT JOIN transcript_segments ts ON ts.session_id = s.id
         GROUP BY s.id
         ORDER BY s.created_at DESC`
      )
      .all() as Record<string, unknown>[];

    return rows.map((row) => ({
      session: this.mapSession(row),
      audioPath: normalizeString(row.audio_path),
      transcriptSegmentCount: normalizeNumber(row.transcript_segment_count) ?? 0,
    }));
  }

  deleteSession(sessionId: string): DeletedSessionRecord | null {
    const sessionSummary = this.getSessionSummary(sessionId);
    if (!sessionSummary) {
      return null;
    }

    const deleteSessionTransaction = this.db.transaction(
      (targetSessionId: string) => {
        this.clearDerivedReviewArtifacts(targetSessionId);
        this.db
          .prepare("DELETE FROM transcript_segments WHERE session_id = ?")
          .run(targetSessionId);
        this.db
          .prepare("DELETE FROM audit_log WHERE session_id = ?")
          .run(targetSessionId);
        this.db.prepare("DELETE FROM sessions WHERE id = ?").run(targetSessionId);
      }
    );

    deleteSessionTransaction(sessionId);

    return {
      sessionId,
      audioPath: sessionSummary.audioPath,
    };
  }

  close(): void {
    this.db.close();
  }

  private seedDemoDatasetIfEmpty(): void {
    const row = this.db
      .prepare("SELECT COUNT(*) AS session_count FROM sessions")
      .get() as Record<string, unknown> | undefined;
    const sessionCount = normalizeNumber(row?.session_count) ?? 0;

    if (sessionCount > 0) {
      return;
    }

    this.seedDemoDataset();
  }

  private seedDemoDataset(): void {
    const policyVersion = "demo-policy-2026.03";

    this.insertSeedSession(
      {
        id: "session-local-demo-001",
        clinicianId: "Dr. Mira Patel",
        encounterStartedAt: "2026-03-15T09:00:00Z",
        encounterEndedAt: "2026-03-15T09:17:00Z",
        captureMode: "audio_import",
        transcriptStatus: "not_started",
        reviewStatus: "not_started",
        exportStatus: "not_requested",
        createdAt: "2026-03-15T09:02:00Z",
        updatedAt: "2026-03-15T09:21:30Z",
        consent: {
          recordedWithConsent: true,
          exportAllowed: true,
          remoteAssistAllowed: true,
          policyVersion,
          capturedAt: "2026-03-15T09:02:00Z",
          capturedBy: DESKTOP_ACTOR_ID,
        },
      },
      "/demo/mock-audio/inhaler-followup.wav"
    );
    this.replaceTranscriptSegments("session-local-demo-001", [
      {
        id: "segment-local-demo-001",
        sessionId: "session-local-demo-001",
        speakerLabel: "clinician",
        text: "Walk me through how you've been using the inhaler since last week.",
        startOffsetMs: 0,
        endOffsetMs: 3500,
        transcriptConfidence: 0.98,
        speakerConfidence: 0.92,
        source: "audio_import",
      },
      {
        id: "segment-local-demo-002",
        sessionId: "session-local-demo-001",
        speakerLabel: "patient",
        text: "I used it twice a day until I ran out on Tuesday.",
        startOffsetMs: 3600,
        endOffsetMs: 7100,
        transcriptConfidence: 0.97,
        speakerConfidence: 0.9,
        source: "audio_import",
      },
      {
        id: "segment-local-demo-003",
        sessionId: "session-local-demo-001",
        speakerLabel: "clinician",
        text: "What happened after it ran out?",
        startOffsetMs: 7200,
        endOffsetMs: 9100,
        transcriptConfidence: 0.99,
        speakerConfidence: 0.94,
        source: "audio_import",
      },
      {
        id: "segment-local-demo-004",
        sessionId: "session-local-demo-001",
        speakerLabel: "patient",
        text: "The pharmacy said the refill was delayed, and I got short of breath again.",
        startOffsetMs: 9300,
        endOffsetMs: 14300,
        transcriptConfidence: 0.96,
        speakerConfidence: 0.91,
        source: "audio_import",
      },
      {
        id: "segment-local-demo-005",
        sessionId: "session-local-demo-001",
        speakerLabel: "clinician",
        text: "Let's review when to call and how to restart it once the refill arrives.",
        startOffsetMs: 14500,
        endOffsetMs: 19000,
        transcriptConfidence: 0.98,
        speakerConfidence: 0.93,
        source: "audio_import",
      },
    ]);
    this.updateSession("session-local-demo-001", {
      transcriptStatus: "completed",
    });
    this.replaceFindings("session-local-demo-001", [
      {
        id: "finding-local-demo-001",
        sessionId: "session-local-demo-001",
        code: "medication-access-gap",
        title: "Medication access barrier may need follow-up",
        summary:
          "The patient reported running out of the inhaler because the refill was delayed.",
        status: "pending_review",
        confidence: 0.86,
        evidenceSpans: [
          {
            id: "evidence-local-demo-001",
            transcriptSegmentId: "segment-local-demo-002",
            excerpt: "I used it twice a day until I ran out on Tuesday.",
            startOffsetMs: 3600,
            endOffsetMs: 7100,
          },
          {
            id: "evidence-local-demo-002",
            transcriptSegmentId: "segment-local-demo-004",
            excerpt:
              "The pharmacy said the refill was delayed, and I got short of breath again.",
            startOffsetMs: 9300,
            endOffsetMs: 14300,
          },
        ],
        detectedBy: "rules",
        createdAt: "2026-03-15T09:12:00Z",
        updatedAt: "2026-03-15T09:12:00Z",
      },
      {
        id: "finding-local-demo-002",
        sessionId: "session-local-demo-001",
        code: "return-precautions-check",
        title: "Return precautions should be confirmed before export",
        summary:
          "The clinician began a callback plan, but reviewer confirmation is still pending.",
        status: "pending_review",
        confidence: 0.74,
        evidenceSpans: [
          {
            id: "evidence-local-demo-003",
            transcriptSegmentId: "segment-local-demo-005",
            excerpt:
              "Let's review when to call and how to restart it once the refill arrives.",
            startOffsetMs: 14500,
            endOffsetMs: 19000,
          },
        ],
        detectedBy: "local_llm",
        createdAt: "2026-03-15T09:13:00Z",
        updatedAt: "2026-03-15T09:13:00Z",
      },
    ]);
    const sessionOneBundle = this.saveReviewDecision({
      sessionId: "session-local-demo-001",
      findingId: "finding-local-demo-001",
      outcome: "accepted",
      reviewedBy: "reviewer-maya",
    });
    if (!sessionOneBundle) {
      throw new Error("Unable to seed session-local-demo-001 review decision.");
    }
    const sessionOneAssistRequest: ModelAssistRequest = {
      id: "assist-request-local-demo-001",
      sessionId: "session-local-demo-001",
      findingId: "finding-local-demo-001",
      requestedBy: "reviewer-maya",
      requestedAt: "2026-03-15T09:17:30Z",
      policyVersion,
      policyMode: "minimized_no_raw_phi",
      concern: {
        findingCode: "medication-access-gap",
        findingStatus: "accepted",
        findingConfidence: 0.86,
        evidenceSpanCount: 2,
        speakerLabels: ["clinician", "patient"],
        captureMode: "audio_import",
        encounterDurationMs: 17 * 60 * 1000,
      },
    };
    this.recordModelAssistRequested(sessionOneAssistRequest);
    this.saveModelAssistReceipt({
      request: sessionOneAssistRequest,
      receipt: {
        id: "assist-receipt-local-demo-001",
        requestId: sessionOneAssistRequest.id,
        sessionId: "session-local-demo-001",
        findingId: "finding-local-demo-001",
        status: "completed",
        policyMode: "minimized_no_raw_phi",
        requestedAt: "2026-03-15T09:17:30Z",
        completedAt: "2026-03-15T09:17:31Z",
        latencyMs: 684,
        reviewerAction: "not_applied",
        assessment: {
          disposition: "expedited_human_review",
          confidence: 0.81,
          rationale:
            "Medication access interruptions plus renewed shortness of breath should stay in the active reviewer lane.",
          limitations: [
            "Only minimized evidence spans were available.",
            "No pharmacy fill history was attached.",
          ],
          provider: "doctor-auditor-assist-gateway",
          model: "policy-heuristic-v1",
          assessedAt: "2026-03-15T09:17:31Z",
        },
      },
    });
    this.setSessionTimestamps(
      "session-local-demo-001",
      "2026-03-15T09:02:00Z",
      "2026-03-15T09:21:30Z"
    );

    this.insertSeedSession(
      {
        id: "session-local-demo-002",
        clinicianId: "Dr. Ada Moreno",
        encounterStartedAt: "2026-03-14T13:20:00Z",
        encounterEndedAt: "2026-03-14T13:42:00Z",
        captureMode: "live_capture",
        transcriptStatus: "not_started",
        reviewStatus: "not_started",
        exportStatus: "not_requested",
        createdAt: "2026-03-14T13:24:00Z",
        updatedAt: "2026-03-14T14:05:00Z",
        consent: {
          recordedWithConsent: true,
          exportAllowed: true,
          remoteAssistAllowed: true,
          policyVersion,
          capturedAt: "2026-03-14T13:24:00Z",
          capturedBy: DESKTOP_ACTOR_ID,
        },
      },
      "/demo/mock-audio/discharge-handoff.wav"
    );
    this.replaceTranscriptSegments("session-local-demo-002", [
      {
        id: "segment-local-demo-006",
        sessionId: "session-local-demo-002",
        speakerLabel: "clinician",
        text: "Before you leave, tell me what would make you call us tonight instead of waiting.",
        startOffsetMs: 0,
        endOffsetMs: 4100,
        transcriptConfidence: 0.98,
        speakerConfidence: 0.95,
        source: "live_capture",
      },
      {
        id: "segment-local-demo-007",
        sessionId: "session-local-demo-002",
        speakerLabel: "patient",
        text: "I would call if the dizziness comes back or if I cannot keep fluids down.",
        startOffsetMs: 4300,
        endOffsetMs: 8500,
        transcriptConfidence: 0.97,
        speakerConfidence: 0.92,
        source: "live_capture",
      },
      {
        id: "segment-local-demo-008",
        sessionId: "session-local-demo-002",
        speakerLabel: "clinician",
        text: "Good. The cardiology handoff will mention the medication change and the two day callback.",
        startOffsetMs: 8700,
        endOffsetMs: 13200,
        transcriptConfidence: 0.98,
        speakerConfidence: 0.95,
        source: "live_capture",
      },
      {
        id: "segment-local-demo-009",
        sessionId: "session-local-demo-002",
        speakerLabel: "patient",
        text: "Please include that I already scheduled the lab draw for Monday morning.",
        startOffsetMs: 13400,
        endOffsetMs: 17100,
        transcriptConfidence: 0.96,
        speakerConfidence: 0.9,
        source: "live_capture",
      },
    ]);
    this.updateSession("session-local-demo-002", {
      transcriptStatus: "completed",
    });
    this.replaceFindings("session-local-demo-002", [
      {
        id: "finding-local-demo-003",
        sessionId: "session-local-demo-002",
        code: "teach-back-confirmed",
        title: "Teach-back for return precautions is present",
        summary:
          "The patient repeated back the callback triggers and escalation plan.",
        status: "pending_review",
        confidence: 0.88,
        evidenceSpans: [
          {
            id: "evidence-local-demo-004",
            transcriptSegmentId: "segment-local-demo-007",
            excerpt:
              "I would call if the dizziness comes back or if I cannot keep fluids down.",
            startOffsetMs: 4300,
            endOffsetMs: 8500,
          },
        ],
        detectedBy: "rules",
        createdAt: "2026-03-14T13:46:00Z",
        updatedAt: "2026-03-14T13:46:00Z",
      },
      {
        id: "finding-local-demo-004",
        sessionId: "session-local-demo-002",
        code: "handoff-clarity",
        title: "Downstream handoff summary was tightened during review",
        summary:
          "The reviewer wants the callback timing and medication change surfaced in the export packet.",
        status: "pending_review",
        confidence: 0.79,
        evidenceSpans: [
          {
            id: "evidence-local-demo-005",
            transcriptSegmentId: "segment-local-demo-008",
            excerpt:
              "The cardiology handoff will mention the medication change and the two day callback.",
            startOffsetMs: 8700,
            endOffsetMs: 13200,
          },
          {
            id: "evidence-local-demo-006",
            transcriptSegmentId: "segment-local-demo-009",
            excerpt:
              "Please include that I already scheduled the lab draw for Monday morning.",
            startOffsetMs: 13400,
            endOffsetMs: 17100,
          },
        ],
        detectedBy: "human",
        createdAt: "2026-03-14T13:47:00Z",
        updatedAt: "2026-03-14T13:47:00Z",
      },
    ]);
    let sessionTwoBundle = this.saveReviewDecision({
      sessionId: "session-local-demo-002",
      findingId: "finding-local-demo-003",
      outcome: "accepted",
      reviewedBy: "quality-lead-jordan",
    });
    if (!sessionTwoBundle) {
      throw new Error("Unable to seed session-local-demo-002 decision one.");
    }
    sessionTwoBundle = this.saveReviewDecision({
      sessionId: "session-local-demo-002",
      findingId: "finding-local-demo-004",
      outcome: "accepted",
      reviewedBy: "quality-lead-jordan",
    });
    if (!sessionTwoBundle) {
      throw new Error("Unable to seed session-local-demo-002 decision two.");
    }
    const sessionTwoAssistRequest: ModelAssistRequest = {
      id: "assist-request-local-demo-002",
      sessionId: "session-local-demo-002",
      findingId: "finding-local-demo-004",
      requestedBy: "quality-lead-jordan",
      requestedAt: "2026-03-14T13:55:00Z",
      policyVersion,
      policyMode: "minimized_no_raw_phi",
      concern: {
        findingCode: "handoff-clarity",
        findingStatus: "accepted",
        findingConfidence: 0.79,
        evidenceSpanCount: 2,
        speakerLabels: ["clinician", "patient"],
        captureMode: "live_capture",
        encounterDurationMs: 22 * 60 * 1000,
      },
    };
    this.recordModelAssistRequested(sessionTwoAssistRequest);
    this.saveModelAssistReceipt({
      request: sessionTwoAssistRequest,
      receipt: {
        id: "assist-receipt-local-demo-002",
        requestId: sessionTwoAssistRequest.id,
        sessionId: "session-local-demo-002",
        findingId: "finding-local-demo-004",
        status: "completed",
        policyMode: "minimized_no_raw_phi",
        requestedAt: "2026-03-14T13:55:00Z",
        completedAt: "2026-03-14T13:55:01Z",
        latencyMs: 541,
        reviewerAction: "not_applied",
        assessment: {
          disposition: "routine_review",
          confidence: 0.77,
          rationale:
            "The handoff issue was already made explicit locally and can stay in the normal release lane.",
          limitations: ["Remote assist did not inspect the final export wording."],
          provider: "doctor-auditor-assist-gateway",
          model: "policy-heuristic-v1",
          assessedAt: "2026-03-14T13:55:01Z",
        },
      },
    });
    sessionTwoBundle = this.updateModelAssistReviewerAction({
      sessionId: "session-local-demo-002",
      receiptId: "assist-receipt-local-demo-002",
      reviewerAction: "dismissed",
    });
    if (!sessionTwoBundle) {
      throw new Error("Unable to seed session-local-demo-002 assist dismissal.");
    }
    sessionTwoBundle = this.saveApprovedExport({
      id: "export-local-demo-001",
      sessionId: "session-local-demo-002",
      status: "approved",
      summary:
        "Approved discharge handoff packet with callback timing and return precautions clarified.",
      findings: [
        this.buildApprovedExportFinding(
          sessionTwoBundle,
          "finding-local-demo-003"
        ),
        this.buildApprovedExportFinding(
          sessionTwoBundle,
          "finding-local-demo-004"
        ),
      ],
      approvedBy: "quality-lead-jordan",
      approvedAt: "2026-03-14T14:03:00Z",
      destination: "care-transition-hold",
    });
    if (!sessionTwoBundle) {
      throw new Error("Unable to seed session-local-demo-002 export.");
    }
    this.setSessionTimestamps(
      "session-local-demo-002",
      "2026-03-14T13:24:00Z",
      "2026-03-14T14:05:00Z"
    );

    this.insertSeedSession(
      {
        id: "session-local-demo-003",
        clinicianId: "Dr. Noor Hassan",
        encounterStartedAt: "2026-03-13T16:00:00Z",
        encounterEndedAt: "2026-03-13T16:18:00Z",
        captureMode: "audio_import",
        transcriptStatus: "not_started",
        reviewStatus: "not_started",
        exportStatus: "not_requested",
        createdAt: "2026-03-13T16:03:00Z",
        updatedAt: "2026-03-13T16:16:00Z",
        consent: {
          recordedWithConsent: true,
          exportAllowed: true,
          remoteAssistAllowed: false,
          policyVersion,
          capturedAt: "2026-03-13T16:03:00Z",
          capturedBy: DESKTOP_ACTOR_ID,
        },
      },
      "/demo/mock-audio/followup-scheduling.wav"
    );
    this.replaceTranscriptSegments("session-local-demo-003", [
      {
        id: "segment-local-demo-010",
        sessionId: "session-local-demo-003",
        speakerLabel: "clinician",
        text: "I want to make sure the imaging follow-up happens within the week.",
        startOffsetMs: 0,
        endOffsetMs: 3200,
        transcriptConfidence: 0.98,
        speakerConfidence: 0.92,
        source: "audio_import",
      },
      {
        id: "segment-local-demo-011",
        sessionId: "session-local-demo-003",
        speakerLabel: "patient",
        text: "I can come Thursday morning, but I was not sure which number to call if it changes.",
        startOffsetMs: 3400,
        endOffsetMs: 7900,
        transcriptConfidence: 0.97,
        speakerConfidence: 0.89,
        source: "audio_import",
      },
      {
        id: "segment-local-demo-012",
        sessionId: "session-local-demo-003",
        speakerLabel: "clinician",
        text: "We'll add the scheduling line to the printed instructions before anything is exported.",
        startOffsetMs: 8100,
        endOffsetMs: 12300,
        transcriptConfidence: 0.98,
        speakerConfidence: 0.93,
        source: "audio_import",
      },
    ]);
    this.updateSession("session-local-demo-003", {
      transcriptStatus: "completed",
    });
    this.replaceFindings("session-local-demo-003", [
      {
        id: "finding-local-demo-005",
        sessionId: "session-local-demo-003",
        code: "followup-scheduling-clarity",
        title: "Scheduling callback instructions need reviewer confirmation",
        summary:
          "The patient did not hear a clear callback number for rescheduling the follow-up imaging.",
        status: "pending_review",
        confidence: 0.75,
        evidenceSpans: [
          {
            id: "evidence-local-demo-007",
            transcriptSegmentId: "segment-local-demo-011",
            excerpt:
              "I was not sure which number to call if it changes.",
            startOffsetMs: 3400,
            endOffsetMs: 7900,
          },
        ],
        detectedBy: "rules",
        createdAt: "2026-03-13T16:14:00Z",
        updatedAt: "2026-03-13T16:14:00Z",
      },
    ]);
    this.setSessionTimestamps(
      "session-local-demo-003",
      "2026-03-13T16:03:00Z",
      "2026-03-13T16:16:00Z"
    );

    this.insertSeedSession(
      {
        id: "session-local-demo-004",
        clinicianId: "Dr. Lin Reyes",
        encounterStartedAt: "2026-03-13T09:00:00Z",
        encounterEndedAt: "2026-03-13T09:14:00Z",
        captureMode: "audio_import",
        transcriptStatus: "in_progress",
        reviewStatus: "not_started",
        exportStatus: "not_requested",
        createdAt: "2026-03-13T09:01:00Z",
        updatedAt: "2026-03-13T09:08:00Z",
        consent: {
          recordedWithConsent: true,
          exportAllowed: true,
          remoteAssistAllowed: true,
          policyVersion,
          capturedAt: "2026-03-13T09:01:00Z",
          capturedBy: DESKTOP_ACTOR_ID,
        },
      },
      "/demo/mock-audio/awaiting-transcript.wav"
    );

    this.insertSeedSession(
      {
        id: "session-local-demo-005",
        clinicianId: "Dr. Sofia Santos",
        encounterStartedAt: "2026-03-12T17:40:00Z",
        encounterEndedAt: "2026-03-12T17:52:00Z",
        captureMode: "live_capture",
        transcriptStatus: "failed",
        reviewStatus: "not_started",
        exportStatus: "not_requested",
        createdAt: "2026-03-12T17:41:00Z",
        updatedAt: "2026-03-12T17:53:00Z",
        consent: {
          recordedWithConsent: true,
          exportAllowed: false,
          remoteAssistAllowed: false,
          policyVersion,
          capturedAt: "2026-03-12T17:41:00Z",
          capturedBy: DESKTOP_ACTOR_ID,
        },
      }
    );

    this.insertSeedSession(
      {
        id: "session-local-demo-006",
        clinicianId: "Dr. Evan Kline",
        encounterStartedAt: "2026-03-11T10:15:00Z",
        encounterEndedAt: "2026-03-11T10:33:00Z",
        captureMode: "audio_import",
        transcriptStatus: "not_started",
        reviewStatus: "not_started",
        exportStatus: "not_requested",
        createdAt: "2026-03-11T10:18:00Z",
        updatedAt: "2026-03-11T11:05:00Z",
        consent: {
          recordedWithConsent: true,
          exportAllowed: true,
          remoteAssistAllowed: true,
          policyVersion,
          capturedAt: "2026-03-11T10:18:00Z",
          capturedBy: DESKTOP_ACTOR_ID,
        },
      },
      "/demo/mock-audio/cardiology-handoff.wav"
    );
    this.replaceTranscriptSegments("session-local-demo-006", [
      {
        id: "segment-local-demo-013",
        sessionId: "session-local-demo-006",
        speakerLabel: "patient",
        text: "My weight went up three pounds, but I took the diuretic this morning.",
        startOffsetMs: 0,
        endOffsetMs: 3700,
        transcriptConfidence: 0.97,
        speakerConfidence: 0.9,
        source: "audio_import",
      },
      {
        id: "segment-local-demo-014",
        sessionId: "session-local-demo-006",
        speakerLabel: "clinician",
        text: "If the swelling gets worse tonight, call the on-call line and do not wait for clinic hours.",
        startOffsetMs: 3900,
        endOffsetMs: 8400,
        transcriptConfidence: 0.98,
        speakerConfidence: 0.95,
        source: "audio_import",
      },
      {
        id: "segment-local-demo-015",
        sessionId: "session-local-demo-006",
        speakerLabel: "clinician",
        text: "The cardiology team will get a handoff that includes the dose increase and tomorrow's lab plan.",
        startOffsetMs: 8600,
        endOffsetMs: 13100,
        transcriptConfidence: 0.98,
        speakerConfidence: 0.94,
        source: "audio_import",
      },
      {
        id: "segment-local-demo-016",
        sessionId: "session-local-demo-006",
        speakerLabel: "patient",
        text: "I heard the callback instructions, and I will weigh myself again in the morning.",
        startOffsetMs: 13300,
        endOffsetMs: 17200,
        transcriptConfidence: 0.97,
        speakerConfidence: 0.9,
        source: "audio_import",
      },
    ]);
    this.updateSession("session-local-demo-006", {
      transcriptStatus: "completed",
    });
    this.replaceFindings("session-local-demo-006", [
      {
        id: "finding-local-demo-006",
        sessionId: "session-local-demo-006",
        code: "symptom-escalation-plan",
        title: "Escalation instructions were documented clearly",
        summary:
          "Return precautions and the on-call path were stated clearly enough for export.",
        status: "pending_review",
        confidence: 0.83,
        evidenceSpans: [
          {
            id: "evidence-local-demo-008",
            transcriptSegmentId: "segment-local-demo-014",
            excerpt:
              "If the swelling gets worse tonight, call the on-call line and do not wait for clinic hours.",
            startOffsetMs: 3900,
            endOffsetMs: 8400,
          },
        ],
        detectedBy: "rules",
        createdAt: "2026-03-11T10:37:00Z",
        updatedAt: "2026-03-11T10:37:00Z",
      },
      {
        id: "finding-local-demo-007",
        sessionId: "session-local-demo-006",
        code: "medication-risk",
        title: "Diuretic dose change needed second review",
        summary:
          "The reviewer checked whether the dose change needed higher-acuity handling.",
        status: "pending_review",
        confidence: 0.7,
        evidenceSpans: [
          {
            id: "evidence-local-demo-009",
            transcriptSegmentId: "segment-local-demo-013",
            excerpt:
              "My weight went up three pounds, but I took the diuretic this morning.",
            startOffsetMs: 0,
            endOffsetMs: 3700,
          },
        ],
        detectedBy: "local_llm",
        createdAt: "2026-03-11T10:38:00Z",
        updatedAt: "2026-03-11T10:38:00Z",
      },
      {
        id: "finding-local-demo-008",
        sessionId: "session-local-demo-006",
        code: "handoff-clarity",
        title: "Cardiology handoff summary is ready for export",
        summary:
          "The local handoff summary includes the dose change and planned lab follow-up.",
        status: "pending_review",
        confidence: 0.85,
        evidenceSpans: [
          {
            id: "evidence-local-demo-010",
            transcriptSegmentId: "segment-local-demo-015",
            excerpt:
              "The cardiology team will get a handoff that includes the dose increase and tomorrow's lab plan.",
            startOffsetMs: 8600,
            endOffsetMs: 13100,
          },
        ],
        detectedBy: "human",
        createdAt: "2026-03-11T10:39:00Z",
        updatedAt: "2026-03-11T10:39:00Z",
      },
    ]);
    let sessionSixBundle = this.saveReviewDecision({
      sessionId: "session-local-demo-006",
      findingId: "finding-local-demo-006",
      outcome: "accepted",
      reviewedBy: "quality-lead-harper",
    });
    if (!sessionSixBundle) {
      throw new Error("Unable to seed session-local-demo-006 decision one.");
    }
    const sessionSixAssistRequest: ModelAssistRequest = {
      id: "assist-request-local-demo-003",
      sessionId: "session-local-demo-006",
      findingId: "finding-local-demo-007",
      requestedBy: "quality-lead-harper",
      requestedAt: "2026-03-11T10:42:00Z",
      policyVersion,
      policyMode: "minimized_no_raw_phi",
      concern: {
        findingCode: "medication-risk",
        findingStatus: "pending_review",
        findingConfidence: 0.7,
        evidenceSpanCount: 1,
        speakerLabels: ["patient"],
        captureMode: "audio_import",
        encounterDurationMs: 18 * 60 * 1000,
      },
    };
    this.recordModelAssistRequested(sessionSixAssistRequest);
    this.saveModelAssistReceipt({
      request: sessionSixAssistRequest,
      receipt: {
        id: "assist-receipt-local-demo-003",
        requestId: sessionSixAssistRequest.id,
        sessionId: "session-local-demo-006",
        findingId: "finding-local-demo-007",
        status: "failed",
        policyMode: "minimized_no_raw_phi",
        requestedAt: "2026-03-11T10:42:00Z",
        completedAt: "2026-03-11T10:42:02Z",
        latencyMs: 1204,
        errorCode: "gateway-timeout",
      },
    });
    sessionSixBundle = this.saveReviewDecision({
      sessionId: "session-local-demo-006",
      findingId: "finding-local-demo-007",
      outcome: "rejected",
      reviewedBy: "quality-lead-harper",
    });
    if (!sessionSixBundle) {
      throw new Error("Unable to seed session-local-demo-006 decision two.");
    }
    sessionSixBundle = this.saveReviewDecision({
      sessionId: "session-local-demo-006",
      findingId: "finding-local-demo-008",
      outcome: "accepted",
      reviewedBy: "quality-lead-harper",
    });
    if (!sessionSixBundle) {
      throw new Error("Unable to seed session-local-demo-006 decision three.");
    }
    sessionSixBundle = this.saveApprovedExport({
      id: "export-local-demo-002",
      sessionId: "session-local-demo-006",
      status: "sent",
      summary:
        "Sent cardiology handoff packet with escalation instructions and planned lab follow-up.",
      findings: [
        this.buildApprovedExportFinding(
          sessionSixBundle,
          "finding-local-demo-006"
        ),
        this.buildApprovedExportFinding(
          sessionSixBundle,
          "finding-local-demo-008"
        ),
      ],
      approvedBy: "quality-lead-harper",
      approvedAt: "2026-03-11T10:58:00Z",
      destination: "compliance-archive",
      sentAt: "2026-03-11T11:04:00Z",
    });
    if (!sessionSixBundle) {
      throw new Error("Unable to seed session-local-demo-006 export.");
    }
    this.setSessionTimestamps(
      "session-local-demo-006",
      "2026-03-11T10:18:00Z",
      "2026-03-11T11:05:00Z"
    );
  }

  private insertSeedSession(
    session: ReviewSession,
    audioPath?: string
  ): void {
    this.db
      .prepare(
        `INSERT INTO sessions (
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        session.id,
        session.clinicianId,
        session.organizationId ?? null,
        session.encounterStartedAt,
        session.encounterEndedAt ?? null,
        session.captureMode,
        session.transcriptStatus,
        session.reviewStatus,
        session.exportStatus,
        session.createdAt,
        session.updatedAt,
        session.consent.recordedWithConsent ? 1 : 0,
        session.consent.exportAllowed ? 1 : 0,
        session.consent.remoteAssistAllowed ? 1 : 0,
        session.consent.policyVersion,
        session.consent.capturedAt ?? null,
        session.consent.capturedBy ?? null,
        audioPath ?? null
      );

    this.addAuditLog({
      sessionId: session.id,
      action: "session_created",
      actorId: session.consent.capturedBy ?? DESKTOP_ACTOR_ID,
      details: {
        captureMode: session.captureMode,
        transcriptStatus: session.transcriptStatus,
        reviewStatus: session.reviewStatus,
      },
      timestamp: session.createdAt,
    });
  }

  private setSessionTimestamps(
    sessionId: string,
    createdAt: string,
    updatedAt: string
  ): void {
    this.db
      .prepare(
        `UPDATE sessions
         SET created_at = ?,
             updated_at = ?,
             consent_captured_at = COALESCE(consent_captured_at, ?)
         WHERE id = ?`
      )
      .run(createdAt, updatedAt, createdAt, sessionId);
  }

  private buildApprovedExportFinding(
    bundle: DesktopSessionBundle,
    findingId: string
  ): ApprovedExport["findings"][number] {
    const finding = bundle.findings.find((item) => item.id === findingId);
    if (!finding || !finding.reviewDecisionId) {
      throw new Error(`Unable to build approved export finding for ${findingId}.`);
    }

    return {
      findingId: finding.id,
      code: finding.code,
      title: finding.title,
      summary: finding.summary,
      reviewDecisionId: finding.reviewDecisionId,
      evidenceExcerpts: finding.evidenceSpans.map((span) => ({
        sourceEvidenceSpanId: span.id,
        sourceTranscriptSegmentId: span.transcriptSegmentId,
        excerpt: span.excerpt,
        startOffsetMs: span.startOffsetMs,
        endOffsetMs: span.endOffsetMs,
      })),
    };
  }

  private createSessionShell(input: {
    captureMode: CaptureMode;
    clinicianId: string;
    recordedWithConsent: boolean;
    exportAllowed: boolean;
    remoteAssistAllowed: boolean;
    policyVersion: string;
    encounterStartedAt: string;
    encounterEndedAt?: string;
    audioPath?: string;
  }): DesktopSessionSummary {
    const now = new Date().toISOString();
    const session: ReviewSession = {
      id: uuidv4(),
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
      .prepare(
        `INSERT INTO sessions (
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        session.id,
        session.clinicianId,
        session.organizationId ?? null,
        session.encounterStartedAt,
        session.encounterEndedAt ?? null,
        session.captureMode,
        session.transcriptStatus,
        session.reviewStatus,
        session.exportStatus,
        session.createdAt,
        session.updatedAt,
        session.consent.recordedWithConsent ? 1 : 0,
        session.consent.exportAllowed ? 1 : 0,
        session.consent.remoteAssistAllowed ? 1 : 0,
        session.consent.policyVersion,
        session.consent.capturedAt ?? null,
        session.consent.capturedBy ?? null,
        input.audioPath ?? null
      );

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

  private initializeSchema(): void {
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
    this.ensureColumn(
      "sessions",
      "consent_export_allowed",
      "INTEGER DEFAULT 0"
    );
    this.ensureColumn(
      "sessions",
      "consent_remote_assist_allowed",
      "INTEGER DEFAULT 0"
    );
    this.ensureColumn(
      "sessions",
      "consent_policy_version",
      "TEXT DEFAULT 'local-only-v1'"
    );
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

    this.ensureColumn(
      "review_decisions",
      "approved_evidence_spans",
      "TEXT NOT NULL DEFAULT '[]'"
    );

    this.ensureColumn(
      "approved_exports",
      "findings_payload",
      "TEXT NOT NULL DEFAULT '[]'"
    );

    this.ensureColumn(
      "model_assist_receipts",
      "request_payload",
      "TEXT NOT NULL DEFAULT '{}'"
    );
    this.ensureColumn(
      "model_assist_receipts",
      "assessment_payload",
      "TEXT"
    );
    this.ensureColumn("model_assist_receipts", "provider", "TEXT");
    this.ensureColumn("model_assist_receipts", "model_name", "TEXT");
    this.ensureColumn("model_assist_receipts", "reviewer_action", "TEXT");

    this.ensureColumn("audit_log", "session_id", "TEXT");
    this.ensureColumn("audit_log", "actor_id", "TEXT");
  }

  private addAuditLog(entry: {
    sessionId: string;
    action: AuditLogEntry["action"];
    actorId?: string;
    details: Record<string, unknown>;
    timestamp?: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO audit_log (id, session_id, timestamp, action, actor_id, details)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        uuidv4(),
        entry.sessionId,
        entry.timestamp ?? new Date().toISOString(),
        entry.action,
        entry.actorId ?? null,
        JSON.stringify(entry.details)
      );
  }

  private addFinding(finding: Finding): void {
    this.db
      .prepare(
        `INSERT INTO findings (
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        finding.id,
        finding.sessionId,
        finding.code,
        finding.title,
        finding.summary,
        finding.status,
        finding.confidence,
        JSON.stringify(finding.evidenceSpans),
        finding.detectedBy,
        finding.createdAt,
        finding.updatedAt,
        finding.reviewDecisionId ?? null
      );
  }

  private mapFinding(row: Record<string, unknown>): Finding {
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      code: normalizeString(row.code) ?? "unknown-finding",
      title: normalizeString(row.title) ?? "Untitled finding",
      summary: normalizeString(row.summary) ?? "",
      status: coerceFindingStatus(normalizeString(row.status), "draft"),
      confidence: normalizeNumber(row.confidence) ?? 0,
      evidenceSpans: parseJsonArray<EvidenceSpan>(row.evidence_spans),
      detectedBy: coerceFindingSource(normalizeString(row.detected_by), "rules"),
      createdAt: normalizeString(row.created_at) ?? new Date().toISOString(),
      updatedAt:
        normalizeString(row.updated_at) ??
        normalizeString(row.created_at) ??
        new Date().toISOString(),
      reviewDecisionId: normalizeString(row.review_decision_id),
    };
  }

  private mapReviewDecision(row: Record<string, unknown>): ReviewDecision {
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      findingId: String(row.finding_id),
      outcome: coerceReviewDecisionOutcome(
        normalizeString(row.outcome),
        "uncertain"
      ),
      reviewedBy: normalizeString(row.reviewed_by) ?? DESKTOP_ACTOR_ID,
      reviewedAt: normalizeString(row.reviewed_at) ?? new Date().toISOString(),
      rationale: normalizeString(row.rationale),
      editedTitle: normalizeString(row.edited_title),
      editedSummary: normalizeString(row.edited_summary),
      approvedEvidenceSpans: parseJsonArray<EvidenceSpan>(
        row.approved_evidence_spans
      ),
    };
  }

  private mapApprovedExport(row: Record<string, unknown>): ApprovedExport {
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      status: coerceApprovedExportStatus(normalizeString(row.status), "draft"),
      summary: normalizeString(row.summary) ?? "",
      findings: parseJsonArray<ApprovedExport["findings"][number]>(
        row.findings_payload
      ),
      approvedBy: normalizeString(row.approved_by) ?? DESKTOP_ACTOR_ID,
      approvedAt: normalizeString(row.approved_at) ?? new Date().toISOString(),
      destination: normalizeString(row.destination),
      sentAt: normalizeString(row.sent_at),
    };
  }

  private mapModelAssistReceipt(row: Record<string, unknown>): ModelAssistReceipt {
    return {
      id: String(row.id),
      requestId: String(row.request_id),
      sessionId: String(row.session_id),
      findingId: normalizeString(row.finding_id),
      status:
        normalizeString(row.status) === "failed" ? "failed" : "completed",
      policyMode: "minimized_no_raw_phi",
      requestedAt: normalizeString(row.requested_at) ?? new Date().toISOString(),
      completedAt: normalizeString(row.completed_at),
      latencyMs: normalizeNumber(row.latency_ms) ?? undefined,
      errorCode: normalizeString(row.error_code) ?? undefined,
      reviewerAction: coerceModelAssistReviewerAction(
        normalizeString(row.reviewer_action)
      ),
      assessment: parseJsonValue(row.assessment_payload),
    };
  }

  private syncSessionReviewStatus(sessionId: string): void {
    const sessionSummary = this.getSessionSummary(sessionId);
    if (!sessionSummary) {
      return;
    }

    const counts = this.db
      .prepare(
        `SELECT
            COUNT(*) AS total_findings,
            SUM(CASE WHEN status IN ('draft', 'pending_review') THEN 1 ELSE 0 END) AS pending_findings
         FROM findings
         WHERE session_id = ?`
      )
      .get(sessionId) as Record<string, unknown>;

    const totalFindings = normalizeNumber(counts.total_findings) ?? 0;
    const pendingFindings = normalizeNumber(counts.pending_findings) ?? 0;
    const reviewedFindings = totalFindings - pendingFindings;

    let nextReviewStatus = sessionSummary.session.reviewStatus;
    if (totalFindings === 0) {
      nextReviewStatus =
        sessionSummary.session.transcriptStatus === "completed"
          ? "completed"
          : "not_started";
    } else {
      if (reviewedFindings === 0) {
        nextReviewStatus = "ready";
      } else if (pendingFindings > 0) {
        nextReviewStatus = "in_review";
      } else {
        nextReviewStatus = "completed";
      }
    }

    if (
      nextReviewStatus !== sessionSummary.session.reviewStatus
    ) {
      this.updateSession(sessionId, {
        reviewStatus: nextReviewStatus,
      });
    }
  }

  private clearDerivedReviewArtifacts(sessionId: string): void {
    this.db.prepare("DELETE FROM approved_exports WHERE session_id = ?").run(sessionId);
    this.db.prepare("DELETE FROM review_decisions WHERE session_id = ?").run(sessionId);
    this.db.prepare("DELETE FROM findings WHERE session_id = ?").run(sessionId);
    this.db.prepare("DELETE FROM model_assist_receipts WHERE session_id = ?").run(sessionId);
  }

  private mapSession(row: Record<string, unknown>): ReviewSession {
    const createdAt =
      normalizeString(row.created_at) ?? new Date().toISOString();
    const updatedAt = normalizeString(row.updated_at) ?? createdAt;
    const encounterStartedAt =
      normalizeString(row.encounter_started_at) ??
      normalizeString(row.start_time) ??
      createdAt;
    const encounterEndedAt =
      normalizeString(row.encounter_ended_at) ?? normalizeString(row.end_time);
    const audioPath = normalizeString(row.audio_path);

    return {
      id: String(row.id),
      clinicianId:
        normalizeString(row.clinician_id) ??
        normalizeString(row.doctor_id) ??
        "unassigned-clinician",
      organizationId: normalizeString(row.organization_id),
      encounterStartedAt,
      encounterEndedAt,
      captureMode: coerceCaptureMode(
        normalizeString(row.capture_mode),
        audioPath ? "audio_import" : "live_capture"
      ),
      transcriptStatus: coerceTranscriptStatus(
        normalizeString(row.transcript_status),
        "not_started"
      ),
      reviewStatus: coerceReviewStatus(
        normalizeString(row.review_status),
        "not_started"
      ),
      exportStatus: coerceExportStatus(
        normalizeString(row.export_status),
        "not_requested"
      ),
      createdAt,
      updatedAt,
      consent: {
        recordedWithConsent: normalizeBoolean(row.consent_recorded),
        exportAllowed: normalizeBoolean(row.consent_export_allowed),
        remoteAssistAllowed: normalizeBoolean(row.consent_remote_assist_allowed),
        policyVersion:
          normalizeString(row.consent_policy_version) ?? "local-only-v1",
        capturedAt: normalizeString(row.consent_captured_at),
        capturedBy: normalizeString(row.consent_captured_by),
      },
    };
  }

  private mapTranscriptSegment(row: Record<string, unknown>): TranscriptSegment {
    const startOffsetMs =
      normalizeNumber(row.start_offset_ms) ??
      Math.round((normalizeNumber(row.start_time) ?? 0) * 1000);
    const endOffsetMs =
      normalizeNumber(row.end_offset_ms) ??
      Math.round((normalizeNumber(row.end_time) ?? 0) * 1000);

    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      speakerLabel: coerceSpeakerLabel(
        normalizeString(row.speaker_label) ?? normalizeString(row.speaker),
        "unknown"
      ),
      text: normalizeString(row.text) ?? "",
      startOffsetMs,
      endOffsetMs,
      transcriptConfidence:
        normalizeNumber(row.transcript_confidence) ??
        normalizeNumber(row.confidence),
      speakerConfidence: normalizeNumber(row.speaker_confidence),
      source: coerceTranscriptSource(
        normalizeString(row.source),
        "live_capture"
      ),
    };
  }

  private mapAuditLogEntry(row: Record<string, unknown>): AuditLogEntry {
    return {
      id: String(row.id),
      sessionId: normalizeString(row.session_id) ?? "",
      timestamp: normalizeString(row.timestamp) ?? new Date().toISOString(),
      action: coerceAuditAction(
        normalizeString(row.action),
        "session_created"
      ),
      actorId: normalizeString(row.actor_id),
      details: parseJsonObject(row.details),
    };
  }

  private ensureColumn(
    tableName: string,
    columnName: string,
    definition: string
  ): void {
    const columns = this.db
      .prepare(`PRAGMA table_info(${tableName})`)
      .all() as Array<{ name: string }>;

    if (columns.some((column) => column.name === columnName)) {
      return;
    }

    this.db.exec(
      `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`
    );
  }
}

function shouldAutoSeedDemoData(): boolean {
  const disabled = process.env.DOCTOR_AUDITOR_DISABLE_DEMO_SEED;
  if (disabled === "1" || disabled === "true") {
    return false;
  }

  return !process.env.VITEST && process.env.NODE_ENV !== "test";
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeBoolean(value: unknown): boolean {
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

function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseJsonArray<T>(value: unknown): T[] {
  if (typeof value !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function parseJsonValue<T>(value: unknown): T | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed === null ? undefined : (parsed as T);
  } catch {
    return undefined;
  }
}

function coerceCaptureMode(
  value: string | undefined,
  fallback: CaptureMode
): CaptureMode {
  return value === "audio_import" ||
    value === "live_capture" ||
    value === "manual_entry"
    ? value
    : fallback;
}

function coerceTranscriptStatus(
  value: string | undefined,
  fallback: TranscriptStatus
): TranscriptStatus {
  return value === "not_started" ||
    value === "in_progress" ||
    value === "completed" ||
    value === "failed"
    ? value
    : fallback;
}

function coerceReviewStatus(
  value: string | undefined,
  fallback: ReviewStatus
): ReviewStatus {
  return value === "not_started" ||
    value === "ready" ||
    value === "in_review" ||
    value === "completed"
    ? value
    : fallback;
}

function coerceExportStatus(
  value: string | undefined,
  fallback: ExportStatus
): ExportStatus {
  return value === "not_requested" ||
    value === "draft" ||
    value === "approved" ||
    value === "sent"
    ? value
    : fallback;
}

function coerceApprovedExportStatus(
  value: string | undefined,
  fallback: ApprovedExport["status"]
): ApprovedExport["status"] {
  return value === "draft" || value === "approved" || value === "sent"
    ? value
    : fallback;
}

function coerceFindingStatus(
  value: string | undefined,
  fallback: FindingStatus
): FindingStatus {
  return value === "draft" ||
    value === "pending_review" ||
    value === "accepted" ||
    value === "rejected" ||
    value === "uncertain" ||
    value === "revised"
    ? value
    : fallback;
}

function coerceFindingSource(
  value: string | undefined,
  fallback: Finding["detectedBy"]
): Finding["detectedBy"] {
  return value === "rules" ||
    value === "local_llm" ||
    value === "cloud_llm" ||
    value === "human"
    ? value
    : fallback;
}

function coerceReviewDecisionOutcome(
  value: string | undefined,
  fallback: ReviewDecisionOutcome
): ReviewDecisionOutcome {
  return value === "accepted" ||
    value === "rejected" ||
    value === "uncertain" ||
    value === "edited"
    ? value
    : fallback;
}

function reviewStatusFromOutcome(
  outcome: ReviewDecisionOutcome
): FindingStatus {
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

function coerceSpeakerLabel(
  value: string | undefined,
  fallback: TranscriptSpeakerLabel
): TranscriptSpeakerLabel {
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

function coerceTranscriptSource(
  value: string | undefined,
  fallback: TranscriptSegment["source"]
): TranscriptSegment["source"] {
  return value === "audio_import" ||
    value === "live_capture" ||
    value === "manual_edit"
    ? value
    : fallback;
}

function coerceAuditAction(
  value: string | undefined,
  fallback: AuditLogEntry["action"]
): AuditLogEntry["action"] {
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

function coerceModelAssistReviewerAction(
  value: string | undefined
): ModelAssistReceipt["reviewerAction"] | undefined {
  return value === "accepted" ||
    value === "dismissed" ||
    value === "not_applied"
    ? value
    : undefined;
}
