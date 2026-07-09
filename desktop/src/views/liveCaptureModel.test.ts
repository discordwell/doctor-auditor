import type { MicrophoneAccessStatus } from "../types/electron";
import { describe, expect, it } from "vitest";

import { formatMicrophoneAccess } from "./liveCaptureModel";

describe("formatMicrophoneAccess", () => {
  it("labels every microphone access status", () => {
    const cases: Record<MicrophoneAccessStatus, string> = {
      granted: "Microphone granted",
      denied: "Microphone denied",
      restricted: "Microphone restricted",
      "not-determined": "Microphone prompt pending",
      unsupported: "Permission status unavailable",
      unknown: "Permission status unknown",
    };
    for (const [status, label] of Object.entries(cases)) {
      expect(
        formatMicrophoneAccess(status as MicrophoneAccessStatus)
      ).toBe(label);
    }
  });
});
