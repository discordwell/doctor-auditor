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
  });
});
