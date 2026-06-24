import type { ApprovedExportEnvelope } from "@doctor-auditor/shared/cloud";
import type {
  EvidenceSpan,
  ModelAssistReceipt,
  ReviewDecisionOutcome,
  ReviewSession,
  SessionBundle,
} from "@doctor-auditor/shared/local-review";

export interface SessionIntakeRequest {
  clinicianId: string;
  recordedWithConsent: boolean;
  exportAllowed: boolean;
  remoteAssistAllowed: boolean;
  policyVersion: string;
}

export interface DesktopSessionSummary {
  session: ReviewSession;
  audioPath?: string;
  transcriptSegmentCount: number;
}

export interface DesktopSessionBundle extends SessionBundle {
  audioPath?: string;
}

export type RetryTranscriptionResult = DesktopSessionSummary | null;

export interface PersistReviewDecisionRequest {
  sessionId: string;
  findingId: string;
  outcome: ReviewDecisionOutcome;
  rationale?: string;
  editedTitle?: string;
  editedSummary?: string;
  approvedEvidenceSpans?: EvidenceSpan[];
}

export interface RequestSeriousnessAssistRequest {
  sessionId: string;
  findingId?: string;
}

export interface RequestSeriousnessAssistResult {
  bundle: DesktopSessionBundle | null;
  receipt: ModelAssistReceipt;
  synced: boolean;
  syncError?: string;
}

export interface UpdateModelAssistActionRequest {
  sessionId: string;
  receiptId: string;
  reviewerAction: NonNullable<ModelAssistReceipt["reviewerAction"]>;
}

export interface UpdateModelAssistActionResult {
  bundle: DesktopSessionBundle;
  synced: boolean;
  syncError?: string;
}

export interface CreateApprovedExportRequest {
  sessionId: string;
  destination?: string;
  status?: "approved" | "sent";
}

export interface CreateApprovedExportResult {
  bundle: DesktopSessionBundle | null;
  envelope: ApprovedExportEnvelope;
  synced: boolean;
  syncError?: string;
}

export interface AudioDevice {
  id: string;
  name: string;
  isDefault: boolean;
}

export type RecorderBackend = "sox" | "rec";

export type MicrophoneAccessStatus =
  | "not-determined"
  | "granted"
  | "denied"
  | "restricted"
  | "unknown"
  | "unsupported";

export interface LiveCaptureStatus {
  available: boolean;
  experimental: boolean;
  recorder: RecorderBackend | null;
  microphoneAccess: MicrophoneAccessStatus;
  issues: string[];
  notes: string[];
}

export type CloudSyncConfigSource = "environment_override" | "hosted_default";

export interface CloudSyncDisplayConfig {
  apiBaseUrl: string;
  apiBaseUrlSource: CloudSyncConfigSource;
  email: string;
  role: string;
  organizationId: string;
}

export interface LiveCaptureError {
  message: string;
  session: DesktopSessionSummary | null;
}

export interface StartRecordingResult {
  sessionPath: string;
  session: DesktopSessionSummary;
}

export interface StopRecordingResult {
  filePath: string;
  duration: number;
  session: DesktopSessionSummary | null;
}

export interface SessionImportProgress {
  stage: "selected" | "copying" | "creating-session" | "completed" | "error";
  message: string;
  fileName?: string;
  sessionId?: string;
}

export interface DoctorAuditorAPI {
  audio: {
    startRecording: (
      request: SessionIntakeRequest
    ) => Promise<StartRecordingResult>;
    stopRecording: () => Promise<StopRecordingResult>;
    getDevices: () => Promise<AudioDevice[]>;
    getCaptureStatus: () => Promise<LiveCaptureStatus>;
    onAudioLevel: (callback: (level: number) => void) => () => void;
    onCaptureError: (callback: (error: LiveCaptureError) => void) => () => void;
  };
  cloud: {
    getConfiguration: () => Promise<CloudSyncDisplayConfig>;
  };
  session: {
    getAll: () => Promise<DesktopSessionSummary[]>;
    get: (sessionId: string) => Promise<DesktopSessionBundle | null>;
    retryTranscription: (
      sessionId: string
    ) => Promise<RetryTranscriptionResult>;
    delete: (sessionId: string) => Promise<void>;
    saveReviewDecision: (
      request: PersistReviewDecisionRequest
    ) => Promise<DesktopSessionBundle | null>;
    requestSeriousnessAssist: (
      request: RequestSeriousnessAssistRequest
    ) => Promise<RequestSeriousnessAssistResult>;
    updateModelAssistAction: (
      request: UpdateModelAssistActionRequest
    ) => Promise<UpdateModelAssistActionResult>;
    createApprovedExport: (
      request: CreateApprovedExportRequest
    ) => Promise<CreateApprovedExportResult>;
    importAudio: (
      request: SessionIntakeRequest
    ) => Promise<
      | { cancelled: true }
      | { cancelled: false; session: DesktopSessionSummary }
    >;
    onImportProgress: (
      callback: (update: SessionImportProgress) => void
    ) => () => void;
    onSessionChanged: (
      callback: (sessionSummary: DesktopSessionSummary) => void
    ) => () => void;
  };
}

declare global {
  interface Window {
    doctorAuditor: DoctorAuditorAPI;
  }
}
