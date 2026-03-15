import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("doctorAuditor", {
  audio: {
    startRecording: () => ipcRenderer.invoke("audio:start-recording"),
    stopRecording: () => ipcRenderer.invoke("audio:stop-recording"),
    getDevices: () => ipcRenderer.invoke("audio:get-devices"),
    onAudioLevel: (callback: (level: number) => void) => {
      ipcRenderer.on("audio:level", (_event, level) => callback(level));
    },
    onTranscriptUpdate: (
      callback: (segment: {
        speaker: string;
        text: string;
        startTime: number;
        endTime: number;
      }) => void
    ) => {
      ipcRenderer.on("audio:transcript", (_event, segment) =>
        callback(segment)
      );
    },
  },
  session: {
    getAll: () => ipcRenderer.invoke("session:get-all"),
    get: (sessionId: string) => ipcRenderer.invoke("session:get", sessionId),
  },
  analysis: {
    getRisk: (sessionId: string) =>
      ipcRenderer.invoke("analysis:get-risk", sessionId),
    onRiskUpdate: (
      callback: (assessment: {
        overallRisk: string;
        overallScore: number;
      }) => void
    ) => {
      ipcRenderer.on("analysis:risk-update", (_event, assessment) =>
        callback(assessment)
      );
    },
  },
  settings: {
    setCloudConsent: (consent: boolean) =>
      ipcRenderer.invoke("settings:set-cloud-consent", consent),
  },
});
