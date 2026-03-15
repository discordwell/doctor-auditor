export interface ImportedSessionShell {
  id: string;
  doctorId: string;
  startTime: string;
  endTime?: string;
  audioPath?: string;
  cloudAnalysisConsent: boolean;
}

export interface SessionImportProgress {
  stage: "selected" | "copying" | "creating-session" | "completed" | "error";
  message: string;
  fileName?: string;
  sessionId?: string;
}

export interface DoctorAuditorAPI {
  audio: {
    startRecording: () => Promise<{ sessionPath: string }>;
    stopRecording: () => Promise<{ filePath: string; duration: number }>;
    getDevices: () => Promise<
      Array<{ id: string; name: string; isDefault: boolean }>
    >;
    onAudioLevel: (callback: (level: number) => void) => void;
    onTranscriptUpdate: (
      callback: (segment: {
        speaker: string;
        text: string;
        startTime: number;
        endTime: number;
      }) => void
    ) => void;
  };
  session: {
    getAll: () => Promise<unknown[]>;
    get: (sessionId: string) => Promise<unknown>;
    importAudio: (
      doctorId?: string
    ) => Promise<
      | { cancelled: true }
      | { cancelled: false; session: ImportedSessionShell }
    >;
    onImportProgress: (
      callback: (update: SessionImportProgress) => void
    ) => () => void;
  };
  analysis: {
    getRisk: (sessionId: string) => Promise<unknown>;
    onRiskUpdate: (
      callback: (assessment: {
        overallRisk: string;
        overallScore: number;
      }) => void
    ) => void;
  };
  settings: {
    setCloudConsent: (consent: boolean) => Promise<boolean>;
  };
}

declare global {
  interface Window {
    doctorAuditor: DoctorAuditorAPI;
  }
}
