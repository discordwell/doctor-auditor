export interface TranscriptSegment {
  speaker: "doctor" | "patient" | "unknown";
  text: string;
  startTime: number;
  endTime: number;
  confidence: number;
}

export interface RiskCategoryScore {
  score: number;
  flags: string[];
}

export interface RiskAssessment {
  id: string;
  sessionId: string;
  doctorId: string;
  timestamp: string;
  duration: number;
  communication: RiskCategoryScore;
  clinical: RiskCategoryScore;
  behavioral: RiskCategoryScore;
  overallScore: number;
  overallRisk: "high" | "medium" | "low";
  analysisSource: "local" | "cloud" | "hybrid";
}

export interface DeidentifiedAssessment {
  sessionId: string;
  doctorId: string;
  timestamp: string;
  duration: number;
  communication: RiskCategoryScore;
  clinical: RiskCategoryScore;
  behavioral: RiskCategoryScore;
  overallScore: number;
  overallRisk: "high" | "medium" | "low";
  analysisSource: "local" | "cloud" | "hybrid";
}

export interface LocalSession {
  id: string;
  doctorId: string;
  startTime: string;
  endTime?: string;
  transcript: TranscriptSegment[];
  riskAssessment?: RiskAssessment;
  audioPath?: string;
  cloudAnalysisConsent: boolean;
}

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
