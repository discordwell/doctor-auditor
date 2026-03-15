import { randomUUID } from "crypto";
import type {
  Finding,
  FindingStatus,
  ModelAssistRequest,
  TranscriptSegment,
} from "@doctor-auditor/shared/local-review";
import type { DesktopSessionBundle } from "./review-models";

const DESKTOP_REVIEWER_ID = "desktop";
const SESSION_LEVEL_FINDING_CODE = "session-review-overview";
const SESSION_LEVEL_FINDING_STATUS: FindingStatus = "draft";

export function buildModelAssistRequest(
  bundle: DesktopSessionBundle,
  finding?: Finding
): ModelAssistRequest {
  const requestedAt = new Date().toISOString();

  return {
    id: `assist-request-${randomUUID()}`,
    sessionId: bundle.session.id,
    findingId: finding?.id,
    requestedBy: DESKTOP_REVIEWER_ID,
    requestedAt,
    policyVersion: bundle.session.consent.policyVersion,
    policyMode: "minimized_no_raw_phi",
    concern: buildMinimizedConcernPacket(bundle, finding),
  };
}

export function isRemoteAssistAllowedForExport(
  bundle: DesktopSessionBundle
): boolean {
  return (
    bundle.session.consent.remoteAssistAllowed ||
    bundle.modelAssistReceipts.length > 0
  );
}

function buildMinimizedConcernPacket(
  bundle: DesktopSessionBundle,
  finding?: Finding
): ModelAssistRequest["concern"] {
  const encounterStartedAt = Date.parse(bundle.session.encounterStartedAt);
  const encounterEndedAt = Date.parse(
    bundle.session.encounterEndedAt ?? bundle.session.encounterStartedAt
  );
  const encounterDurationMs =
    Number.isNaN(encounterStartedAt) || Number.isNaN(encounterEndedAt)
      ? undefined
      : Math.max(encounterEndedAt - encounterStartedAt, 0);

  return {
    findingCode: finding?.code ?? SESSION_LEVEL_FINDING_CODE,
    findingStatus: finding?.status ?? SESSION_LEVEL_FINDING_STATUS,
    findingConfidence: finding?.confidence ?? 0,
    evidenceSpanCount: finding?.evidenceSpans.length ?? 0,
    speakerLabels: collectSpeakerLabels(bundle, finding),
    captureMode: bundle.session.captureMode,
    encounterDurationMs,
  };
}

function collectSpeakerLabels(
  bundle: DesktopSessionBundle,
  finding?: Finding
): TranscriptSegment["speakerLabel"][] {
  const transcriptSegments =
    finding && finding.evidenceSpans.length > 0
      ? finding.evidenceSpans
          .map((span) =>
            bundle.transcriptSegments.find(
              (segment) => segment.id === span.transcriptSegmentId
            )
          )
          .filter((segment): segment is TranscriptSegment => Boolean(segment))
      : bundle.transcriptSegments;

  return Array.from(
    new Set(transcriptSegments.map((segment) => segment.speakerLabel))
  );
}
