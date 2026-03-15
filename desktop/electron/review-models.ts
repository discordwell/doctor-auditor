import type { ReviewSession, SessionBundle } from "@doctor-auditor/shared";

export interface SessionIntakeRequest {
  clinicianId: string;
  recordedWithConsent: boolean;
  exportAllowed: boolean;
}

export type ImportSessionRequest = SessionIntakeRequest;
export type LiveCaptureRequest = SessionIntakeRequest;

export interface DesktopSessionSummary {
  session: ReviewSession;
  audioPath?: string;
  transcriptSegmentCount: number;
}

export interface DesktopSessionBundle extends SessionBundle {
  audioPath?: string;
}

export interface AudioDevice {
  id: string;
  name: string;
  isDefault: boolean;
}

export type RecorderBackend = "sox" | "rec";

export type MicrophoneAccessStatus =
  | "not-determined"
  | "granted"
  | "denied"
  | "restricted"
  | "unknown"
  | "unsupported";

export interface LiveCaptureStatus {
  available: boolean;
  experimental: boolean;
  recorder: RecorderBackend | null;
  microphoneAccess: MicrophoneAccessStatus;
  issues: string[];
  notes: string[];
}
