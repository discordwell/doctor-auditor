import { EventEmitter } from "events";
import * as path from "path";
import * as fs from "fs";
import { app } from "electron";
import type { TranscriptSegment } from "@doctor-auditor/shared";

export interface TranscriptionConfig {
  modelPath?: string;
  language?: string;
}

export class TranscriptionService extends EventEmitter {
  private modelPath: string;
  private isProcessing = false;

  constructor(config: TranscriptionConfig = {}) {
    super();
    const userDataPath = app.getPath("userData");
    this.modelPath =
      config.modelPath ??
      path.join(userDataPath, "models", "ggml-base.en.bin");
  }

  async isModelAvailable(): Promise<boolean> {
    return fs.existsSync(this.modelPath);
  }

  async transcribeFile(audioPath: string): Promise<TranscriptSegment[]> {
    if (this.isProcessing) {
      throw new Error("Already processing a transcription");
    }

    this.isProcessing = true;
    const segments: TranscriptSegment[] = [];

    try {
      // Use whisper-node for local transcription
      const whisper = require("whisper-node").default;

      const result = await whisper(audioPath, {
        modelName: "base.en",
        modelPath: this.modelPath,
        whisperOptions: {
          language: "en",
          word_timestamps: true,
        },
      });

      if (result && Array.isArray(result)) {
        for (const item of result) {
          const segment: TranscriptSegment = {
            speaker: "unknown", // Will be assigned by diarization
            text: item.speech?.trim() ?? "",
            startTime: this.timestampToSeconds(item.start),
            endTime: this.timestampToSeconds(item.end),
            confidence: 0.8, // whisper-node doesn't expose confidence directly
          };

          if (segment.text) {
            segments.push(segment);
            this.emit("segment", segment);
          }
        }
      }
    } finally {
      this.isProcessing = false;
    }

    return segments;
  }

  async transcribeStream(
    audioStream: NodeJS.ReadableStream
  ): Promise<AsyncGenerator<TranscriptSegment>> {
    // For real-time transcription, we buffer audio chunks and
    // process them in windows. This is a simplified version —
    // production would use whisper.cpp's streaming API directly.
    const self = this;

    async function* generate(): AsyncGenerator<TranscriptSegment> {
      const chunks: Buffer[] = [];
      const chunkDuration = 5; // Process every 5 seconds of audio
      const bytesPerSecond = 32000; // 16kHz * 16-bit
      const chunkSize = chunkDuration * bytesPerSecond;
      let buffer = Buffer.alloc(0);
      let timeOffset = 0;

      for await (const data of audioStream) {
        buffer = Buffer.concat([buffer, data as Buffer]);

        while (buffer.length >= chunkSize) {
          const chunk = buffer.subarray(0, chunkSize);
          buffer = buffer.subarray(chunkSize);

          // Write temp file for whisper processing
          const tempPath = path.join(
            app.getPath("temp"),
            `whisper-chunk-${Date.now()}.wav`
          );
          fs.writeFileSync(tempPath, chunk);

          try {
            const segments = await self.transcribeFile(tempPath);
            for (const segment of segments) {
              yield {
                ...segment,
                startTime: segment.startTime + timeOffset,
                endTime: segment.endTime + timeOffset,
              };
            }
          } finally {
            fs.unlinkSync(tempPath);
          }

          timeOffset += chunkDuration;
        }
      }
    }

    return generate();
  }

  private timestampToSeconds(timestamp: string): number {
    // whisper-node returns timestamps like "00:00:05.000"
    if (!timestamp) return 0;
    const parts = timestamp.split(":");
    if (parts.length === 3) {
      const [hours, minutes, seconds] = parts;
      return (
        parseInt(hours) * 3600 +
        parseInt(minutes) * 60 +
        parseFloat(seconds)
      );
    }
    return parseFloat(timestamp) || 0;
  }
}
