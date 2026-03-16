import * as fs from "fs";
import * as os from "os";
import { afterEach, describe, expect, it } from "vitest";
import * as path from "path";
import { PythonReviewMlClient } from "./review-ml";

const workerPath = path.join(__dirname, "python-review-worker.py");

describe("PythonReviewMlClient", () => {
  let client: PythonReviewMlClient | null = null;
  let tempDir: string | null = null;

  afterEach(async () => {
    await client?.dispose();
    client = null;
    if (tempDir) {
      fs.rmSync(tempDir, { force: true, recursive: true });
      tempDir = null;
    }
  });

  it("routes review ML requests through a subprocess boundary", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-auditor-review-ml-"));
    const modelPath = path.join(tempDir, "model.bin");
    const adapterPath = path.join(tempDir, "review-ml-adapter.py");

    fs.writeFileSync(modelPath, "");
    fs.writeFileSync(
      adapterPath,
      [
        "#!/usr/bin/env python3",
        "import json",
        "import sys",
        "",
        "request = json.load(sys.stdin)",
        "if request['kind'] == 'transcribe-file':",
        "  json.dump([",
        "    {",
        '      \"id\": \"segment-1\",',
        '      \"sessionId\": request[\"sessionId\"],',
        '      \"speakerLabel\": \"unknown\",',
        '      \"text\": \"stub:\" + request[\"audioPath\"],',
        '      \"startOffsetMs\": 0,',
        '      \"endOffsetMs\": 1000,',
        '      \"transcriptConfidence\": 0.9,',
        '      \"source\": request[\"source\"],',
        "    }",
        "  ], sys.stdout)",
        "else:",
        "  json.dump({",
        '    \"findings\": [',
        "      {",
        '        \"id\": \"finding-1\",',
        '        \"sessionId\": request[\"sessionId\"],',
        '        \"code\": \"follow-up-needed\",',
        '        \"title\": \"Follow-up instructions need review\",',
        '        \"summary\": \"Stub finding returned by the adapter.\",',
        '        \"status\": \"pending_review\",',
        '        \"confidence\": 0.7,',
        '        \"evidenceSpans\": [',
        "          {",
        '            \"id\": \"evidence-1\",',
        '            \"transcriptSegmentId\": request[\"transcriptSegments\"][0][\"id\"],',
        '            \"excerpt\": request[\"transcriptSegments\"][0][\"text\"],',
        '            \"startOffsetMs\": 0,',
        '            \"endOffsetMs\": 1000',
        "          }",
        "        ],",
        '        \"detectedBy\": \"rules\",',
        '        \"createdAt\": \"2026-03-15T00:00:00Z\",',
        '        \"updatedAt\": \"2026-03-15T00:00:00Z\"',
        "      }",
        "    ],",
        '    \"evidenceSpans\": [',
        "      {",
        '        \"id\": \"evidence-1\",',
        '        \"transcriptSegmentId\": request[\"transcriptSegments\"][0][\"id\"],',
        '        \"excerpt\": request[\"transcriptSegments\"][0][\"text\"],',
        '        \"startOffsetMs\": 0,',
        '        \"endOffsetMs\": 1000',
        "      }",
        "    ]",
        "  }, sys.stdout)",
      ].join("\n"),
      { mode: 0o755 }
    );

    client = new PythonReviewMlClient({
      modelPath,
      pythonExecutable: "python3",
      workerEnv: {
        ...process.env,
        DOCTOR_AUDITOR_REVIEW_ML_COMMAND: adapterPath,
        DOCTOR_AUDITOR_REVIEW_ML_PROVIDER: "command_adapter",
      },
      workerPath,
    });

    await expect(client.isModelAvailable()).resolves.toBe(true);
    await expect(
      client.transcribeFile("audio.wav", "session-1", "audio_import")
    ).resolves.toEqual([
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
    await expect(
      client.analyzeTranscript("session-1", [
        {
          id: "segment-1",
          sessionId: "session-1",
          speakerLabel: "unknown",
          text: "stub:audio.wav",
          startOffsetMs: 0,
          endOffsetMs: 1000,
          source: "audio_import",
        },
      ])
    ).resolves.toMatchObject({
      evidenceSpans: [
        {
          id: "evidence-session1-1",
          transcriptSegmentId: "segment-1",
        },
      ],
      findings: [
        {
          id: "finding-session1-1",
          sessionId: "session-1",
        },
      ],
    });
  });

  it("flags urgent symptom language without urgent disposition guidance", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-auditor-review-ml-"));
    const modelPath = path.join(tempDir, "model.bin");
    fs.writeFileSync(modelPath, "");

    client = new PythonReviewMlClient({
      modelPath,
      pythonExecutable: "python3",
      workerPath,
    });

    const analysis = await client.analyzeTranscript("session-dr-beat", [
      {
        id: "segment-1",
        sessionId: "session-dr-beat",
        speakerLabel: "patient",
        text: "Emergency. I cannot control my feet, I am burning up, and we are going to die.",
        startOffsetMs: 0,
        endOffsetMs: 5000,
        source: "manual_edit",
      },
      {
        id: "segment-2",
        sessionId: "session-dr-beat",
        speakerLabel: "clinician",
        text: "I hear this feels intense. We will make a plan and help you regain control.",
        startOffsetMs: 5000,
        endOffsetMs: 9000,
        source: "manual_edit",
      },
      {
        id: "segment-3",
        sessionId: "session-dr-beat",
        speakerLabel: "clinician",
        text: "Follow up with me if the symptoms keep building, and call us right away if you feel out of control again.",
        startOffsetMs: 9000,
        endOffsetMs: 13000,
        source: "manual_edit",
      },
    ]);

    expect(analysis.findings.map((finding) => finding.code)).toContain(
      "urgent-symptom-escalation-needed"
    );
  });

  it("does not treat patient follow-up language as clinician instructions", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-auditor-review-ml-"));
    const modelPath = path.join(tempDir, "model.bin");
    fs.writeFileSync(modelPath, "");

    client = new PythonReviewMlClient({
      modelPath,
      pythonExecutable: "python3",
      workerPath,
    });

    const analysis = await client.analyzeTranscript("session-follow-up-gap", [
      {
        id: "segment-1",
        sessionId: "session-follow-up-gap",
        speakerLabel: "clinician",
        text: "Tell me more about the dizziness.",
        startOffsetMs: 0,
        endOffsetMs: 2000,
        source: "manual_edit",
      },
      {
        id: "segment-2",
        sessionId: "session-follow-up-gap",
        speakerLabel: "patient",
        text: "I know I should follow up if it gets worse.",
        startOffsetMs: 2000,
        endOffsetMs: 5000,
        source: "manual_edit",
      },
      {
        id: "segment-3",
        sessionId: "session-follow-up-gap",
        speakerLabel: "patient",
        text: "I will call if I keep feeling dizzy.",
        startOffsetMs: 5000,
        endOffsetMs: 8000,
        source: "manual_edit",
      },
    ]);

    expect(analysis.findings.map((finding) => finding.code)).toContain(
      "missing-follow-up-instructions"
    );
  });

  it("generates transcript segment ids that stay unique across sessions", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-auditor-review-ml-"));
    const modelPath = path.join(tempDir, "model.bin");
    const stubModulePath = path.join(tempDir, "faster_whisper.py");

    fs.writeFileSync(modelPath, "");
    fs.writeFileSync(
      stubModulePath,
      [
        "class Segment:",
        "    def __init__(self, text, start, end):",
        "        self.text = text",
        "        self.start = start",
        "        self.end = end",
        "",
        "class WhisperModel:",
        "    def __init__(self, *args, **kwargs):",
        "        pass",
        "",
        "    def transcribe(self, audio_path, language=None, word_timestamps=False):",
        "        return ([Segment(f'stub:{audio_path}', 0, 1)], None)",
      ].join("\n")
    );

    client = new PythonReviewMlClient({
      modelPath,
      pythonExecutable: "python3",
      workerEnv: {
        ...process.env,
        DOCTOR_AUDITOR_REVIEW_ML_PROVIDER: "faster_whisper",
        PYTHONPATH: tempDir,
      },
      workerPath,
    });

    const first = await client.transcribeFile(
      "alpha.wav",
      "session-alpha",
      "audio_import"
    );
    const second = await client.transcribeFile(
      "beta.wav",
      "session-beta",
      "audio_import"
    );

    expect(first[0]?.id).toBe("segment-sessionalpha-1");
    expect(second[0]?.id).toBe("segment-sessionbeta-1");
    expect(first[0]?.id).not.toBe(second[0]?.id);
  });

  it("generates finding ids that stay unique across sessions", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-auditor-review-ml-"));
    const modelPath = path.join(tempDir, "model.bin");
    fs.writeFileSync(modelPath, "");

    client = new PythonReviewMlClient({
      modelPath,
      pythonExecutable: "python3",
      workerPath,
    });

    const first = await client.analyzeTranscript("session-alpha", [
      {
        id: "segment-alpha-1",
        sessionId: "session-alpha",
        speakerLabel: "patient",
        text: "Emergency. I cannot control my feet and I am burning up.",
        startOffsetMs: 0,
        endOffsetMs: 4000,
        source: "manual_edit",
      },
    ]);
    const second = await client.analyzeTranscript("session-beta", [
      {
        id: "segment-beta-1",
        sessionId: "session-beta",
        speakerLabel: "patient",
        text: "Emergency. I cannot control my feet and I am burning up.",
        startOffsetMs: 0,
        endOffsetMs: 4000,
        source: "manual_edit",
      },
    ]);

    expect(first.findings[0]?.id).not.toBe(second.findings[0]?.id);
    expect(first.evidenceSpans[0]?.id).not.toBe(second.evidenceSpans[0]?.id);
  });
});
