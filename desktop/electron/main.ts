import { app, BrowserWindow, dialog, ipcMain } from "electron";
import * as fs from "fs/promises";
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

type ImportStage =
  | "selected"
  | "copying"
  | "creating-session"
  | "completed"
  | "error";

interface ImportProgressPayload {
  stage: ImportStage;
  message: string;
  fileName?: string;
  sessionId?: string;
}

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

function emitImportProgress(payload: ImportProgressPayload): void {
  mainWindow?.webContents.send("session:import-progress", payload);
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

  ipcMain.handle("session:import-audio", async (_event, doctorId?: string) => {
    if (!mainWindow) throw new Error("Main window not initialized");
    if (!db) throw new Error("Database not initialized");

    const normalizedDoctorId =
      doctorId?.trim() || "Imported encounter";

    const selection = await dialog.showOpenDialog(mainWindow, {
      title: "Import Encounter Audio",
      properties: ["openFile"],
      filters: [
        {
          name: "Audio Files",
          extensions: ["wav", "mp3", "m4a", "aac", "flac", "ogg", "webm"],
        },
      ],
    });

    if (selection.canceled || selection.filePaths.length === 0) {
      return { cancelled: true as const };
    }

    const sourcePath = selection.filePaths[0];
    const fileName = path.basename(sourcePath);
    const importsDir = path.join(app.getPath("userData"), "imports");
    const extension = path.extname(sourcePath);
    const targetPath = path.join(
      importsDir,
      `import-${Date.now()}${extension.toLowerCase()}`
    );

    emitImportProgress({
      stage: "selected",
      message: "Audio selected. Preparing local copy.",
      fileName,
    });

    try {
      await fs.mkdir(importsDir, { recursive: true });

      emitImportProgress({
        stage: "copying",
        message: "Copying audio into the local workspace.",
        fileName,
      });
      await fs.copyFile(sourcePath, targetPath);

      emitImportProgress({
        stage: "creating-session",
        message: "Creating a local session shell.",
        fileName,
      });
      const session = db.createImportedSession(normalizedDoctorId, targetPath);

      emitImportProgress({
        stage: "completed",
        message: "Import complete. Session shell is ready.",
        fileName,
        sessionId: session.id,
      });

      return {
        cancelled: false as const,
        session,
      };
    } catch (error) {
      emitImportProgress({
        stage: "error",
        message:
          error instanceof Error
            ? error.message
            : "Import failed while preparing the encounter.",
        fileName,
      });
      throw error;
    }
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
