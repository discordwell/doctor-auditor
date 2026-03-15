import { describe, expect, it } from "vitest";
import type {
  ModelAssistReceipt,
  ReviewSession,
  TranscriptSegment,
} from "@doctor-auditor/shared/local-review";
import type { DesktopSessionBundle } from "./review-models";
import {
  buildModelAssistRequest,
  isRemoteAssistAllowedForExport,
} from "./model-assist";

describe("model assist request shaping", () => {
  it("builds a session-level request when no finding is selected", () => {
    const bundle = createBundle({
      transcriptSegments: [
        createSegment("segment-001", "clinician"),
        createSegment("segment-002", "patient"),
      ],
    });

    const request = buildModelAssistRequest(bundle);

    expect(request.findingId).toBeUndefined();
    expect(request.concern.findingCode).toBe("session-review-overview");
    expect(request.concern.findingStatus).toBe("draft");
    expect(request.concern.findingConfidence).toBe(0);
    expect(request.concern.evidenceSpanCount).toBe(0);
    expect(request.concern.speakerLabels).toEqual(["clinician", "patient"]);
    expect(request.concern.captureMode).toBe("audio_import");
    expect(request.concern.encounterDurationMs).toBe(15 * 60 * 1000);
  });

  it("does not require evidence spans to build a finding-level request", () => {
    const bundle = createBundle({
      transcriptSegments: [
        createSegment("segment-001", "patient"),
        createSegment("segment-002", "clinician"),
      ],
      findings: [
        {
          id: "finding-001",
          sessionId: "session-001",
          code: "medication-risk",
          title: "Medication risk needs review",
          summary: "The finding is still useful even without linked evidence.",
          status: "rejected",
          confidence: 0.77,
          evidenceSpans: [],
          detectedBy: "rules",
          createdAt: "2026-03-15T10:05:00Z",
          updatedAt: "2026-03-15T10:05:00Z",
        },
      ],
    });

    const request = buildModelAssistRequest(bundle, bundle.findings[0]);

    expect(request.findingId).toBe("finding-001");
    expect(request.concern.findingCode).toBe("medication-risk");
    expect(request.concern.findingStatus).toBe("rejected");
    expect(request.concern.findingConfidence).toBe(0.77);
    expect(request.concern.evidenceSpanCount).toBe(0);
    expect(request.concern.speakerLabels).toEqual(["patient", "clinician"]);
  });

  it("treats existing assist receipts as exportable assist usage", () => {
    const bundle = createBundle({
      session: {
        consent: {
          recordedWithConsent: true,
          exportAllowed: true,
          remoteAssistAllowed: false,
          policyVersion: "policy-v1",
          capturedAt: "2026-03-15T10:00:00Z",
          capturedBy: "desktop",
        },
      },
      modelAssistReceipts: [
        {
          id: "assist-receipt-001",
          requestId: "assist-request-001",
          sessionId: "session-001",
          status: "completed",
          policyMode: "minimized_no_raw_phi",
          requestedAt: "2026-03-15T10:06:00Z",
          completedAt: "2026-03-15T10:06:01Z",
          latencyMs: 180,
          reviewerAction: "not_applied",
          assessment: {
            disposition: "routine_review",
            confidence: 0.61,
            rationale: "Synthetic assist receipt for exportability coverage.",
            limitations: ["Synthetic test request."],
            provider: "test-provider",
            model: "test-model",
            assessedAt: "2026-03-15T10:06:01Z",
          },
        } satisfies ModelAssistReceipt,
      ],
    });

    expect(isRemoteAssistAllowedForExport(bundle)).toBe(true);
  });
});

function createBundle(
  overrides: Omit<Partial<DesktopSessionBundle>, "session"> & {
    session?: Partial<ReviewSession>;
  } = {}
): DesktopSessionBundle {
  const session = {
    id: "session-001",
    clinicianId: "Dr. Test",
    encounterStartedAt: "2026-03-15T10:00:00Z",
    encounterEndedAt: "2026-03-15T10:15:00Z",
    captureMode: "audio_import",
    transcriptStatus: "completed",
    reviewStatus: "not_started",
    exportStatus: "not_requested",
    createdAt: "2026-03-15T10:00:00Z",
    updatedAt: "2026-03-15T10:05:00Z",
    consent: {
      recordedWithConsent: true,
      exportAllowed: true,
      remoteAssistAllowed: true,
      policyVersion: "policy-v1",
      capturedAt: "2026-03-15T10:00:00Z",
      capturedBy: "desktop",
    },
    ...(overrides.session ?? {}),
  } satisfies ReviewSession;

  return {
    session,
    transcriptSegments: overrides.transcriptSegments ?? [],
    findings: overrides.findings ?? [],
    reviewDecisions: overrides.reviewDecisions ?? [],
    approvedExports: overrides.approvedExports ?? [],
    auditLogEntries: overrides.auditLogEntries ?? [],
    modelAssistReceipts: overrides.modelAssistReceipts ?? [],
    audioPath: overrides.audioPath,
  };
}

function createSegment(
  id: string,
  speakerLabel: TranscriptSegment["speakerLabel"]
): TranscriptSegment {
  return {
    id,
    sessionId: "session-001",
    speakerLabel,
    text: "Synthetic transcript content.",
    startOffsetMs: 0,
    endOffsetMs: 1000,
    source: "audio_import",
  };
}
