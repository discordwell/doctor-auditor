import * as fs from "fs";
import { parentPort } from "worker_threads";
import { v4 as uuidv4 } from "uuid";
import type { TranscriptSegment } from "@doctor-auditor/shared";
import type {
  TranscribeFileRequest,
  TranscriptionWorkerRequest,
  TranscriptionWorkerResponse,
} from "./transcription-contract";

interface WhisperSegment {
  speech?: string;
  start?: string;
  end?: string;
}

let isProcessing = false;

if (!parentPort) {
  throw new Error("Transcription worker requires a parent port.");
}

parentPort.on("message", (request: TranscriptionWorkerRequest) => {
  void handleRequest(request);
});

async function handleRequest(
  request: TranscriptionWorkerRequest
): Promise<void> {
  try {
    switch (request.kind) {
      case "model-availability":
        respond({
          requestId: request.requestId,
          ok: true,
          result: fs.existsSync(request.modelPath),
        });
        return;
      case "transcribe-file":
        respond({
          requestId: request.requestId,
          ok: true,
          result: await transcribeFile(request),
        });
        return;
      default: {
        const exhaustiveCheck: never = request;
        throw new Error(`Unsupported transcription request: ${exhaustiveCheck}`);
      }
    }
  } catch (error) {
    const normalizedError =
      error instanceof Error ? error : new Error(String(error));
    respond({
      requestId: request.requestId,
      ok: false,
      error: normalizedError.message,
      stack: normalizedError.stack,
    });
  }
}

async function transcribeFile(
  request: TranscribeFileRequest
): Promise<TranscriptSegment[]> {
  if (isProcessing) {
    throw new Error("Already processing a transcription");
  }

  isProcessing = true;

  try {
    const whisper = require("whisper-node").default as (
      audioPath: string,
      options: {
        modelName: string;
        modelPath: string;
        whisperOptions: {
          language: string;
          word_timestamps: boolean;
        };
      }
    ) => Promise<WhisperSegment[] | unknown>;

    const result = await whisper(request.audioPath, {
      modelName: "base.en",
      modelPath: request.modelPath,
      whisperOptions: {
        language: request.language,
        word_timestamps: true,
      },
    });

    if (!Array.isArray(result)) {
      return [];
    }

    return result.flatMap((item) => {
      const text = item.speech?.trim() ?? "";
      if (!text) {
        return [];
      }

      const segment: TranscriptSegment = {
        id: uuidv4(),
        sessionId: request.sessionId,
        speakerLabel: "unknown",
        text,
        startOffsetMs: Math.round(timestampToSeconds(item.start) * 1000),
        endOffsetMs: Math.round(timestampToSeconds(item.end) * 1000),
        transcriptConfidence: 0.8,
        source: request.source,
      };

      return [segment];
    });
  } finally {
    isProcessing = false;
  }
}

function timestampToSeconds(timestamp?: string): number {
  if (!timestamp) {
    return 0;
  }

  const parts = timestamp.split(":");
  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return (
      Number.parseInt(hours, 10) * 3600 +
      Number.parseInt(minutes, 10) * 60 +
      Number.parseFloat(seconds)
    );
  }

  return Number.parseFloat(timestamp) || 0;
}

function respond(response: TranscriptionWorkerResponse): void {
  parentPort?.postMessage(response);
}
