import { describe, expect, it } from "vitest";

import type { ReviewSnapshot } from "./reviewDashboard";
import {
  buildOverviewModel,
  formatStatusLabel,
  getExportTone,
  getFindingTone,
  getSessionStatusTone,
  sortApprovedExports,
  sortFindings,
  sortSessions,
} from "./reviewDashboard";

const sampleSnapshot: ReviewSnapshot = {
  sessions: [
    {
      id: "session-demo-001",
      clinicianId: "clinician-ada",
      organizationId: "demo-health",
      encounterStartedAt: "2026-03-10T15:00:00Z",
      encounterEndedAt: "2026-03-10T15:28:00Z",
      captureMode: "audio_import",
      transcriptStatus: "completed",
      reviewStatus: "in_review",
      exportStatus: "draft",
      createdAt: "2026-03-10T15:35:00Z",
      updatedAt: "2026-03-12T09:15:00Z",
      consent: {
        recordedWithConsent: true,
        exportAllowed: true,
      },
    },
    {
      id: "session-demo-002",
      clinicianId: "clinician-ada",
      organizationId: "demo-health",
      encounterStartedAt: "2026-03-08T17:00:00Z",
      encounterEndedAt: "2026-03-08T17:22:00Z",
      captureMode: "audio_import",
      transcriptStatus: "completed",
      reviewStatus: "completed",
      exportStatus: "sent",
      createdAt: "2026-03-08T17:30:00Z",
      updatedAt: "2026-03-09T11:00:00Z",
      consent: {
        recordedWithConsent: true,
        exportAllowed: true,
      },
    },
    {
      id: "session-demo-003",
      clinicianId: "clinician-lin",
      organizationId: "demo-health",
      encounterStartedAt: "2026-03-13T19:10:00Z",
      encounterEndedAt: "2026-03-13T19:41:00Z",
      captureMode: "live_capture",
      transcriptStatus: "completed",
      reviewStatus: "ready",
      exportStatus: "not_requested",
      createdAt: "2026-03-13T19:45:00Z",
      updatedAt: "2026-03-14T07:40:00Z",
      consent: {
        recordedWithConsent: true,
        exportAllowed: false,
      },
    },
    {
      id: "session-demo-004",
      clinicianId: "clinician-noor",
      organizationId: "demo-health",
      encounterStartedAt: "2026-03-14T13:00:00Z",
      encounterEndedAt: "2026-03-14T13:19:00Z",
      captureMode: "audio_import",
      transcriptStatus: "completed",
      reviewStatus: "completed",
      exportStatus: "approved",
      createdAt: "2026-03-14T13:26:00Z",
      updatedAt: "2026-03-15T08:35:00Z",
      consent: {
        recordedWithConsent: true,
        exportAllowed: true,
      },
    },
  ],
  findings: [
    {
      id: "finding-demo-001",
      sessionId: "session-demo-001",
      code: "follow-up-plan",
      title: "Follow-up plan still needs reviewer confirmation",
      summary: "Timing language is still ambiguous in the export packet.",
      status: "pending_review",
      confidence: 0.82,
      evidenceSpans: [],
      detectedBy: "rules",
      createdAt: "2026-03-10T15:40:00Z",
      updatedAt: "2026-03-12T09:15:00Z",
    },
    {
      id: "finding-demo-002",
      sessionId: "session-demo-001",
      code: "medication-risk",
      title: "Medication side-effect counseling needs evidence trim",
      summary: "Evidence spans overlap and need cleanup before approval.",
      status: "uncertain",
      confidence: 0.71,
      evidenceSpans: [],
      detectedBy: "local_llm",
      createdAt: "2026-03-10T15:42:00Z",
      updatedAt: "2026-03-12T09:20:00Z",
    },
    {
      id: "finding-demo-003",
      sessionId: "session-demo-002",
      code: "empathy-gap",
      title: "Patient concern was acknowledged and approved",
      summary: "Reviewer accepted this finding for the final export.",
      status: "accepted",
      confidence: 0.65,
      evidenceSpans: [],
      detectedBy: "human",
      createdAt: "2026-03-08T17:35:00Z",
      updatedAt: "2026-03-09T11:00:00Z",
      reviewDecisionId: "decision-demo-001",
    },
    {
      id: "finding-demo-004",
      sessionId: "session-demo-003",
      code: "direct-question",
      title: "Direct patient question has not been answered yet",
      summary: "The answer is missing from the current evidence set.",
      status: "draft",
      confidence: 0.8,
      evidenceSpans: [],
      detectedBy: "rules",
      createdAt: "2026-03-13T19:48:00Z",
      updatedAt: "2026-03-14T07:40:00Z",
    },
    {
      id: "finding-demo-005",
      sessionId: "session-demo-004",
      code: "handoff-clarity",
      title: "Handoff summary was edited during review",
      summary: "Reviewer tightened the summary language before export approval.",
      status: "revised",
      confidence: 0.77,
      evidenceSpans: [],
      detectedBy: "local_llm",
      createdAt: "2026-03-14T13:29:00Z",
      updatedAt: "2026-03-15T08:35:00Z",
      reviewDecisionId: "decision-demo-002",
    },
  ],
  approvedExports: [
    {
      id: "export-demo-001",
      sessionId: "session-demo-002",
      status: "sent",
      summary: "Final export covering the reviewed empathy acknowledgement.",
      findings: [],
      approvedBy: "quality-lead-1",
      approvedAt: "2026-03-09T11:20:00Z",
      destination: "compliance-archive",
      sentAt: "2026-03-09T11:55:00Z",
    },
    {
      id: "export-demo-002",
      sessionId: "session-demo-004",
      status: "approved",
      summary: "Approved export packet for the updated handoff summary.",
      findings: [],
      approvedBy: "quality-lead-2",
      approvedAt: "2026-03-15T08:40:00Z",
      destination: "claims-review-queue",
    },
    {
      id: "export-demo-003",
      sessionId: "session-demo-001",
      status: "draft",
      summary: "Draft export waiting for final confirmation.",
      findings: [],
      approvedBy: "quality-lead-3",
      approvedAt: "2026-03-12T09:30:00Z",
      destination: "internal-quality-review",
    },
  ],
};

describe("reviewDashboard helpers", () => {
  it("builds stable overview metrics from review data", () => {
    const model = buildOverviewModel(
      sampleSnapshot,
      new Date("2026-03-15T12:00:00Z")
    );

    expect(model.sessionsInScope).toBe(4);
    expect(model.openFindings).toBe(4);
    expect(model.reviewedFindings).toBe(2);
    expect(model.approvedExportCount).toBe(2);
    expect(model.agingItems).toBe(1);
    expect(model.queueLanes.map((lane) => lane.count)).toEqual([2, 2, 2]);
    expect(model.weeklyActivity).toHaveLength(6);
  });

  it("sorts and filters sessions by review status", () => {
    const sessions = sortSessions(sampleSnapshot.sessions, "completed");

    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.id).toBe("session-demo-004");
    expect(sessions[1]?.id).toBe("session-demo-002");
  });

  it("orders findings by queue priority before timestamp", () => {
    const findings = sortFindings(sampleSnapshot.findings);

    expect(findings[0]?.status).toBe("pending_review");
    expect(findings[1]?.status).toBe("draft");
    expect(findings[findings.length - 1]?.status).toBe("accepted");
  });

  it("sorts approved exports newest first", () => {
    const approvedExports = sortApprovedExports(sampleSnapshot.approvedExports);

    expect(approvedExports[0]?.id).toBe("export-demo-002");
    expect(approvedExports[2]?.id).toBe("export-demo-001");
  });

  it("normalizes labels and tones consistently", () => {
    expect(formatStatusLabel("pending_review")).toBe("pending review");
    expect(getSessionStatusTone("in_review")).toBe("active");
    expect(getFindingTone("accepted")).toBe("success");
    expect(getExportTone("approved")).toBe("attention");
  });
});
