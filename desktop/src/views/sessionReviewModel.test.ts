import type { DesktopSessionBundle } from "../types/electron";
import { describe, expect, it } from "vitest";
import {
  buildReviewWorkspace,
  countSelectedTranscriptSections,
  getApprovedExportActionState,
  getApprovedEvidenceSpans,
  hasApprovedEvidenceSelectionChanges,
  getPersistedOutcome,
  toggleTranscriptSegmentSelection,
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

describe("approved evidence selection", () => {
  it("prefers persisted approved evidence spans when available", () => {
    const bundle = createBundle({
      transcriptSegments: [
        createTranscriptSegment("segment-a", "Patient needs a refill soon."),
      ],
      findings: [
        createFinding("finding-1", [
          createEvidenceSpan("evidence-rule-1", "segment-a", "refill soon"),
        ]),
      ],
      reviewDecisions: [
        {
          id: "decision-1",
          sessionId: "session-1",
          findingId: "finding-1",
          outcome: "accepted",
          reviewedBy: "reviewer-1",
          reviewedAt: "2026-03-15T10:05:00Z",
          approvedEvidenceSpans: [
            createEvidenceSpan(
              "manual-finding-1-segment-a",
              "segment-a",
              "Patient needs a refill soon."
            ),
          ],
        },
      ],
    });

    expect(
      getApprovedEvidenceSpans(bundle.findings[0], bundle.reviewDecisions)
    ).toEqual(bundle.reviewDecisions[0]?.approvedEvidenceSpans);
  });

  it("removes and restores rule-suggested sections by transcript segment", () => {
    const finding = createFinding("finding-1", [
      createEvidenceSpan("evidence-rule-1", "segment-a", "swelling gets worse"),
    ]);
    const segment = createTranscriptSegment(
      "segment-a",
      "Call back if the swelling gets worse."
    );

    const withoutSegment = toggleTranscriptSegmentSelection(
      finding,
      segment,
      finding.evidenceSpans
    );
    expect(withoutSegment).toEqual([]);

    const restored = toggleTranscriptSegmentSelection(
      finding,
      segment,
      withoutSegment
    );
    expect(restored).toEqual(finding.evidenceSpans);
  });

  it("adds manual full-segment evidence when no rule suggestion exists", () => {
    const finding = createFinding("finding-1", [
      createEvidenceSpan("evidence-rule-1", "segment-a", "blood pressure"),
    ]);
    const manualSegment = createTranscriptSegment(
      "segment-b",
      "Please also monitor your weight at home."
    );

    expect(
      toggleTranscriptSegmentSelection(finding, manualSegment, finding.evidenceSpans)
    ).toEqual([
      ...finding.evidenceSpans,
      {
        id: "manual-finding-1-segment-b",
        transcriptSegmentId: "segment-b",
        excerpt: "Please also monitor your weight at home.",
        startOffsetMs: 0,
        endOffsetMs: 4200,
        startTextOffset: 0,
        endTextOffset: 40,
      },
    ]);
  });

  it("tracks dirty state and selected section counts from unique transcript segments", () => {
    const persisted = [
      createEvidenceSpan("evidence-a", "segment-a", "first excerpt"),
      createEvidenceSpan("evidence-b", "segment-b", "second excerpt"),
      createEvidenceSpan("evidence-c", "segment-b", "another excerpt"),
    ];
    const reordered = [persisted[2], persisted[0], persisted[1]];
    const changed = persisted.slice(0, 2);

    expect(hasApprovedEvidenceSelectionChanges(reordered, persisted)).toBe(false);
    expect(hasApprovedEvidenceSelectionChanges(changed, persisted)).toBe(true);
    expect(countSelectedTranscriptSections(persisted)).toBe(2);
  });
});

describe("getApprovedExportActionState", () => {
  it("enables approval only when export has not already been created", () => {
    const baseSession = createBundle({}).session;
    const bundle = createBundle({
      session: {
        ...baseSession,
        reviewStatus: "completed",
        exportStatus: "not_requested",
        consent: {
          ...baseSession.consent,
          exportAllowed: true,
        },
      },
    });

    expect(
      getApprovedExportActionState(bundle.session, false)
    ).toEqual({
      disabled: false,
      label: "Approve export envelope",
    });
  });

  it("shows approved exports as a disabled status action", () => {
    const baseSession = createBundle({}).session;
    const bundle = createBundle({
      session: {
        ...baseSession,
        reviewStatus: "completed",
        exportStatus: "approved",
      },
    });

    expect(
      getApprovedExportActionState(bundle.session, false)
    ).toEqual({
      disabled: true,
      label: "Export envelope approved",
    });
  });

  it("shows in-flight export creation as saving", () => {
    const baseSession = createBundle({}).session;
    const bundle = createBundle({
      session: {
        ...baseSession,
        reviewStatus: "completed",
      },
    });

    expect(
      getApprovedExportActionState(bundle.session, true)
    ).toEqual({
      disabled: true,
      label: "Saving export...",
    });
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
        remoteAssistAllowed: false,
        policyVersion: "local-only-v1",
      },
    },
    transcriptSegments: [],
    findings: [],
    reviewDecisions: [],
    approvedExports: [],
    auditLogEntries: [],
    modelAssistReceipts: [],
    ...overrides,
  };
}

function createTranscriptSegment(id: string, text: string) {
  return {
    id,
    sessionId: "session-1",
    speakerLabel: "patient" as const,
    text,
    startOffsetMs: 0,
    endOffsetMs: 4200,
    source: "audio_import" as const,
  };
}

function createEvidenceSpan(
  id: string,
  transcriptSegmentId: string,
  excerpt: string
) {
  return {
    id,
    transcriptSegmentId,
    excerpt,
    startOffsetMs: 0,
    endOffsetMs: 4200,
  };
}

function createFinding(
  id: string,
  evidenceSpans: Array<ReturnType<typeof createEvidenceSpan>>
) {
  return {
    id,
    sessionId: "session-1",
    code: "follow-up-plan",
    title: "Follow-up instructions should be confirmed",
    summary: "Summary",
    status: "pending_review" as const,
    confidence: 0.8,
    evidenceSpans,
    detectedBy: "rules" as const,
    createdAt: "2026-03-15T10:00:00Z",
    updatedAt: "2026-03-15T10:00:00Z",
  };
}
