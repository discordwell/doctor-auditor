import * as path from "path";
import { randomUUID } from "crypto";
import { app } from "electron";
import { Worker } from "worker_threads";
import type { TranscriptSegment } from "@doctor-auditor/shared";
import type {
  ModelAvailabilityRequest,
  TranscribeFileRequest,
  TranscriptionWorkerRequest,
  TranscriptionWorkerResponse,
} from "./transcription-contract";

export interface TranscriptionConfig {
  modelPath?: string;
  language?: string;
  workerPath?: string;
}

interface PendingRequest {
  reject: (reason?: unknown) => void;
  resolve: (value: unknown) => void;
}

type TranscriptionWorkerRequestPayload =
  | Omit<ModelAvailabilityRequest, "requestId">
  | Omit<TranscribeFileRequest, "requestId">;

export class TranscriptionService {
  private readonly language: string;
  private readonly modelPath: string;
  private readonly workerPath: string;
  private isProcessing = false;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private worker: Worker | null = null;

  constructor(config: TranscriptionConfig = {}) {
    const userDataPath = app.getPath("userData");

    this.language = config.language ?? "en";
    this.modelPath =
      config.modelPath ??
      path.join(userDataPath, "models", "ggml-base.en.bin");
    this.workerPath =
      config.workerPath ?? path.join(__dirname, "transcription-worker.js");
  }

  async isModelAvailable(): Promise<boolean> {
    return this.sendRequest<boolean>({
      kind: "model-availability",
      modelPath: this.modelPath,
    });
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

    try {
      return await this.sendRequest<TranscriptSegment[]>({
        kind: "transcribe-file",
        audioPath,
        language: this.language,
        modelPath: this.modelPath,
        sessionId,
        source,
      });
    } finally {
      this.isProcessing = false;
    }
  }

  async dispose(): Promise<void> {
    const worker = this.worker;
    this.worker = null;

    if (!worker) {
      return;
    }

    this.rejectPendingRequests(new Error("Transcription worker shut down."));
    await worker.terminate();
  }

  private getOrCreateWorker(): Worker {
    if (this.worker) {
      return this.worker;
    }

    const worker = new Worker(this.workerPath);
    worker.on("message", (response: TranscriptionWorkerResponse) => {
      this.handleWorkerMessage(response);
    });
    worker.on("error", (error) => {
      this.worker = null;
      this.rejectPendingRequests(error);
    });
    worker.on("exit", (code) => {
      if (this.worker === worker) {
        this.worker = null;
      }

      if (code !== 0) {
        this.rejectPendingRequests(
          new Error(`Transcription worker exited with code ${code}.`)
        );
      }
    });

    this.worker = worker;
    return worker;
  }

  private handleWorkerMessage(response: TranscriptionWorkerResponse): void {
    const pendingRequest = this.pendingRequests.get(response.requestId);
    if (!pendingRequest) {
      return;
    }

    this.pendingRequests.delete(response.requestId);

    if (response.ok) {
      pendingRequest.resolve(response.result);
      return;
    }

    const error = new Error(response.error);
    if (response.stack) {
      error.stack = response.stack;
    }
    pendingRequest.reject(error);
  }

  private rejectPendingRequests(error: Error): void {
    for (const pendingRequest of this.pendingRequests.values()) {
      pendingRequest.reject(error);
    }

    this.pendingRequests.clear();
  }

  private sendRequest<T>(
    request: TranscriptionWorkerRequestPayload
  ): Promise<T> {
    const worker = this.getOrCreateWorker();
    const requestId = randomUUID();

    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(requestId, {
        reject,
        resolve: resolve as (value: unknown) => void,
      });

      try {
        const fullRequest = {
          ...request,
          requestId,
        } as TranscriptionWorkerRequest;

        worker.postMessage(fullRequest);
      } catch (error) {
        this.pendingRequests.delete(requestId);
        reject(error);
      }
    });
  }
}
