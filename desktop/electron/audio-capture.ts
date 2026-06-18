import { spawnSync, type ChildProcessWithoutNullStreams } from "child_process";
import { EventEmitter } from "events";
import * as path from "path";
import * as fs from "fs";
import { app, systemPreferences } from "electron";
import type {
  AudioDevice,
  LiveCaptureStatus,
  MicrophoneAccessStatus,
  RecorderBackend,
} from "./review-models";

interface RecorderProcess {
  process?: ChildProcessWithoutNullStreams | null;
  stream(): NodeJS.ReadableStream;
  stop(): void;
}

const AUDIO_BYTES_PER_SECOND = 32000;
const RECORDER_STARTUP_GRACE_MS = 900;
const RECORDER_STOP_TIMEOUT_MS = 3000;
const WAV_HEADER_BYTES = 44;

export class AudioCapture extends EventEmitter {
  private isRecording = false;
  private recordingProcess: RecorderProcess | null = null;
  private recordingStream: NodeJS.ReadableStream | null = null;
  private outputStream: fs.WriteStream | null = null;
  private outputPath: string | null = null;
  private activeRecorder: RecorderBackend | null = null;
  private stopRequested = false;

  async getDevices(): Promise<AudioDevice[]> {
    const status = await this.getCaptureStatus();
    if (!status.available) {
      return [];
    }

    return [
      {
        id: "default",
        name: "System default microphone",
        isDefault: true,
      },
    ];
  }

  async getCaptureStatus(): Promise<LiveCaptureStatus> {
    const recorder = this.resolveRecorderBackend();
    const microphoneAccess = this.getMicrophoneAccessStatus();
    const issues: string[] = [];
    const notes: string[] = [
      "Live recording uses the system default microphone in this build.",
      "Recordings stay local on this machine until you choose an approved export.",
    ];

    if (!recorder) {
      issues.push(
        "Live recording requires a local SoX recorder binary (`sox` or `rec`). Install it before using the microphone."
      );
    } else {
      notes.push(`Recorder ready: ${recorder}.`);
    }

    if (microphoneAccess === "denied" || microphoneAccess === "restricted") {
      issues.push(
        "Microphone access is blocked for the desktop app. Re-enable it in system privacy settings before trying to record again."
      );
    } else if (microphoneAccess === "not-determined") {
      notes.push(
        "The OS may still prompt for microphone access the first time you start recording."
      );
    } else if (microphoneAccess === "unsupported") {
      notes.push(
        "Microphone permission status cannot be inspected on this platform."
      );
    }

    return {
      available:
        recorder !== null &&
        microphoneAccess !== "denied" &&
        microphoneAccess !== "restricted",
      experimental: true,
      recorder,
      microphoneAccess,
      issues,
      notes,
    };
  }

  async startRecording(deviceId = "default"): Promise<{ sessionPath: string }> {
    if (this.isRecording || this.recordingProcess) {
      throw new Error("Recording is already in progress.");
    }

    if (deviceId !== "default") {
      throw new Error(
        "This build only supports the system default microphone for recording."
      );
    }

    const status = await this.getCaptureStatus();
    if (!status.available || !status.recorder) {
      throw new Error(
        status.issues[0] ?? "Live recording is unavailable on this machine."
      );
    }

    const userDataPath = app.getPath("userData");
    const sessionsDir = path.join(userDataPath, "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outputPath = path.join(sessionsDir, `session-${timestamp}.wav`);

    const record = require("node-record-lpcm16");
    const recordingProcess = record.record({
      sampleRate: 16000,
      channels: 1,
      audioType: "wav",
      recorder: status.recorder,
      device: deviceId === "default" ? undefined : deviceId,
    }) as RecorderProcess;

    let recordingStream: NodeJS.ReadableStream;
    try {
      recordingStream = recordingProcess.stream();
    } catch {
      throw new Error("Live recording could not attach to the recorder stream.");
    }

    const outputStream = fs.createWriteStream(outputPath);

    this.recordingProcess = recordingProcess;
    this.recordingStream = recordingStream;
    this.outputStream = outputStream;
    this.outputPath = outputPath;
    this.activeRecorder = status.recorder;
    this.stopRequested = false;

    recordingStream.on("data", this.handleAudioData);
    recordingStream.pipe(outputStream);

    recordingProcess.process?.on("close", this.handleRecorderClose);
    recordingProcess.process?.on("error", this.handleRecorderProcessError);

    try {
      await this.awaitRecorderStartup(recordingStream, outputStream);
      this.isRecording = true;
      this.emit("level", 0);
      return { sessionPath: outputPath };
    } catch (error) {
      await this.cleanupActiveCapture({ deleteOutput: true }).catch(
        () => undefined
      );
      throw toError(error, "Live recording could not be started.");
    }
  }

  async stopRecording(): Promise<{ filePath: string; duration: number }> {
    if (
      !this.isRecording ||
      !this.recordingProcess ||
      !this.recordingStream ||
      !this.outputStream ||
      !this.outputPath
    ) {
      throw new Error("No active recording session.");
    }

    const filePath = this.outputPath;
    const recordingProcess = this.recordingProcess;
    const recordingStream = this.recordingStream;
    const outputStream = this.outputStream;

    this.stopRequested = true;

    return new Promise((resolve, reject) => {
      let settled = false;

      const cleanupListeners = () => {
        clearTimeout(timeoutId);
        recordingStream.removeListener("error", onRecordingError);
        outputStream.removeListener("error", onOutputError);
        outputStream.removeListener("finish", onFinalizeSignal);
        outputStream.removeListener("close", onFinalizeSignal);
      };

      const finalize = async () => {
        if (settled) {
          return;
        }

        settled = true;
        cleanupListeners();

        try {
          const stats = await fs.promises.stat(filePath);
          const audioBytes = Math.max(stats.size - WAV_HEADER_BYTES, 0);
          this.clearActiveCaptureState();
          this.emit("level", 0);

          if (audioBytes === 0) {
            await this.removeOutputFile(filePath);
            throw new Error(
              "Recording ended before any audio was written. Check the recorder setup and microphone access."
            );
          }

          resolve({
            filePath,
            duration: audioBytes / AUDIO_BYTES_PER_SECOND,
          });
        } catch (error) {
          this.clearActiveCaptureState();
          this.emit("level", 0);
          reject(toError(error, "Recording could not be finalized."));
        }
      };

      const fail = async (error: unknown) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanupListeners();
        await this.cleanupActiveCapture({ deleteOutput: true }).catch(
          () => undefined
        );
        reject(toError(error, "Recording could not be finalized."));
      };

      const onFinalizeSignal = () => {
        void finalize();
      };
      const onRecordingError = (error: unknown) => {
        void fail(error);
      };
      const onOutputError = (error: unknown) => {
        void fail(error);
      };
      const timeoutId = setTimeout(() => {
        void finalize();
      }, RECORDER_STOP_TIMEOUT_MS);

      recordingStream.once("error", onRecordingError);
      outputStream.once("error", onOutputError);
      outputStream.once("finish", onFinalizeSignal);
      outputStream.once("close", onFinalizeSignal);

      try {
        recordingProcess.stop();
      } catch (error) {
        void fail(error);
      }
    });
  }

  private async awaitRecorderStartup(
    recordingStream: NodeJS.ReadableStream,
    outputStream: fs.WriteStream
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        clearTimeout(timeoutId);
        recordingStream.removeListener("data", onFirstData);
        recordingStream.removeListener("error", onRecordingError);
        outputStream.removeListener("error", onOutputError);
        this.recordingProcess?.process?.removeListener("error", onProcessError);
        this.recordingProcess?.process?.removeListener("close", onProcessClose);
      };

      const succeed = () => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        resolve();
      };

      const fail = (error: unknown) => {
        if (settled) {
          return;
        }

      settled = true;
      cleanup();
      reject(toError(error, "Live recording could not be started."));
    };

      const onFirstData = () => {
        succeed();
      };
      const onRecordingError = (error: unknown) => {
        fail(error);
      };
      const onOutputError = (error: unknown) => {
        fail(error);
      };
      const onProcessError = (error: unknown) => {
        fail(this.describeRecorderFailure(error));
      };
      const onProcessClose = (code: number | null, signal: NodeJS.Signals | null) => {
        fail(this.describeRecorderExit(code, signal));
      };
      const timeoutId = setTimeout(() => {
        succeed();
      }, RECORDER_STARTUP_GRACE_MS);

      recordingStream.once("data", onFirstData);
      recordingStream.once("error", onRecordingError);
      outputStream.once("error", onOutputError);
      this.recordingProcess?.process?.once("error", onProcessError);
      this.recordingProcess?.process?.once("close", onProcessClose);
    });
  }

  private readonly handleAudioData = (chunk: Buffer) => {
    const level = this.calculateAudioLevel(chunk);
    this.emit("level", level);
  };

  private readonly handleRecorderClose = (
    code: number | null,
    signal: NodeJS.Signals | null
  ) => {
    if (!this.isRecording || this.stopRequested) {
      return;
    }

    const message = this.describeRecorderExit(code, signal);
    void this.failActiveRecording(message);
  };

  private readonly handleRecorderProcessError = (error: unknown) => {
    if (!this.isRecording || this.stopRequested) {
      return;
    }

    const message = this.describeRecorderFailure(error);
    void this.failActiveRecording(message);
  };

  private async failActiveRecording(message: string): Promise<void> {
    await this.cleanupActiveCapture({ deleteOutput: true }).catch(
      () => undefined
    );
    this.emit("capture-error", message);
  }

  private async cleanupActiveCapture(options: {
    deleteOutput: boolean;
  }): Promise<void> {
    const currentState = this.clearActiveCaptureState();

    try {
      currentState.recordingProcess?.stop();
    } catch {
      // Ignore secondary stop failures while tearing down a broken recorder.
    }

    currentState.outputStream?.destroy();
    const destroyableStream = currentState.recordingStream as
      | (NodeJS.ReadableStream & { destroy?: () => void })
      | null;
    destroyableStream?.destroy?.();

    if (options.deleteOutput && currentState.outputPath) {
      await this.removeOutputFile(currentState.outputPath);
    }

    this.emit("level", 0);
  }

  private async removeOutputFile(outputPath: string): Promise<void> {
    try {
      await fs.promises.rm(outputPath, { force: true });
    } catch {
      // Cleanup is best-effort; preserve the recorder failure that triggered it.
    }
  }

  private clearActiveCaptureState(): {
    recordingProcess: RecorderProcess | null;
    recordingStream: NodeJS.ReadableStream | null;
    outputStream: fs.WriteStream | null;
    outputPath: string | null;
  } {
    const currentState = {
      recordingProcess: this.recordingProcess,
      recordingStream: this.recordingStream,
      outputStream: this.outputStream,
      outputPath: this.outputPath,
    };

    this.recordingProcess?.process?.removeListener(
      "close",
      this.handleRecorderClose
    );
    this.recordingProcess?.process?.removeListener(
      "error",
      this.handleRecorderProcessError
    );
    this.recordingStream?.removeListener("data", this.handleAudioData);

    this.isRecording = false;
    this.recordingProcess = null;
    this.recordingStream = null;
    this.outputStream = null;
    this.outputPath = null;
    this.activeRecorder = null;
    this.stopRequested = false;

    return currentState;
  }

  private resolveRecorderBackend(): RecorderBackend | null {
    const candidates: RecorderBackend[] = ["sox", "rec"];

    for (const candidate of candidates) {
      const result = spawnSync(candidate, ["--version"], {
        stdio: "ignore",
        timeout: 1000,
      });

      if (!result.error && result.status === 0) {
        return candidate;
      }
    }

    return null;
  }

  private getMicrophoneAccessStatus(): MicrophoneAccessStatus {
    if (process.platform !== "darwin" && process.platform !== "win32") {
      return "unsupported";
    }

    try {
      return systemPreferences.getMediaAccessStatus("microphone");
    } catch {
      return "unknown";
    }
  }

  private describeRecorderFailure(error: unknown): string {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Recorder process failed.";

    if (message.includes("ENOENT") || message.includes("spawn")) {
      return "Live recording requires a local SoX recorder binary (`sox` or `rec`).";
    }

    return `Live recording failed while using ${
      this.activeRecorder ?? "the local recorder"
    }: ${message}`;
  }

  private describeRecorderExit(
    code: number | null,
    signal: NodeJS.Signals | null
  ): string {
    if (code === null && signal === "SIGTERM" && this.stopRequested) {
      return "Recording stopped.";
    }

    const exitDetail =
      code !== null ? `exit code ${code}` : signal ? `signal ${signal}` : "an unknown exit";

    return `Recording stopped unexpectedly (${exitDetail}).`;
  }

  private calculateAudioLevel(chunk: Buffer): number {
    return computeAudioLevel(chunk);
  }

  get recording(): boolean {
    return this.isRecording;
  }
}

/**
 * Compute a normalized RMS level (0..1) for a little-endian 16-bit PCM chunk.
 *
 * The recorder streams raw PCM and Node delivers it in arbitrarily-sized
 * chunks, so a chunk is not guaranteed to end on a 2-byte sample boundary.
 * Only whole samples are read; a trailing odd byte is ignored. Reading past the
 * buffer end (the previous `readInt16LE(chunk.length - 1)` on an odd length)
 * throws a RangeError synchronously inside the stream "data" handler, which
 * surfaces as an uncaught exception and crashes the Electron main process.
 */
export function computeAudioLevel(chunk: Buffer): number {
  const sampleCount = Math.floor(chunk.length / 2);

  if (sampleCount === 0) {
    return 0;
  }

  let sum = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = chunk.readInt16LE(index * 2);
    sum += sample * sample;
  }

  const rms = Math.sqrt(sum / sampleCount);
  return Math.min(rms / 32768, 1);
}

function toError(error: unknown, fallbackMessage: string): Error {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === "string") {
    return new Error(error);
  }

  return new Error(fallbackMessage);
}
