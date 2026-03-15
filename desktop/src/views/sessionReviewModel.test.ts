import type { DesktopSessionBundle } from "../types/electron";
import { describe, expect, it } from "vitest";
import {
  buildReviewWorkspace,
  getPersistedOutcome,
} from "./sessionReviewModel";

describe("buildReviewWorkspace", () => {
  it("does not fabricate transcript or findings when data is missing", () => {
    const bundle = createBundle({
      transcriptSegments: [],
      findings: [],
      reviewDecisions: [],
    });

    const workspace = buildReviewWorkspace(bundle);

    expect(workspace.hasTranscript).toBe(false);
    expect(workspace.hasFindings).toBe(false);
    expect(workspace.transcriptSegments).toHaveLength(0);
    expect(workspace.findings).toHaveLength(0);
  });

  it("keeps real persisted transcript and findings", () => {
    const bundle = createBundle({
      transcriptSegments: [
        {
          id: "segment-a",
          sessionId: "session-1",
          speakerLabel: "patient",
          text: "When should I call back if the swelling gets worse?",
          startOffsetMs: 0,
          endOffsetMs: 4200,
          source: "audio_import",
        },
        {
          id: "segment-b",
          sessionId: "session-1",
          speakerLabel: "clinician",
          text: "Let's check in next week if that does not settle down.",
          startOffsetMs: 7000,
          endOffsetMs: 11000,
          source: "audio_import",
        },
      ],
      findings: [
        {
          id: "finding-1",
          sessionId: "session-1",
          code: "follow-up-plan",
          title: "Follow-up instructions should be confirmed",
          summary: "Summary",
          status: "pending_review",
          confidence: 0.8,
          evidenceSpans: [],
          detectedBy: "rules",
          createdAt: "2026-03-15T10:00:00Z",
          updatedAt: "2026-03-15T10:00:00Z",
        },
      ],
      reviewDecisions: [],
    });

    const workspace = buildReviewWorkspace(bundle);

    expect(workspace.hasTranscript).toBe(true);
    expect(workspace.hasFindings).toBe(true);
    expect(workspace.transcriptSegments).toHaveLength(2);
    expect(workspace.findings.map((finding) => finding.code)).toEqual([
      "follow-up-plan",
    ]);
  });
});

describe("getPersistedOutcome", () => {
  it("prefers the linked review decision outcome when one exists", () => {
    const bundle = createBundle({
      transcriptSegments: [],
      findings: [
        {
          id: "finding-1",
          sessionId: "session-1",
          code: "medication-adherence",
          title: "Medication adherence needs reviewer confirmation",
          summary: "Summary",
          status: "pending_review",
          confidence: 0.8,
          evidenceSpans: [],
          detectedBy: "rules",
          createdAt: "2026-03-15T10:00:00Z",
          updatedAt: "2026-03-15T10:00:00Z",
          reviewDecisionId: "decision-1",
        },
      ],
      reviewDecisions: [
        {
          id: "decision-1",
          sessionId: "session-1",
          findingId: "finding-1",
          outcome: "accepted",
          reviewedBy: "reviewer-1",
          reviewedAt: "2026-03-15T10:05:00Z",
        },
      ],
    });

    expect(
      getPersistedOutcome(bundle.findings[0], bundle.reviewDecisions)
    ).toBe("accepted");
  });
});

function createBundle(
  overrides: Partial<DesktopSessionBundle>
): DesktopSessionBundle {
  return {
    session: {
      id: "session-1",
      clinicianId: "Dr. Rivera",
      encounterStartedAt: "2026-03-15T10:00:00Z",
      encounterEndedAt: "2026-03-15T10:18:00Z",
      captureMode: "audio_import",
      transcriptStatus: "completed",
      reviewStatus: "ready",
      exportStatus: "not_requested",
      createdAt: "2026-03-15T10:00:00Z",
      updatedAt: "2026-03-15T10:00:00Z",
      consent: {
        recordedWithConsent: true,
        exportAllowed: true,
      },
    },
    transcriptSegments: [],
    findings: [],
    reviewDecisions: [],
    approvedExports: [],
    auditLogEntries: [],
    ...overrides,
  };
}
