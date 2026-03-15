import { contextBridge, ipcRenderer } from "electron";
import type {
  DesktopSessionSummary,
  LiveCaptureError,
  LiveCaptureStatus,
  PersistReviewDecisionRequest,
  SessionImportProgress,
  SessionIntakeRequest,
} from "../src/types/electron";

contextBridge.exposeInMainWorld("doctorAuditor", {
  audio: {
    startRecording: (request: SessionIntakeRequest) =>
      ipcRenderer.invoke("audio:start-recording", request),
    stopRecording: () => ipcRenderer.invoke("audio:stop-recording"),
    getDevices: () => ipcRenderer.invoke("audio:get-devices"),
    getCaptureStatus: () =>
      ipcRenderer.invoke("audio:get-capture-status") as Promise<LiveCaptureStatus>,
    onAudioLevel: (callback: (level: number) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, level: number) => {
        callback(level);
      };

      ipcRenderer.on("audio:level", listener);
      return () => {
        ipcRenderer.removeListener("audio:level", listener);
      };
    },
    onCaptureError: (callback: (error: LiveCaptureError) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        error: LiveCaptureError
      ) => {
        callback(error);
      };

      ipcRenderer.on("audio:capture-error", listener);
      return () => {
        ipcRenderer.removeListener("audio:capture-error", listener);
      };
    },
  },
  session: {
    getAll: () => ipcRenderer.invoke("session:get-all"),
    get: (sessionId: string) => ipcRenderer.invoke("session:get", sessionId),
    saveReviewDecision: (request: PersistReviewDecisionRequest) =>
      ipcRenderer.invoke("session:save-review-decision", request),
    importAudio: (request: SessionIntakeRequest) =>
      ipcRenderer.invoke("session:import-audio", request),
    onImportProgress: (
      callback: (update: SessionImportProgress) => void
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        update: SessionImportProgress
      ) => callback(update);

      ipcRenderer.on("session:import-progress", listener);
      return () => {
        ipcRenderer.removeListener("session:import-progress", listener);
      };
    },
    onSessionChanged: (
      callback: (sessionSummary: DesktopSessionSummary) => void
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        sessionSummary: DesktopSessionSummary
      ) => callback(sessionSummary);

      ipcRenderer.on("session:changed", listener);
      return () => {
        ipcRenderer.removeListener("session:changed", listener);
      };
    },
  },
});
