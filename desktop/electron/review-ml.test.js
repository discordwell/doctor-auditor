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
const os = __importStar(require("os"));
const vitest_1 = require("vitest");
const path = __importStar(require("path"));
const review_ml_1 = require("./review-ml");
const workerPath = path.join(__dirname, "python-review-worker.py");
(0, vitest_1.describe)("PythonReviewMlClient", () => {
    let client = null;
    let tempDir = null;
    (0, vitest_1.afterEach)(async () => {
        await client?.dispose();
        client = null;
        if (tempDir) {
            fs.rmSync(tempDir, { force: true, recursive: true });
            tempDir = null;
        }
    });
    (0, vitest_1.it)("routes review ML requests through a subprocess boundary", async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-auditor-review-ml-"));
        const modelPath = path.join(tempDir, "model.bin");
        const adapterPath = path.join(tempDir, "review-ml-adapter.py");
        fs.writeFileSync(modelPath, "");
        fs.writeFileSync(adapterPath, [
            "#!/usr/bin/env python3",
            "import json",
            "import sys",
            "",
            "request = json.load(sys.stdin)",
            "json.dump([",
            "  {",
            '    \"id\": \"segment-1\",',
            '    \"sessionId\": request[\"sessionId\"],',
            '    \"speakerLabel\": \"unknown\",',
            '    \"text\": \"stub:\" + request[\"audioPath\"],',
            '    \"startOffsetMs\": 0,',
            '    \"endOffsetMs\": 1000,',
            '    \"transcriptConfidence\": 0.9,',
            '    \"source\": request[\"source\"],',
            "  }",
            "], sys.stdout)",
        ].join("\n"), { mode: 0o755 });
        client = new review_ml_1.PythonReviewMlClient({
            modelPath,
            pythonExecutable: "python3",
            workerEnv: {
                ...process.env,
                DOCTOR_AUDITOR_REVIEW_ML_COMMAND: adapterPath,
                DOCTOR_AUDITOR_REVIEW_ML_PROVIDER: "command_adapter",
            },
            workerPath,
        });
        await (0, vitest_1.expect)(client.isModelAvailable()).resolves.toBe(true);
        await (0, vitest_1.expect)(client.transcribeFile("audio.wav", "session-1", "audio_import")).resolves.toEqual([
            {
                id: "segment-1",
                sessionId: "session-1",
                speakerLabel: "unknown",
                text: "stub:audio.wav",
                startOffsetMs: 0,
                endOffsetMs: 1000,
                transcriptConfidence: 0.9,
                source: "audio_import",
            },
        ]);
    });
});
