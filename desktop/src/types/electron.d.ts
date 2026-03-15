import type { ReviewSession, SessionBundle } from "@doctor-auditor/shared";

export interface SessionIntakeRequest {
  clinicianId: string;
  recordedWithConsent: boolean;
  exportAllowed: boolean;
}

export interface DesktopSessionSummary {
  session: ReviewSession;
  audioPath?: string;
  transcriptSegmentCount: number;
}

export interface DesktopSessionBundle extends SessionBundle {
  audioPath?: string;
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

export interface LiveCaptureError {
  message: string;
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
    ) => Promise<{ sessionPath: string; session: DesktopSessionSummary }>;
    stopRecording: () => Promise<{
      filePath: string;
      duration: number;
      session: DesktopSessionSummary | null;
    }>;
    getDevices: () => Promise<AudioDevice[]>;
    getCaptureStatus: () => Promise<LiveCaptureStatus>;
    onAudioLevel: (callback: (level: number) => void) => () => void;
    onCaptureError: (callback: (error: LiveCaptureError) => void) => () => void;
  };
  session: {
    getAll: () => Promise<DesktopSessionSummary[]>;
    get: (sessionId: string) => Promise<DesktopSessionBundle | null>;
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
