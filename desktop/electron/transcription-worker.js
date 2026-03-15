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
const fs = __importStar(require("fs"));
const worker_threads_1 = require("worker_threads");
const uuid_1 = require("uuid");
let isProcessing = false;
if (!worker_threads_1.parentPort) {
    throw new Error("Transcription worker requires a parent port.");
}
worker_threads_1.parentPort.on("message", (request) => {
    void handleRequest(request);
});
async function handleRequest(request) {
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
                const exhaustiveCheck = request;
                throw new Error(`Unsupported transcription request: ${exhaustiveCheck}`);
            }
        }
    }
    catch (error) {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        respond({
            requestId: request.requestId,
            ok: false,
            error: normalizedError.message,
            stack: normalizedError.stack,
        });
    }
}
async function transcribeFile(request) {
    if (isProcessing) {
        throw new Error("Already processing a transcription");
    }
    isProcessing = true;
    try {
        const whisper = require("whisper-node").default;
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
            const segment = {
                id: (0, uuid_1.v4)(),
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
    }
    finally {
        isProcessing = false;
    }
}
function timestampToSeconds(timestamp) {
    if (!timestamp) {
        return 0;
    }
    const parts = timestamp.split(":");
    if (parts.length === 3) {
        const [hours, minutes, seconds] = parts;
        return (Number.parseInt(hours, 10) * 3600 +
            Number.parseInt(minutes, 10) * 60 +
            Number.parseFloat(seconds));
    }
    return Number.parseFloat(timestamp) || 0;
}
function respond(response) {
    worker_threads_1.parentPort?.postMessage(response);
}
