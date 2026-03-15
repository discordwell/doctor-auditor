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
exports.AudioCapture = void 0;
const child_process_1 = require("child_process");
const events_1 = require("events");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const electron_1 = require("electron");
const AUDIO_BYTES_PER_SECOND = 32000;
const RECORDER_STARTUP_GRACE_MS = 900;
const RECORDER_STOP_TIMEOUT_MS = 3000;
const WAV_HEADER_BYTES = 44;
class AudioCapture extends events_1.EventEmitter {
    isRecording = false;
    recordingProcess = null;
    recordingStream = null;
    outputStream = null;
    outputPath = null;
    activeRecorder = null;
    stopRequested = false;
    async getDevices() {
        const status = await this.getCaptureStatus();
        if (!status.available) {
            return [];
        }
        return [
            {
                id: "default",
                name: "System default microphone",
                isDefault: true,
            },
        ];
    }
    async getCaptureStatus() {
        const recorder = this.resolveRecorderBackend();
        const microphoneAccess = this.getMicrophoneAccessStatus();
        const issues = [];
        const notes = [
            "Live capture is still experimental. Import audio remains the recommended intake path.",
            "Only the system default microphone is supported in this build.",
        ];
        if (!recorder) {
            issues.push("Live capture requires a local SoX recorder binary (`sox` or `rec`). Install it before using the microphone path.");
        }
        else {
            notes.push(`Recorder backend detected: ${recorder}.`);
        }
        if (microphoneAccess === "denied" || microphoneAccess === "restricted") {
            issues.push("Microphone access is blocked for the desktop app. Re-enable it in system privacy settings before trying live capture again.");
        }
        else if (microphoneAccess === "not-determined") {
            notes.push("The OS may still prompt for microphone access the first time live capture starts.");
        }
        else if (microphoneAccess === "unsupported") {
            notes.push("Microphone permission status cannot be inspected on this platform, so failures must be validated manually.");
        }
        return {
            available: recorder !== null &&
                microphoneAccess !== "denied" &&
                microphoneAccess !== "restricted",
            experimental: true,
            recorder,
            microphoneAccess,
            issues,
            notes,
        };
    }
    async startRecording(deviceId = "default") {
        if (this.isRecording || this.recordingProcess) {
            throw new Error("Live capture is already running.");
        }
        if (deviceId !== "default") {
            throw new Error("This build only supports the system default microphone for live capture.");
        }
        const status = await this.getCaptureStatus();
        if (!status.available || !status.recorder) {
            throw new Error(status.issues[0] ??
                "Live capture is unavailable on this machine. Import audio instead.");
        }
        const userDataPath = electron_1.app.getPath("userData");
        const sessionsDir = path.join(userDataPath, "sessions");
        fs.mkdirSync(sessionsDir, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const outputPath = path.join(sessionsDir, `session-${timestamp}.wav`);
        const record = require("node-record-lpcm16");
        const recordingProcess = record.record({
            sampleRate: 16000,
            channels: 1,
            audioType: "wav",
            recorder: status.recorder,
            device: deviceId === "default" ? undefined : deviceId,
        });
        let recordingStream;
        try {
            recordingStream = recordingProcess.stream();
        }
        catch {
            throw new Error("Live capture could not attach to the recorder stream. Import audio instead.");
        }
        const outputStream = fs.createWriteStream(outputPath);
        this.recordingProcess = recordingProcess;
        this.recordingStream = recordingStream;
        this.outputStream = outputStream;
        this.outputPath = outputPath;
        this.activeRecorder = status.recorder;
        this.stopRequested = false;
        recordingStream.on("data", this.handleAudioData);
        recordingStream.pipe(outputStream);
        recordingProcess.process?.on("close", this.handleRecorderClose);
        recordingProcess.process?.on("error", this.handleRecorderProcessError);
        try {
            await this.awaitRecorderStartup(recordingStream, outputStream);
            this.isRecording = true;
            this.emit("level", 0);
            return { sessionPath: outputPath };
        }
        catch (error) {
            await this.cleanupActiveCapture({ deleteOutput: true });
            throw toError(error, "Live capture could not be started.");
        }
    }
    async stopRecording() {
        if (!this.isRecording ||
            !this.recordingProcess ||
            !this.recordingStream ||
            !this.outputStream ||
            !this.outputPath) {
            throw new Error("No active live capture session.");
        }
        const filePath = this.outputPath;
        const recordingProcess = this.recordingProcess;
        const recordingStream = this.recordingStream;
        const outputStream = this.outputStream;
        this.stopRequested = true;
        return new Promise((resolve, reject) => {
            let settled = false;
            const cleanupListeners = () => {
                clearTimeout(timeoutId);
                recordingStream.removeListener("error", onRecordingError);
                outputStream.removeListener("error", onOutputError);
                outputStream.removeListener("finish", onFinalizeSignal);
                outputStream.removeListener("close", onFinalizeSignal);
            };
            const finalize = async () => {
                if (settled) {
                    return;
                }
                settled = true;
                cleanupListeners();
                try {
                    const stats = await fs.promises.stat(filePath);
                    const audioBytes = Math.max(stats.size - WAV_HEADER_BYTES, 0);
                    this.clearActiveCaptureState();
                    this.emit("level", 0);
                    if (audioBytes === 0) {
                        await fs.promises.rm(filePath, { force: true });
                        throw new Error("Live capture ended before any audio was written. Check recorder setup and microphone access.");
                    }
                    resolve({
                        filePath,
                        duration: audioBytes / AUDIO_BYTES_PER_SECOND,
                    });
                }
                catch (error) {
                    this.clearActiveCaptureState();
                    this.emit("level", 0);
                    reject(toError(error, "Live capture could not be finalized."));
                }
            };
            const fail = async (error) => {
                if (settled) {
                    return;
                }
                settled = true;
                cleanupListeners();
                await this.cleanupActiveCapture({ deleteOutput: true });
                reject(toError(error, "Live capture could not be finalized."));
            };
            const onFinalizeSignal = () => {
                void finalize();
            };
            const onRecordingError = (error) => {
                void fail(error);
            };
            const onOutputError = (error) => {
                void fail(error);
            };
            const timeoutId = setTimeout(() => {
                void finalize();
            }, RECORDER_STOP_TIMEOUT_MS);
            recordingStream.once("error", onRecordingError);
            outputStream.once("error", onOutputError);
            outputStream.once("finish", onFinalizeSignal);
            outputStream.once("close", onFinalizeSignal);
            try {
                recordingProcess.stop();
            }
            catch (error) {
                void fail(error);
            }
        });
    }
    async awaitRecorderStartup(recordingStream, outputStream) {
        return new Promise((resolve, reject) => {
            let settled = false;
            const cleanup = () => {
                clearTimeout(timeoutId);
                recordingStream.removeListener("data", onFirstData);
                recordingStream.removeListener("error", onRecordingError);
                outputStream.removeListener("error", onOutputError);
                this.recordingProcess?.process?.removeListener("error", onProcessError);
                this.recordingProcess?.process?.removeListener("close", onProcessClose);
            };
            const succeed = () => {
                if (settled) {
                    return;
                }
                settled = true;
                cleanup();
                resolve();
            };
            const fail = (error) => {
                if (settled) {
                    return;
                }
                settled = true;
                cleanup();
                reject(toError(error, "Live capture could not be started."));
            };
            const onFirstData = () => {
                succeed();
            };
            const onRecordingError = (error) => {
                fail(error);
            };
            const onOutputError = (error) => {
                fail(error);
            };
            const onProcessError = (error) => {
                fail(this.describeRecorderFailure(error));
            };
            const onProcessClose = (code, signal) => {
                fail(this.describeRecorderExit(code, signal));
            };
            const timeoutId = setTimeout(() => {
                succeed();
            }, RECORDER_STARTUP_GRACE_MS);
            recordingStream.once("data", onFirstData);
            recordingStream.once("error", onRecordingError);
            outputStream.once("error", onOutputError);
            this.recordingProcess?.process?.once("error", onProcessError);
            this.recordingProcess?.process?.once("close", onProcessClose);
        });
    }
    handleAudioData = (chunk) => {
        const level = this.calculateAudioLevel(chunk);
        this.emit("level", level);
    };
    handleRecorderClose = (code, signal) => {
        if (!this.isRecording || this.stopRequested) {
            return;
        }
        const message = this.describeRecorderExit(code, signal);
        void this.failActiveRecording(message);
    };
    handleRecorderProcessError = (error) => {
        if (!this.isRecording || this.stopRequested) {
            return;
        }
        const message = this.describeRecorderFailure(error);
        void this.failActiveRecording(message);
    };
    async failActiveRecording(message) {
        await this.cleanupActiveCapture({ deleteOutput: true });
        this.emit("capture-error", message);
    }
    async cleanupActiveCapture(options) {
        const currentState = this.clearActiveCaptureState();
        try {
            currentState.recordingProcess?.stop();
        }
        catch {
            // Ignore secondary stop failures while tearing down a broken recorder.
        }
        currentState.outputStream?.destroy();
        const destroyableStream = currentState.recordingStream;
        destroyableStream?.destroy?.();
        if (options.deleteOutput && currentState.outputPath) {
            await fs.promises.rm(currentState.outputPath, { force: true });
        }
        this.emit("level", 0);
    }
    clearActiveCaptureState() {
        const currentState = {
            recordingProcess: this.recordingProcess,
            recordingStream: this.recordingStream,
            outputStream: this.outputStream,
            outputPath: this.outputPath,
        };
        this.recordingProcess?.process?.removeListener("close", this.handleRecorderClose);
        this.recordingProcess?.process?.removeListener("error", this.handleRecorderProcessError);
        this.recordingStream?.removeListener("data", this.handleAudioData);
        this.isRecording = false;
        this.recordingProcess = null;
        this.recordingStream = null;
        this.outputStream = null;
        this.outputPath = null;
        this.activeRecorder = null;
        this.stopRequested = false;
        return currentState;
    }
    resolveRecorderBackend() {
        const candidates = ["sox", "rec"];
        for (const candidate of candidates) {
            const result = (0, child_process_1.spawnSync)(candidate, ["--version"], {
                stdio: "ignore",
                timeout: 1000,
            });
            if (!result.error && result.status === 0) {
                return candidate;
            }
        }
        return null;
    }
    getMicrophoneAccessStatus() {
        if (process.platform !== "darwin" && process.platform !== "win32") {
            return "unsupported";
        }
        try {
            return electron_1.systemPreferences.getMediaAccessStatus("microphone");
        }
        catch {
            return "unknown";
        }
    }
    describeRecorderFailure(error) {
        const message = error instanceof Error
            ? error.message
            : typeof error === "string"
                ? error
                : "Recorder process failed.";
        if (message.includes("ENOENT") || message.includes("spawn")) {
            return "Live capture requires a local SoX recorder binary (`sox` or `rec`). Import audio remains available.";
        }
        return `Live capture failed while using ${this.activeRecorder ?? "the local recorder"}: ${message}`;
    }
    describeRecorderExit(code, signal) {
        if (code === null && signal === "SIGTERM" && this.stopRequested) {
            return "Live capture stopped.";
        }
        const exitDetail = code !== null ? `exit code ${code}` : signal ? `signal ${signal}` : "an unknown exit";
        return `Live capture stopped unexpectedly (${exitDetail}). Import audio is still available while this path remains experimental.`;
    }
    calculateAudioLevel(chunk) {
        let sum = 0;
        const samples = chunk.length / 2;
        if (samples === 0) {
            return 0;
        }
        for (let index = 0; index < chunk.length; index += 2) {
            const sample = chunk.readInt16LE(index);
            sum += sample * sample;
        }
        const rms = Math.sqrt(sum / samples);
        return Math.min(rms / 32768, 1);
    }
    get recording() {
        return this.isRecording;
    }
}
exports.AudioCapture = AudioCapture;
function toError(error, fallbackMessage) {
    if (error instanceof Error) {
        return error;
    }
    if (typeof error === "string") {
        return new Error(error);
    }
    return new Error(fallbackMessage);
}
