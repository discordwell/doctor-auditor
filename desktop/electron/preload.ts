import { contextBridge, ipcRenderer } from "electron";
import type {
  CloudSyncDisplayConfig,
  CreateApprovedExportRequest,
  CreateApprovedExportResult,
  DesktopSessionSummary,
  LiveCaptureError,
  LiveCaptureStatus,
  PersistReviewDecisionRequest,
  RequestSeriousnessAssistRequest,
  RequestSeriousnessAssistResult,
  SessionImportProgress,
  SessionIntakeRequest,
  StartRecordingResult,
  StopRecordingResult,
  UpdateModelAssistActionRequest,
} from "../src/types/electron";

contextBridge.exposeInMainWorld("doctorAuditor", {
  audio: {
    startRecording: (request: SessionIntakeRequest) =>
      ipcRenderer.invoke(
        "audio:start-recording",
        request
      ) as Promise<StartRecordingResult>,
    stopRecording: () =>
      ipcRenderer.invoke("audio:stop-recording") as Promise<StopRecordingResult>,
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
  cloud: {
    getConfiguration: () =>
      ipcRenderer.invoke("cloud:get-config") as Promise<CloudSyncDisplayConfig>,
  },
  session: {
    getAll: () => ipcRenderer.invoke("session:get-all"),
    get: (sessionId: string) => ipcRenderer.invoke("session:get", sessionId),
    saveReviewDecision: (request: PersistReviewDecisionRequest) =>
      ipcRenderer.invoke("session:save-review-decision", request),
    requestSeriousnessAssist: (request: RequestSeriousnessAssistRequest) =>
      ipcRenderer.invoke(
        "session:request-seriousness-assist",
        request
      ) as Promise<RequestSeriousnessAssistResult>,
    updateModelAssistAction: (request: UpdateModelAssistActionRequest) =>
      ipcRenderer.invoke("session:update-model-assist-action", request),
    createApprovedExport: (request: CreateApprovedExportRequest) =>
      ipcRenderer.invoke(
        "session:create-approved-export",
        request
      ) as Promise<CreateApprovedExportResult>,
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
