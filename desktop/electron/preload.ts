import { contextBridge, ipcRenderer } from "electron";
import type {
  ImportSessionRequest,
  SessionImportProgress,
} from "../src/types/electron";

contextBridge.exposeInMainWorld("doctorAuditor", {
  audio: {
    startRecording: () => ipcRenderer.invoke("audio:start-recording"),
    stopRecording: () => ipcRenderer.invoke("audio:stop-recording"),
    getDevices: () => ipcRenderer.invoke("audio:get-devices"),
    onAudioLevel: (callback: (level: number) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, level: number) => {
        callback(level);
      };

      ipcRenderer.on("audio:level", listener);
      return () => {
        ipcRenderer.removeListener("audio:level", listener);
      };
    },
  },
  session: {
    getAll: () => ipcRenderer.invoke("session:get-all"),
    get: (sessionId: string) => ipcRenderer.invoke("session:get", sessionId),
    importAudio: (request: ImportSessionRequest) =>
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
  },
});
