import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import type {
  AuditLogEntry,
  CaptureMode,
  ExportStatus,
  ReviewSession,
  ReviewStatus,
  TranscriptSegment,
  TranscriptSpeakerLabel,
  TranscriptStatus,
} from "@doctor-auditor/shared";
import type {
  DesktopSessionBundle,
  DesktopSessionSummary,
  ImportSessionRequest,
} from "./review-models";

const DESKTOP_ACTOR_ID = "desktop";

export class LocalDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initializeSchema();
  }

  createImportedSession(
    input: ImportSessionRequest & {
      audioPath: string;
      capturedAt: string;
      sourceFileName: string;
    }
  ): DesktopSessionSummary {
    const now = new Date().toISOString();
    const session: ReviewSession = {
      id: uuidv4(),
      clinicianId: input.clinicianId,
      encounterStartedAt: input.capturedAt,
      encounterEndedAt: input.capturedAt,
      captureMode: "audio_import",
      transcriptStatus: "not_started",
      reviewStatus: "not_started",
      exportStatus: "not_requested",
      createdAt: now,
      updatedAt: now,
      consent: {
        recordedWithConsent: input.recordedWithConsent,
        exportAllowed: input.exportAllowed,
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
          consent_captured_at,
          consent_captured_by,
          audio_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        session.consent.capturedAt ?? null,
        session.consent.capturedBy ?? null,
        input.audioPath
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
    this.addAuditLog({
      sessionId: session.id,
      action: "audio_imported",
      actorId: DESKTOP_ACTOR_ID,
      details: {
        fileName: input.sourceFileName,
        audioPath: input.audioPath,
      },
    });

    return {
      session,
      audioPath: input.audioPath,
      transcriptSegmentCount: 0,
    };
  }

  createLiveCaptureSession(
    input: ImportSessionRequest & {
      audioPath: string;
      capturedAt: string;
    }
  ): DesktopSessionSummary {
    const now = new Date().toISOString();
    const session: ReviewSession = {
      id: uuidv4(),
      clinicianId: input.clinicianId,
      encounterStartedAt: input.capturedAt,
      captureMode: "live_capture",
      transcriptStatus: "in_progress",
      reviewStatus: "not_started",
      exportStatus: "not_requested",
      createdAt: now,
      updatedAt: now,
      consent: {
        recordedWithConsent: input.recordedWithConsent,
        exportAllowed: input.exportAllowed,
        capturedAt: now,
        capturedBy: DESKTOP_ACTOR_ID,
      },
    };

    this.insertSession(session, input.audioPath);

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

    return {
      session: this.mapSession(sessionRow),
      transcriptSegments: transcriptRows.map((row) =>
        this.mapTranscriptSegment(row)
      ),
      findings: [],
      reviewDecisions: [],
      approvedExports: [],
      auditLogEntries: auditRows.map((row) => this.mapAuditLogEntry(row)),
      audioPath: normalizeString(sessionRow.audio_path),
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

  completeLiveCaptureSession(
    sessionId: string,
    completedAt: string
  ): DesktopSessionSummary | null {
    const transcriptSegmentCount = this.getTranscriptSegmentCount(sessionId);
    const transcriptStatus: TranscriptStatus =
      transcriptSegmentCount > 0 ? "completed" : "not_started";
    const reviewStatus: ReviewStatus =
      transcriptStatus === "completed" ? "ready" : "not_started";

    this.db
      .prepare(
        `UPDATE sessions
         SET encounter_ended_at = ?, updated_at = ?, transcript_status = ?, review_status = ?
         WHERE id = ?`
      )
      .run(
        completedAt,
        completedAt,
        transcriptStatus,
        reviewStatus,
        sessionId
      );

    const row = this.getSessionSummaryRow(sessionId);
    if (!row) {
      return null;
    }

    return this.mapSessionSummary(row);
  }

  close(): void {
    this.db.close();
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

      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        action TEXT NOT NULL,
        actor_id TEXT,
        details TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_segments_session ON transcript_segments(session_id);
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
    this.ensureColumn("sessions", "consent_captured_at", "TEXT");
    this.ensureColumn("sessions", "consent_captured_by", "TEXT");
    this.ensureColumn("sessions", "audio_path", "TEXT");

    this.ensureColumn("transcript_segments", "speaker_label", "TEXT");
    this.ensureColumn("transcript_segments", "start_offset_ms", "INTEGER");
    this.ensureColumn("transcript_segments", "end_offset_ms", "INTEGER");
    this.ensureColumn("transcript_segments", "transcript_confidence", "REAL");
    this.ensureColumn("transcript_segments", "speaker_confidence", "REAL");
    this.ensureColumn("transcript_segments", "source", "TEXT");

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

  private insertSession(session: ReviewSession, audioPath?: string): void {
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
          consent_captured_at,
          consent_captured_by,
          audio_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        session.consent.capturedAt ?? null,
        session.consent.capturedBy ?? null,
        audioPath ?? null
      );
  }

  private getSessionSummaryRow(
    sessionId: string
  ): Record<string, unknown> | undefined {
    return this.db
      .prepare(
        `SELECT s.*, COUNT(ts.id) AS transcript_segment_count
         FROM sessions s
         LEFT JOIN transcript_segments ts ON ts.session_id = s.id
         WHERE s.id = ?
         GROUP BY s.id`
      )
      .get(sessionId) as Record<string, unknown> | undefined;
  }

  private getTranscriptSegmentCount(sessionId: string): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS transcript_segment_count FROM transcript_segments WHERE session_id = ?"
      )
      .get(sessionId) as Record<string, unknown> | undefined;

    return normalizeNumber(row?.transcript_segment_count) ?? 0;
  }

  private mapSessionSummary(row: Record<string, unknown>): DesktopSessionSummary {
    return {
      session: this.mapSession(row),
      audioPath: normalizeString(row.audio_path),
      transcriptSegmentCount: normalizeNumber(row.transcript_segment_count) ?? 0,
    };
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
    value === "export_approved" ||
    value === "export_sent"
    ? value
    : fallback;
}
