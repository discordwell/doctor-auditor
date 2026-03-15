import type { ReviewSession, SessionBundle } from "@doctor-auditor/shared";

export interface DesktopSessionSummary {
  session: ReviewSession;
  audioPath?: string;
  transcriptSegmentCount: number;
}

export interface DesktopSessionBundle extends SessionBundle {
  audioPath?: string;
}

export interface ImportSessionRequest {
  clinicianId: string;
  recordedWithConsent: boolean;
  exportAllowed: boolean;
}
