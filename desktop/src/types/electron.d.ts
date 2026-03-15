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
  };
  analysis: {
    getRisk: (
      sessionId: string
    ) => Promise<unknown>;
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
