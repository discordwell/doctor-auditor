import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import type {
  LocalSession,
  TranscriptSegment,
  RiskAssessment,
  AuditLogEntry,
} from "@doctor-auditor/shared";

export class LocalDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    // Enable WAL mode for better concurrent read performance
    this.db.pragma("journal_mode = WAL");
    this.initializeSchema();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        doctor_id TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT,
        audio_path TEXT,
        cloud_analysis_consent INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS transcript_segments (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        speaker TEXT NOT NULL,
        text TEXT NOT NULL,
        start_time REAL NOT NULL,
        end_time REAL NOT NULL,
        confidence REAL NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE TABLE IF NOT EXISTS risk_assessments (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL UNIQUE,
        doctor_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        duration REAL NOT NULL,
        communication_score REAL NOT NULL,
        communication_flags TEXT NOT NULL,
        clinical_score REAL NOT NULL,
        clinical_flags TEXT NOT NULL,
        behavioral_score REAL NOT NULL,
        behavioral_flags TEXT NOT NULL,
        overall_score REAL NOT NULL,
        overall_risk TEXT NOT NULL,
        analysis_source TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        action TEXT NOT NULL,
        details TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_segments_session ON transcript_segments(session_id);
      CREATE INDEX IF NOT EXISTS idx_assessments_doctor ON risk_assessments(doctor_id);
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
    `);
  }

  createSession(doctorId: string, audioPath?: string): string {
    const id = uuidv4();
    const startTime = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO sessions (id, doctor_id, start_time, audio_path)
       VALUES (?, ?, ?, ?)`
      )
      .run(id, doctorId, startTime, audioPath ?? null);

    this.addAuditLog("session_started", { sessionId: id, doctorId });
    return id;
  }

  endSession(sessionId: string): void {
    const endTime = new Date().toISOString();
    this.db
      .prepare("UPDATE sessions SET end_time = ? WHERE id = ?")
      .run(endTime, sessionId);

    this.addAuditLog("session_ended", { sessionId });
  }

  addTranscriptSegment(sessionId: string, segment: TranscriptSegment): void {
    const id = uuidv4();
    this.db
      .prepare(
        `INSERT INTO transcript_segments (id, session_id, speaker, text, start_time, end_time, confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        sessionId,
        segment.speaker,
        segment.text,
        segment.startTime,
        segment.endTime,
        segment.confidence
      );
  }

  saveRiskAssessment(assessment: RiskAssessment): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO risk_assessments
       (id, session_id, doctor_id, timestamp, duration,
        communication_score, communication_flags,
        clinical_score, clinical_flags,
        behavioral_score, behavioral_flags,
        overall_score, overall_risk, analysis_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        assessment.id,
        assessment.sessionId,
        assessment.doctorId,
        assessment.timestamp,
        assessment.duration,
        assessment.communication.score,
        JSON.stringify(assessment.communication.flags),
        assessment.clinical.score,
        JSON.stringify(assessment.clinical.flags),
        assessment.behavioral.score,
        JSON.stringify(assessment.behavioral.flags),
        assessment.overallScore,
        assessment.overallRisk,
        assessment.analysisSource
      );

    this.addAuditLog("assessment_generated", {
      sessionId: assessment.sessionId,
      overallRisk: assessment.overallRisk,
    });
  }

  getSession(sessionId: string): LocalSession | null {
    const session = this.db
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(sessionId) as Record<string, unknown> | undefined;

    if (!session) return null;

    this.addAuditLog("transcript_accessed", { sessionId });

    const segments = this.db
      .prepare(
        "SELECT * FROM transcript_segments WHERE session_id = ? ORDER BY start_time"
      )
      .all(sessionId) as Record<string, unknown>[];

    const assessment = this.getRiskAssessment(sessionId);

    return {
      id: session.id as string,
      doctorId: session.doctor_id as string,
      startTime: session.start_time as string,
      endTime: (session.end_time as string) ?? undefined,
      transcript: segments.map((s) => ({
        speaker: s.speaker as TranscriptSegment["speaker"],
        text: s.text as string,
        startTime: s.start_time as number,
        endTime: s.end_time as number,
        confidence: s.confidence as number,
      })),
      riskAssessment: assessment ?? undefined,
      audioPath: (session.audio_path as string) ?? undefined,
      cloudAnalysisConsent: Boolean(session.cloud_analysis_consent),
    };
  }

  getAllSessions(): Omit<LocalSession, "transcript">[] {
    const sessions = this.db
      .prepare("SELECT * FROM sessions ORDER BY start_time DESC")
      .all() as Record<string, unknown>[];

    return sessions.map((s) => ({
      id: s.id as string,
      doctorId: s.doctor_id as string,
      startTime: s.start_time as string,
      endTime: (s.end_time as string) ?? undefined,
      transcript: [],
      audioPath: (s.audio_path as string) ?? undefined,
      cloudAnalysisConsent: Boolean(s.cloud_analysis_consent),
    }));
  }

  getRiskAssessment(sessionId: string): RiskAssessment | null {
    const row = this.db
      .prepare("SELECT * FROM risk_assessments WHERE session_id = ?")
      .get(sessionId) as Record<string, unknown> | undefined;

    if (!row) return null;

    return {
      id: row.id as string,
      sessionId: row.session_id as string,
      doctorId: row.doctor_id as string,
      timestamp: row.timestamp as string,
      duration: row.duration as number,
      communication: {
        score: row.communication_score as number,
        flags: JSON.parse(row.communication_flags as string),
      },
      clinical: {
        score: row.clinical_score as number,
        flags: JSON.parse(row.clinical_flags as string),
      },
      behavioral: {
        score: row.behavioral_score as number,
        flags: JSON.parse(row.behavioral_flags as string),
      },
      overallScore: row.overall_score as number,
      overallRisk: row.overall_risk as "high" | "medium" | "low",
      analysisSource: row.analysis_source as "local" | "cloud" | "hybrid",
    };
  }

  private addAuditLog(
    action: AuditLogEntry["action"],
    details: Record<string, unknown>
  ): void {
    const id = uuidv4();
    this.db
      .prepare("INSERT INTO audit_log (id, action, details) VALUES (?, ?, ?)")
      .run(id, action, JSON.stringify(details));
  }

  close(): void {
    this.db.close();
  }
}
