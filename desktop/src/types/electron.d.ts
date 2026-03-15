import type { ReviewSession, SessionBundle } from "@doctor-auditor/shared";

export interface DesktopSessionSummary {
  session: ReviewSession;
  audioPath?: string;
  transcriptSegmentCount: number;
}

export interface DesktopSessionBundle extends SessionBundle {
  audioPath?: string;
}

export interface ImportSessionRequest {
  clinicianId: string;
  recordedWithConsent: boolean;
  exportAllowed: boolean;
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
      request: ImportSessionRequest
    ) => Promise<DesktopSessionSummary>;
    stopRecording: () => Promise<{
      filePath: string;
      duration: number;
      session: DesktopSessionSummary | null;
    }>;
    getDevices: () => Promise<
      Array<{ id: string; name: string; isDefault: boolean }>
    >;
    onAudioLevel: (callback: (level: number) => void) => () => void;
  };
  session: {
    getAll: () => Promise<DesktopSessionSummary[]>;
    get: (sessionId: string) => Promise<DesktopSessionBundle | null>;
    importAudio: (
      request: ImportSessionRequest
    ) => Promise<
      | { cancelled: true }
      | { cancelled: false; session: DesktopSessionSummary }
    >;
    onImportProgress: (
      callback: (update: SessionImportProgress) => void
    ) => () => void;
  };
}

declare global {
  interface Window {
    doctorAuditor: DoctorAuditorAPI;
  }
}
