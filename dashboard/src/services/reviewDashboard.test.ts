import { describe, expect, it } from "vitest";

import type { OperationsSnapshot } from "./reviewDashboard";
import {
  buildOverviewModel,
  formatStatusLabel,
  getExportTone,
  getOpsTone,
  sortApprovedExports,
  sortOpsEvents,
} from "./reviewDashboard";

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
      type: "assist_overridden",
      recordedAt: "2026-03-09T11:10:00Z",
      actorId: "quality-lead-1",
      reviewerAction: "dismissed",
    },
    {
      id: "ops-demo-003",
      organizationId: "demo-health",
      localSessionId: "session-demo-004",
      type: "redaction_blocked",
      recordedAt: "2026-03-15T08:10:00Z",
      actorId: "quality-lead-2",
      errorCode: "manual-redaction-required",
    },
    {
      id: "ops-demo-004",
      organizationId: "demo-health",
      localSessionId: "session-demo-004",
      type: "assist_failed",
      recordedAt: "2026-03-15T08:12:00Z",
      actorId: "quality-lead-2",
      errorCode: "gateway-timeout",
    },
  ],
};

describe("reviewDashboard helpers", () => {
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
  });

  it("sorts approved exports newest first", () => {
    const approvedExports = sortApprovedExports(sampleSnapshot.approvedExports);

    expect(approvedExports[0]?.id).toBe("export-demo-002");
    expect(approvedExports[2]?.id).toBe("export-demo-001");
  });

  it("sorts ops events newest first", () => {
    const opsEvents = sortOpsEvents(sampleSnapshot.opsEvents);

    expect(opsEvents[0]?.id).toBe("ops-demo-004");
    expect(opsEvents[opsEvents.length - 1]?.id).toBe("ops-demo-001");
  });

  it("normalizes labels and tones consistently", () => {
    expect(formatStatusLabel("assist_requested")).toBe("assist requested");
    expect(getExportTone("approved")).toBe("attention");
    expect(getOpsTone("assist_completed")).toBe("active");
  });
});
