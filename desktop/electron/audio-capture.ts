import { EventEmitter } from "events";
import * as path from "path";
import * as fs from "fs";
import { app } from "electron";

export interface AudioDevice {
  id: string;
  name: string;
  isDefault: boolean;
}

interface RecorderProcess {
  stream(): NodeJS.ReadableStream;
  stop(): void;
}

export class AudioCapture extends EventEmitter {
  private isRecording = false;
  private recordingProcess: RecorderProcess | null = null;
  private outputPath: string | null = null;

  async getDevices(): Promise<AudioDevice[]> {
    // Use sox/rec to list audio devices on macOS
    // In production, we'd use a native module for better device enumeration
    return [
      {
        id: "default",
        name: "Default Microphone",
        isDefault: true,
      },
    ];
  }

  async startRecording(deviceId = "default"): Promise<{ sessionPath: string }> {
    if (this.isRecording) {
      throw new Error("Already recording");
    }

    const userDataPath = app.getPath("userData");
    const sessionsDir = path.join(userDataPath, "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.outputPath = path.join(sessionsDir, `session-${timestamp}.wav`);

    // Use node-record-lpcm16 for cross-platform audio capture
    // Records 16-bit PCM at 16kHz (optimal for Whisper)
    const record = require("node-record-lpcm16");

    this.recordingProcess = record.record({
      sampleRate: 16000,
      channels: 1,
      audioType: "wav",
      recorder: "rec", // Uses SoX on macOS
      device: deviceId === "default" ? undefined : deviceId,
    }) as RecorderProcess;

    const fileStream = fs.createWriteStream(this.outputPath);
    this.recordingProcess!.stream().pipe(fileStream);

    // Emit audio levels for waveform visualization
    this.recordingProcess!.stream().on("data", (chunk: Buffer) => {
      const level = this.calculateAudioLevel(chunk);
      this.emit("level", level);
    });

    this.isRecording = true;
    return { sessionPath: this.outputPath };
  }

  async stopRecording(): Promise<{ filePath: string; duration: number }> {
    if (!this.isRecording || !this.recordingProcess) {
      throw new Error("Not currently recording");
    }

    return new Promise((resolve) => {
      this.recordingProcess!.stop();
      this.isRecording = false;

      const filePath = this.outputPath!;
      this.outputPath = null;
      this.recordingProcess = null;

      // Get file stats for duration estimate
      const stats = fs.statSync(filePath);
      // 16kHz, 16-bit, mono = 32000 bytes per second
      const duration = stats.size / 32000;

      resolve({ filePath, duration });
    });
  }

  private calculateAudioLevel(chunk: Buffer): number {
    // Calculate RMS audio level from 16-bit PCM data
    let sum = 0;
    const samples = chunk.length / 2;

    for (let i = 0; i < chunk.length; i += 2) {
      const sample = chunk.readInt16LE(i);
      sum += sample * sample;
    }

    const rms = Math.sqrt(sum / samples);
    // Normalize to 0-1 range (16-bit max is 32768)
    return Math.min(rms / 32768, 1);
  }

  get recording(): boolean {
    return this.isRecording;
  }
}
