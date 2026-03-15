import { app, BrowserWindow, dialog, ipcMain } from "electron";
import * as fs from "fs/promises";
import * as path from "path";
import { AudioCapture } from "./audio-capture";
import { LocalDatabase } from "./database";
import type { ImportSessionRequest } from "./review-models";

let mainWindow: BrowserWindow | null = null;
let audioCapture: AudioCapture | null = null;
let db: LocalDatabase | null = null;

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
  audioCapture.on("level", (level: number) => {
    mainWindow?.webContents.send("audio:level", level);
  });
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

  ipcMain.handle(
    "session:import-audio",
    async (_event, request?: ImportSessionRequest) => {
      if (!mainWindow) throw new Error("Main window not initialized");
      if (!db) throw new Error("Database not initialized");
      if (!request) {
        throw new Error("Import details are required before selecting audio.");
      }

      const clinicianId = request.clinicianId.trim();
      if (!clinicianId) {
        throw new Error("Add a clinician label before importing audio.");
      }

      if (!request.recordedWithConsent) {
        throw new Error("Confirm recorded consent before importing audio.");
      }

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
        const sourceStats = await fs.stat(sourcePath);
        await fs.copyFile(sourcePath, targetPath);

        emitImportProgress({
          stage: "creating-session",
          message: "Creating a review session shell.",
          fileName,
        });
        const session = db.createImportedSession({
          clinicianId,
          recordedWithConsent: request.recordedWithConsent,
          exportAllowed: request.exportAllowed,
          audioPath: targetPath,
          capturedAt: sourceStats.mtime.toISOString(),
          sourceFileName: fileName,
        });

        emitImportProgress({
          stage: "completed",
          message: "Import complete. Review session shell is ready.",
          fileName,
          sessionId: session.session.id,
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
