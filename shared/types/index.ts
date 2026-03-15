// Risk assessment types shared between desktop app and cloud dashboard

export type RiskLevel = "high" | "medium" | "low";

export interface RiskCategoryScore {
  score: number; // 1-10
  flags: string[]; // specific issues detected
}

export interface RiskAssessment {
  id: string;
  sessionId: string;
  doctorId: string;
  timestamp: string; // ISO 8601
  duration: number; // seconds

  communication: RiskCategoryScore;
  clinical: RiskCategoryScore;
  behavioral: RiskCategoryScore;

  overallScore: number; // 1-10 weighted average
  overallRisk: RiskLevel;

  analysisSource: "local" | "cloud" | "hybrid";
}

/** De-identified payload sent from desktop to cloud server */
export interface DeidentifiedAssessment {
  sessionId: string;
  doctorId: string;
  timestamp: string;
  duration: number;

  communication: RiskCategoryScore;
  clinical: RiskCategoryScore;
  behavioral: RiskCategoryScore;

  overallScore: number;
  overallRisk: RiskLevel;
  analysisSource: "local" | "cloud" | "hybrid";
}

/** Transcript segment with speaker label (LOCAL ONLY — never sent to server) */
export interface TranscriptSegment {
  speaker: "doctor" | "patient" | "unknown";
  text: string;
  startTime: number; // seconds from session start
  endTime: number;
  confidence: number; // 0-1
}

/** Full session stored locally */
export interface LocalSession {
  id: string;
  doctorId: string;
  startTime: string;
  endTime?: string;
  transcript: TranscriptSegment[];
  riskAssessment?: RiskAssessment;
  audioPath?: string; // local file path to encrypted audio
  cloudAnalysisConsent: boolean;
}

/** Audit log entry (LOCAL ONLY) */
export interface AuditLogEntry {
  id: string;
  timestamp: string;
  action:
    | "session_started"
    | "session_ended"
    | "transcript_accessed"
    | "audio_accessed"
    | "assessment_generated"
    | "data_sent_to_cloud"
    | "cloud_analysis_requested";
  details: Record<string, unknown>;
}

/** User roles for the cloud dashboard */
export type UserRole = "underwriter" | "admin";

export interface DashboardUser {
  id: string;
  email: string;
  role: UserRole;
  organizationId: string;
}

/** Doctor profile (de-identified on server, full details local) */
export interface DoctorProfile {
  id: string;
  specialty?: string;
  departmentId?: string;
  organizationId: string;
}

/** Trend data for dashboard charts */
export interface RiskTrend {
  doctorId: string;
  period: string; // ISO date
  avgCommunication: number;
  avgClinical: number;
  avgBehavioral: number;
  avgOverall: number;
  sessionCount: number;
}
