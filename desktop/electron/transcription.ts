import { EventEmitter } from "events";
import * as path from "path";
import * as fs from "fs";
import { app } from "electron";
import { v4 as uuidv4 } from "uuid";
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

  async transcribeFile(
    audioPath: string,
    sessionId: string,
    source: TranscriptSegment["source"]
  ): Promise<TranscriptSegment[]> {
    if (this.isProcessing) {
      throw new Error("Already processing a transcription");
    }

    this.isProcessing = true;
    const segments: TranscriptSegment[] = [];

    try {
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
            id: uuidv4(),
            sessionId,
            speakerLabel: "unknown",
            text: item.speech?.trim() ?? "",
            startOffsetMs: Math.round(this.timestampToSeconds(item.start) * 1000),
            endOffsetMs: Math.round(this.timestampToSeconds(item.end) * 1000),
            transcriptConfidence: 0.8,
            source,
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

  private timestampToSeconds(timestamp: string): number {
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
