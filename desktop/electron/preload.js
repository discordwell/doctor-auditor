"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld("doctorAuditor", {
    audio: {
        startRecording: (request) => electron_1.ipcRenderer.invoke("audio:start-recording", request),
        stopRecording: () => electron_1.ipcRenderer.invoke("audio:stop-recording"),
        getDevices: () => electron_1.ipcRenderer.invoke("audio:get-devices"),
        getCaptureStatus: () => electron_1.ipcRenderer.invoke("audio:get-capture-status"),
        onAudioLevel: (callback) => {
            const listener = (_event, level) => {
                callback(level);
            };
            electron_1.ipcRenderer.on("audio:level", listener);
            return () => {
                electron_1.ipcRenderer.removeListener("audio:level", listener);
            };
        },
        onCaptureError: (callback) => {
            const listener = (_event, error) => {
                callback(error);
            };
            electron_1.ipcRenderer.on("audio:capture-error", listener);
            return () => {
                electron_1.ipcRenderer.removeListener("audio:capture-error", listener);
            };
        },
    },
    session: {
        getAll: () => electron_1.ipcRenderer.invoke("session:get-all"),
        get: (sessionId) => electron_1.ipcRenderer.invoke("session:get", sessionId),
        saveReviewDecision: (request) => electron_1.ipcRenderer.invoke("session:save-review-decision", request),
        importAudio: (request) => electron_1.ipcRenderer.invoke("session:import-audio", request),
        onImportProgress: (callback) => {
            const listener = (_event, update) => callback(update);
            electron_1.ipcRenderer.on("session:import-progress", listener);
            return () => {
                electron_1.ipcRenderer.removeListener("session:import-progress", listener);
            };
        },
        onSessionChanged: (callback) => {
            const listener = (_event, sessionSummary) => callback(sessionSummary);
            electron_1.ipcRenderer.on("session:changed", listener);
            return () => {
                electron_1.ipcRenderer.removeListener("session:changed", listener);
            };
        },
    },
});
