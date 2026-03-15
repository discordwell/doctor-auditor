"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PythonReviewMlClient = void 0;
const path = __importStar(require("path"));
const crypto_1 = require("crypto");
const electron_1 = require("electron");
const child_process_1 = require("child_process");
const readline_1 = require("readline");
class PythonReviewMlClient {
    language;
    modelRef;
    modelPath;
    pendingRequests = new Map();
    pythonExecutable;
    workerEnv;
    workerPath;
    isProcessing = false;
    stderrBuffer = "";
    stdoutReader = null;
    worker = null;
    constructor(config = {}) {
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
    async isModelAvailable() {
        return this.sendRequest({
            kind: "model-availability",
            modelRef: this.modelRef,
            modelPath: this.modelPath,
        });
    }
    async transcribeFile(audioPath, sessionId, source) {
        return this.runExclusiveRequest(() => this.sendRequest({
            kind: "transcribe-file",
            audioPath,
            language: this.language,
            modelRef: this.modelRef,
            modelPath: this.modelPath,
            sessionId,
            source,
        }));
    }
    async analyzeTranscript(sessionId, transcriptSegments) {
        return this.runExclusiveRequest(() => this.sendRequest({
            kind: "analyze-transcript",
            modelRef: this.modelRef,
            modelPath: this.modelPath,
            sessionId,
            transcriptSegments,
        }));
    }
    async dispose() {
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
    async runExclusiveRequest(run) {
        if (this.isProcessing) {
            throw new Error("Already processing a local review ML request.");
        }
        this.isProcessing = true;
        try {
            return await run();
        }
        finally {
            this.isProcessing = false;
        }
    }
    getOrCreateWorker() {
        if (this.worker) {
            return this.worker;
        }
        const worker = (0, child_process_1.spawn)(this.resolvePythonExecutable(), [this.workerPath], {
            env: this.workerEnv,
            stdio: "pipe",
        });
        this.stderrBuffer = "";
        const stdoutReader = (0, readline_1.createInterface)({
            input: worker.stdout,
            crlfDelay: Infinity,
        });
        stdoutReader.on("line", (line) => {
            this.handleWorkerLine(line);
        });
        worker.stderr.setEncoding("utf8");
        worker.stderr.on("data", (chunk) => {
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
    handleWorkerLine(line) {
        let response;
        try {
            response = JSON.parse(line);
        }
        catch (error) {
            const parseError = error instanceof Error
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
    rejectPendingRequests(error) {
        for (const pendingRequest of this.pendingRequests.values()) {
            pendingRequest.reject(error);
        }
        this.pendingRequests.clear();
    }
    resolvePythonExecutable() {
        if (this.pythonExecutable) {
            return this.pythonExecutable;
        }
        for (const candidate of ["python3", "python"]) {
            const result = (0, child_process_1.spawnSync)(candidate, ["--version"], {
                stdio: "ignore",
            });
            if (!result.error && result.status === 0) {
                return candidate;
            }
        }
        throw new Error("Python runtime not found. Set DOCTOR_AUDITOR_PYTHON_BIN to the interpreter that should host review ML.");
    }
    sendRequest(request) {
        const worker = this.getOrCreateWorker();
        const requestId = (0, crypto_1.randomUUID)();
        return new Promise((resolve, reject) => {
            this.pendingRequests.set(requestId, {
                reject,
                resolve: resolve,
            });
            const fullRequest = {
                ...request,
                requestId,
            };
            try {
                worker.stdin.write(`${JSON.stringify(fullRequest)}\n`);
            }
            catch (error) {
                this.pendingRequests.delete(requestId);
                reject(error);
            }
        });
    }
}
exports.PythonReviewMlClient = PythonReviewMlClient;
function resolveUserDataPath() {
    const configuredPath = process.env.DOCTOR_AUDITOR_USER_DATA_PATH;
    if (configuredPath) {
        return configuredPath;
    }
    const electronUserDataPath = electron_1.app?.getPath?.("userData");
    if (electronUserDataPath) {
        return electronUserDataPath;
    }
    return process.cwd();
}
