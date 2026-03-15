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
exports.TranscriptionService = void 0;
const path = __importStar(require("path"));
const crypto_1 = require("crypto");
const electron_1 = require("electron");
const worker_threads_1 = require("worker_threads");
class TranscriptionService {
    language;
    modelPath;
    workerPath;
    isProcessing = false;
    pendingRequests = new Map();
    worker = null;
    constructor(config = {}) {
        const userDataPath = electron_1.app.getPath("userData");
        this.language = config.language ?? "en";
        this.modelPath =
            config.modelPath ??
                path.join(userDataPath, "models", "ggml-base.en.bin");
        this.workerPath =
            config.workerPath ?? path.join(__dirname, "transcription-worker.js");
    }
    async isModelAvailable() {
        return this.sendRequest({
            kind: "model-availability",
            modelPath: this.modelPath,
        });
    }
    async transcribeFile(audioPath, sessionId, source) {
        if (this.isProcessing) {
            throw new Error("Already processing a transcription");
        }
        this.isProcessing = true;
        try {
            return await this.sendRequest({
                kind: "transcribe-file",
                audioPath,
                language: this.language,
                modelPath: this.modelPath,
                sessionId,
                source,
            });
        }
        finally {
            this.isProcessing = false;
        }
    }
    async dispose() {
        const worker = this.worker;
        this.worker = null;
        if (!worker) {
            return;
        }
        this.rejectPendingRequests(new Error("Transcription worker shut down."));
        await worker.terminate();
    }
    getOrCreateWorker() {
        if (this.worker) {
            return this.worker;
        }
        const worker = new worker_threads_1.Worker(this.workerPath);
        worker.on("message", (response) => {
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
                this.rejectPendingRequests(new Error(`Transcription worker exited with code ${code}.`));
            }
        });
        this.worker = worker;
        return worker;
    }
    handleWorkerMessage(response) {
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
    sendRequest(request) {
        const worker = this.getOrCreateWorker();
        const requestId = (0, crypto_1.randomUUID)();
        return new Promise((resolve, reject) => {
            this.pendingRequests.set(requestId, {
                reject,
                resolve: resolve,
            });
            try {
                const fullRequest = {
                    ...request,
                    requestId,
                };
                worker.postMessage(fullRequest);
            }
            catch (error) {
                this.pendingRequests.delete(requestId);
                reject(error);
            }
        });
    }
}
exports.TranscriptionService = TranscriptionService;
