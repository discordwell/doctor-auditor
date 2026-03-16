import { describe, expect, it } from "vitest";

import type { OperationsSnapshot } from "./opsDashboard";
import {
  buildAssistAssessmentCards,
  buildOverviewModel,
  buildSessionActivityGroups,
  formatAssistDisposition,
  formatLatency,
  formatStatusLabel,
  getExportTone,
  getOpsTone,
  sortApprovedExports,
  sortOpsEvents,
} from "./opsDashboard";

const sampleSnapshot: OperationsSnapshot = {
  approvedExports: [
    {
      id: "export-demo-001",
      organizationId: "demo-health",
      session: {
        localSessionId: "session-demo-002",
        clinicianId: "clinician-ada",
        encounterStartedAt: "2026-03-08T17:00:00Z",
        encounterEndedAt: "2026-03-08T17:22:00Z",
        captureMode: "audio_import",
      },
      consent: {
        recordedWithConsent: true,
        exportAllowed: true,
        remoteAssistAllowed: true,
        policyVersion: "policy-v1",
      },
      export: {
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
      attestation: {
        reviewedBy: "reviewer-1",
        reviewCompletedAt: "2026-03-09T11:00:00Z",
        clientVersion: "desktop-demo-1.0.0",
        localBundleHash: "bundle-hash-demo-001",
        assistReceiptIds: ["assist-demo-001"],
      },
    },
    {
      id: "export-demo-002",
      organizationId: "demo-health",
      session: {
        localSessionId: "session-demo-004",
        clinicianId: "clinician-noor",
        encounterStartedAt: "2026-03-14T13:00:00Z",
        encounterEndedAt: "2026-03-14T13:19:00Z",
        captureMode: "audio_import",
      },
      consent: {
        recordedWithConsent: true,
        exportAllowed: true,
        remoteAssistAllowed: false,
        policyVersion: "policy-v1",
      },
      export: {
        id: "export-demo-002",
        sessionId: "session-demo-004",
        status: "approved",
        summary: "Approved export packet for the updated handoff summary.",
        findings: [],
        approvedBy: "quality-lead-2",
        approvedAt: "2026-03-15T08:40:00Z",
        destination: "claims-review-queue",
      },
      attestation: {
        reviewedBy: "quality-lead-2",
        reviewCompletedAt: "2026-03-15T08:35:00Z",
        clientVersion: "desktop-demo-1.0.0",
        localBundleHash: "bundle-hash-demo-002",
        assistReceiptIds: [],
      },
    },
    {
      id: "export-demo-003",
      organizationId: "demo-health",
      session: {
        localSessionId: "session-demo-005",
        clinicianId: "clinician-lin",
        encounterStartedAt: "2026-03-12T14:00:00Z",
        encounterEndedAt: "2026-03-12T14:16:00Z",
        captureMode: "audio_import",
      },
      consent: {
        recordedWithConsent: true,
        exportAllowed: true,
        remoteAssistAllowed: false,
        policyVersion: "policy-v1",
      },
      export: {
        id: "export-demo-003",
        sessionId: "session-demo-005",
        status: "draft",
        summary: "Draft export packet waiting on approval.",
        findings: [],
        approvedBy: "quality-lead-3",
        approvedAt: "2026-03-12T09:30:00Z",
        destination: "internal-quality-review",
      },
      attestation: {
        reviewedBy: "reviewer-3",
        reviewCompletedAt: "2026-03-12T09:25:00Z",
        clientVersion: "desktop-demo-1.0.0",
        localBundleHash: "bundle-hash-demo-003",
        assistReceiptIds: [],
      },
    },
  ],
  opsEvents: [
    {
      id: "ops-demo-001",
      organizationId: "demo-health",
      localSessionId: "session-demo-002",
      assistReceiptId: "assist-demo-001",
      type: "assist_requested",
      recordedAt: "2026-03-09T10:58:00Z",
      actorId: "reviewer-1",
      provider: "doctor-auditor-assist-gateway",
      model: "policy-heuristic-v1",
      policyMode: "minimized_no_raw_phi",
    },
    {
      id: "ops-demo-002",
      organizationId: "demo-health",
      localSessionId: "session-demo-002",
      assistReceiptId: "assist-demo-001",
      type: "assist_completed",
      recordedAt: "2026-03-09T11:01:00Z",
      actorId: "reviewer-1",
      provider: "doctor-auditor-assist-gateway",
      model: "policy-heuristic-v1",
      policyMode: "minimized_no_raw_phi",
      latencyMs: 712,
      assessment: {
        disposition: "expedited_human_review",
        confidence: 0.79,
        rationale:
          "The finding code maps to a higher-acuity review lane and should be triaged by a human reviewer.",
        limitations: [
          "Only minimized structured context was provided.",
          "No raw audio, full transcript, or free-text evidence was available.",
        ],
        provider: "doctor-auditor-assist-gateway",
        model: "policy-heuristic-v1",
        assessedAt: "2026-03-09T11:01:00Z",
      },
    },
    {
      id: "ops-demo-003",
      organizationId: "demo-health",
      localSessionId: "session-demo-002",
      assistReceiptId: "assist-demo-001",
      type: "assist_overridden",
      recordedAt: "2026-03-09T11:10:00Z",
      actorId: "quality-lead-1",
      reviewerAction: "dismissed",
    },
    {
      id: "ops-demo-004",
      organizationId: "demo-health",
      localSessionId: "session-demo-004",
      type: "redaction_blocked",
      recordedAt: "2026-03-15T08:10:00Z",
      actorId: "quality-lead-2",
      errorCode: "manual-redaction-required",
    },
    {
      id: "ops-demo-005",
      organizationId: "demo-health",
      localSessionId: "session-demo-004",
      assistReceiptId: "assist-demo-004",
      type: "assist_failed",
      recordedAt: "2026-03-15T08:12:00Z",
      actorId: "quality-lead-2",
      provider: "doctor-auditor-assist-gateway",
      model: "policy-heuristic-v1",
      policyMode: "minimized_no_raw_phi",
      latencyMs: 1180,
      errorCode: "gateway-timeout",
    },
  ],
};

describe("opsDashboard helpers", () => {
  it("builds stable overview metrics from export and ops data", () => {
    const model = buildOverviewModel(
      sampleSnapshot,
      new Date("2026-03-16T12:00:00Z")
    );

    expect(model.totalExports).toBe(3);
    expect(model.approvedExports).toBe(1);
    expect(model.sentExports).toBe(1);
    expect(model.assistUsageCount).toBe(1);
    expect(model.assistOverrideCount).toBe(1);
    expect(model.redactionBlockCount).toBe(1);
    expect(model.queueLanes.map((lane) => lane.count)).toEqual([1, 1, 1]);
    expect(model.weeklyActivity).toHaveLength(6);
    expect(model.averageSendLatencyMs).toBe(35 * 60 * 1000);
    expect(model.activityFeed).toHaveLength(3);
    expect(model.activityFeed[0]).toMatchObject({
      id: "session-demo-004",
      title: "Approved export packet for the updated handoff summary.",
      label: "Export approved",
    });
  });

  it("sorts approved exports newest first", () => {
    const approvedExports = sortApprovedExports(sampleSnapshot.approvedExports);

    expect(approvedExports[0]?.id).toBe("export-demo-002");
    expect(approvedExports[2]?.id).toBe("export-demo-001");
  });

  it("sorts ops events newest first", () => {
    const opsEvents = sortOpsEvents(sampleSnapshot.opsEvents);

    expect(opsEvents[0]?.id).toBe("ops-demo-005");
    expect(opsEvents[opsEvents.length - 1]?.id).toBe("ops-demo-001");
  });

  it("builds assist assessment cards with overrides and failures", () => {
    const cards = buildAssistAssessmentCards(sampleSnapshot.opsEvents);

    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      id: "ops-demo-005",
      status: "failed",
      tone: "attention",
    });
    expect(cards[1]).toMatchObject({
      id: "ops-demo-002",
      disposition: "expedited_human_review",
      reviewerAction: "dismissed",
      tone: "attention",
    });
  });

  it("compresses activity into grouped session cards with session context", () => {
    const groups = buildSessionActivityGroups(sampleSnapshot);

    expect(groups).toHaveLength(3);

    const sentSession = groups.find(
      (item) => item.localSessionId === "session-demo-002"
    );
    expect(sentSession).toMatchObject({
      exportSummary:
        "Final export covering the reviewed empathy acknowledgement.",
      latestAssistStatus: "completed",
      latestAssistDisposition: "expedited_human_review",
      latestAssistReviewerAction: "Dismissed",
      eventCount: 5,
    });
    expect(sentSession?.activity.map((item) => item.label)).toEqual([
      "Export sent",
      "Export approved",
      "Remote assist overridden",
      "Remote assist completed",
      "Remote assist requested",
    ]);

    const failedSession = groups.find(
      (item) => item.localSessionId === "session-demo-004"
    );
    expect(failedSession).toMatchObject({
      latestAssistStatus: "failed",
      latestAssistErrorCode: "gateway-timeout",
      eventCount: 3,
    });

    const draftSession = groups.find(
      (item) => item.localSessionId === "session-demo-005"
    );
    expect(draftSession).toMatchObject({
      exportStatus: "draft",
      eventCount: 0,
    });
  });

  it("normalizes labels and tones consistently", () => {
    expect(formatStatusLabel("assist_requested")).toBe("Remote assist requested");
    expect(formatAssistDisposition("insufficient_context")).toBe(
      "Insufficient context"
    );
    expect(formatLatency(712)).toBe("712 ms");
    expect(getExportTone("approved")).toBe("attention");
    expect(getOpsTone("assist_completed")).toBe("active");
  });
});
