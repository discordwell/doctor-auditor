import type { LiveCaptureStatus } from "../types/electron";

/**
 * Pure presentation helper for live-capture microphone permission state, shared
 * by RecordingView and SettingsView. Both views render the same permission
 * banner, so keeping one copy here means the two surfaces can never disagree on
 * what a given `microphoneAccess` value is called (same rationale as
 * sessionSummaryModel.ts).
 */
export function formatMicrophoneAccess(
  value: LiveCaptureStatus["microphoneAccess"]
): string {
  switch (value) {
    case "granted":
      return "Microphone granted";
    case "denied":
      return "Microphone denied";
    case "restricted":
      return "Microphone restricted";
    case "not-determined":
      return "Microphone prompt pending";
    case "unsupported":
      return "Permission status unavailable";
    case "unknown":
      return "Permission status unknown";
  }
}
