import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "path";
import { AudioCapture } from "./audio-capture";
import { LocalDatabase } from "./database";
import { TranscriptionService } from "./transcription";
import { RiskAnalyzer } from "./risk-analyzer";

let mainWindow: BrowserWindow | null = null;
let audioCapture: AudioCapture | null = null;
let db: LocalDatabase | null = null;
let transcription: TranscriptionService | null = null;
let riskAnalyzer: RiskAnalyzer | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: "Doctor Auditor",
  });

  if (process.env.NODE_ENV === "development") {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function initializeServices(): Promise<void> {
  const userDataPath = app.getPath("userData");

  db = new LocalDatabase(path.join(userDataPath, "doctor-auditor.db"));
  audioCapture = new AudioCapture();
  transcription = new TranscriptionService();
  riskAnalyzer = new RiskAnalyzer();
}

function registerIpcHandlers(): void {
  ipcMain.handle("audio:start-recording", async () => {
    if (!audioCapture) throw new Error("Audio capture not initialized");
    return audioCapture.startRecording();
  });

  ipcMain.handle("audio:stop-recording", async () => {
    if (!audioCapture) throw new Error("Audio capture not initialized");
    return audioCapture.stopRecording();
  });

  ipcMain.handle("audio:get-devices", async () => {
    if (!audioCapture) throw new Error("Audio capture not initialized");
    return audioCapture.getDevices();
  });

  ipcMain.handle("session:get-all", async () => {
    if (!db) throw new Error("Database not initialized");
    return db.getAllSessions();
  });

  ipcMain.handle("session:get", async (_event, sessionId: string) => {
    if (!db) throw new Error("Database not initialized");
    return db.getSession(sessionId);
  });

  ipcMain.handle("analysis:get-risk", async (_event, sessionId: string) => {
    if (!db) throw new Error("Database not initialized");
    return db.getRiskAssessment(sessionId);
  });

  ipcMain.handle(
    "settings:set-cloud-consent",
    async (_event, consent: boolean) => {
      if (!riskAnalyzer) throw new Error("Risk analyzer not initialized");
      riskAnalyzer.setCloudConsent(consent);
      return true;
    }
  );
}

app.whenReady().then(async () => {
  await initializeServices();
  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
