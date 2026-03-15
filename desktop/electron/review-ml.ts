import * as path from "path";
import { randomUUID } from "crypto";
import { app } from "electron";
import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from "child_process";
import { createInterface, type Interface } from "readline";
import type { TranscriptSegment } from "@doctor-auditor/shared/local-review";
import type {
  ReviewMlAnalysisResult,
  ReviewMlAnalyzeTranscriptRequest,
  ReviewMlModelAvailabilityRequest,
  ReviewMlRequest,
  ReviewMlResponse,
  ReviewMlTranscribeFileRequest,
} from "./review-ml-contract";

export interface PythonReviewMlClientConfig {
  language?: string;
  modelPath?: string;
  modelRef?: string;
  pythonExecutable?: string;
  workerEnv?: NodeJS.ProcessEnv;
  workerPath?: string;
}

interface PendingRequest {
  reject: (reason?: unknown) => void;
  resolve: (value: unknown) => void;
}

type ReviewMlRequestPayload =
  | Omit<ReviewMlModelAvailabilityRequest, "requestId">
  | Omit<ReviewMlTranscribeFileRequest, "requestId">
  | Omit<ReviewMlAnalyzeTranscriptRequest, "requestId">;

export class PythonReviewMlClient {
  private readonly language: string;
  private readonly modelRef: string;
  private readonly modelPath: string;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly pythonExecutable?: string;
  private readonly workerEnv: NodeJS.ProcessEnv;
  private readonly workerPath: string;
  private isProcessing = false;
  private stderrBuffer = "";
  private stdoutReader: Interface | null = null;
  private worker: ChildProcessWithoutNullStreams | null = null;

  constructor(config: PythonReviewMlClientConfig = {}) {
    const userDataPath = resolveUserDataPath();

    this.language = config.language ?? "en";
    this.modelRef = config.modelRef ?? "base.en";
    this.modelPath =
      config.modelPath ??
      path.join(userDataPath, "models", "ggml-base.en.bin");
    this.workerPath =
      config.workerPath ?? path.join(__dirname, "python-review-worker.py");
    this.pythonExecutable =
      config.pythonExecutable ?? process.env.DOCTOR_AUDITOR_PYTHON_BIN;
    this.workerEnv = config.workerEnv ?? process.env;
  }

  async isModelAvailable(): Promise<boolean> {
    return this.sendRequest<boolean>({
      kind: "model-availability",
      modelRef: this.modelRef,
      modelPath: this.modelPath,
    });
  }

  async transcribeFile(
    audioPath: string,
    sessionId: string,
    source: TranscriptSegment["source"]
  ): Promise<TranscriptSegment[]> {
    return this.runExclusiveRequest(() =>
      this.sendRequest<TranscriptSegment[]>({
        kind: "transcribe-file",
        audioPath,
        language: this.language,
        modelRef: this.modelRef,
        modelPath: this.modelPath,
        sessionId,
        source,
      })
    );
  }

  async analyzeTranscript(
    sessionId: string,
    transcriptSegments: TranscriptSegment[]
  ): Promise<ReviewMlAnalysisResult> {
    return this.runExclusiveRequest(() =>
      this.sendRequest<ReviewMlAnalysisResult>({
        kind: "analyze-transcript",
        modelRef: this.modelRef,
        modelPath: this.modelPath,
        sessionId,
        transcriptSegments,
      })
    );
  }

  async dispose(): Promise<void> {
    const worker = this.worker;
    this.worker = null;

    if (!worker) {
      return;
    }

    this.stdoutReader?.close();
    this.stdoutReader = null;
    this.rejectPendingRequests(new Error("Python review ML worker shut down."));
    worker.kill();
  }

  private async runExclusiveRequest<T>(
    run: () => Promise<T>
  ): Promise<T> {
    if (this.isProcessing) {
      throw new Error("Already processing a local review ML request.");
    }

    this.isProcessing = true;

    try {
      return await run();
    } finally {
      this.isProcessing = false;
    }
  }

  private getOrCreateWorker(): ChildProcessWithoutNullStreams {
    if (this.worker) {
      return this.worker;
    }

    const worker = spawn(this.resolvePythonExecutable(), [this.workerPath], {
      env: this.workerEnv,
      stdio: "pipe",
    }) as ChildProcessWithoutNullStreams;

    this.stderrBuffer = "";

    const stdoutReader = createInterface({
      input: worker.stdout,
      crlfDelay: Infinity,
    });
    stdoutReader.on("line", (line) => {
      this.handleWorkerLine(line);
    });

    worker.stderr.setEncoding("utf8");
    worker.stderr.on("data", (chunk: string) => {
      this.stderrBuffer = `${this.stderrBuffer}${chunk}`.slice(-4000);
    });
    worker.on("error", (error) => {
      this.worker = null;
      this.stdoutReader?.close();
      this.stdoutReader = null;
      this.rejectPendingRequests(error);
    });
    worker.on("exit", (code, signal) => {
      if (this.worker === worker) {
        this.worker = null;
      }

      this.stdoutReader?.close();
      this.stdoutReader = null;

      if (code === 0 || signal === "SIGTERM") {
        return;
      }

      const details = this.stderrBuffer.trim();
      const reason = signal
        ? `signal ${signal}`
        : `code ${String(code ?? "unknown")}`;
      const message = details
        ? `Python review ML worker exited with ${reason}: ${details}`
        : `Python review ML worker exited with ${reason}.`;
      this.rejectPendingRequests(new Error(message));
    });

    this.worker = worker;
    this.stdoutReader = stdoutReader;
    return worker;
  }

  private handleWorkerLine(line: string): void {
    let response: ReviewMlResponse;

    try {
      response = JSON.parse(line) as ReviewMlResponse;
    } catch (error) {
      const parseError =
        error instanceof Error
          ? error
          : new Error("Failed to parse Python review ML response.");
      this.rejectPendingRequests(parseError);
      return;
    }

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

  private resolvePythonExecutable(): string {
    if (this.pythonExecutable) {
      return this.pythonExecutable;
    }

    for (const candidate of ["python3", "python"]) {
      const result = spawnSync(candidate, ["--version"], {
        stdio: "ignore",
      });
      if (!result.error && result.status === 0) {
        return candidate;
      }
    }

    throw new Error(
      "Python runtime not found. Set DOCTOR_AUDITOR_PYTHON_BIN to the interpreter that should host review ML."
    );
  }

  private sendRequest<T>(request: ReviewMlRequestPayload): Promise<T> {
    const worker = this.getOrCreateWorker();
    const requestId = randomUUID();

    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(requestId, {
        reject,
        resolve: resolve as (value: unknown) => void,
      });

      const fullRequest = {
        ...request,
        requestId,
      } as ReviewMlRequest;

      try {
        worker.stdin.write(`${JSON.stringify(fullRequest)}\n`);
      } catch (error) {
        this.pendingRequests.delete(requestId);
        reject(error);
      }
    });
  }
}

function resolveUserDataPath(): string {
  const configuredPath = process.env.DOCTOR_AUDITOR_USER_DATA_PATH;
  if (configuredPath) {
    return configuredPath;
  }

  const electronUserDataPath = app?.getPath?.("userData");
  if (electronUserDataPath) {
    return electronUserDataPath;
  }

  return process.cwd();
}
