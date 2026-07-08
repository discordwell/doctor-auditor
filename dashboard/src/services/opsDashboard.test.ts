import { describe, expect, it } from "vitest";

import type { ApprovedExportEnvelope, OpsEvent } from "./api";
import type { OperationsSnapshot } from "./opsDashboard";
import {
  buildAssistAssessmentCards,
  buildOverviewModel,
  buildSessionActivityGroups,
  formatAssistDisposition,
  formatDuration,
  formatLatency,
  formatRelativeAge,
  formatStatusLabel,
  getExportTone,
  getExportUpdatedAt,
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

const NOW = new Date("2026-03-16T12:00:00Z");

describe("opsDashboard helpers", () => {
  it("builds stable overview metrics from export and ops data", () => {
    const model = buildOverviewModel(sampleSnapshot, NOW);

    expect(model.totalExports).toBe(3);
    expect(model.approvedExports).toBe(1);
    expect(model.sentExports).toBe(1);
    expect(model.assistUsageCount).toBe(1);
    expect(model.assistOverrideCount).toBe(1);
    expect(model.redactionBlockCount).toBe(1);
    expect(model.queueLanes.map((lane) => lane.count)).toEqual([1, 1, 1]);
    expect(model.weeklyActivity).toHaveLength(6);
    expect(model.weeklyActivity.map((point) => point.period)).toEqual([
      "Feb 9",
      "Feb 16",
      "Feb 23",
      "Mar 2",
      "Mar 9",
      "Mar 16",
    ]);
    expect(model.weeklyActivity[4]).toEqual({
      period: "Mar 9",
      exports: 3,
      assists: 4,
      blocks: 1,
    });
    expect(model.weeklyActivity[5]).toEqual({
      period: "Mar 16",
      exports: 0,
      assists: 0,
      blocks: 0,
    });
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

  it("buckets weekly activity relative to the provided clock, not the wall clock", () => {
    const futureModel = buildOverviewModel(
      sampleSnapshot,
      new Date("2027-01-04T12:00:00Z")
    );

    expect(
      futureModel.weeklyActivity.every(
        (point) =>
          point.exports === 0 && point.assists === 0 && point.blocks === 0
      )
    ).toBe(true);
  });
});

function makeExportEnvelope(overrides: {
  id: string;
  status: ApprovedExportEnvelope["export"]["status"];
  approvedAt: string;
  clinicianId?: string;
  sessionId?: string;
  sentAt?: string;
  reviewCompletedAt?: string;
  destination?: string;
}): ApprovedExportEnvelope {
  const sessionId = overrides.sessionId ?? `session-${overrides.id}`;

  return {
    id: overrides.id,
    organizationId: "demo-health",
    session: {
      localSessionId: sessionId,
      clinicianId: overrides.clinicianId ?? "clinician-default",
      encounterStartedAt: "2026-03-01T10:00:00Z",
      encounterEndedAt: "2026-03-01T10:30:00Z",
      captureMode: "audio_import",
    },
    consent: {
      recordedWithConsent: true,
      exportAllowed: true,
      remoteAssistAllowed: false,
      policyVersion: "policy-v1",
    },
    export: {
      id: overrides.id,
      sessionId,
      status: overrides.status,
      summary: `Export ${overrides.id}`,
      findings: [],
      approvedBy: "quality-lead-1",
      approvedAt: overrides.approvedAt,
      destination: overrides.destination,
      sentAt: overrides.sentAt,
    },
    attestation: {
      reviewedBy: "reviewer-1",
      reviewCompletedAt: overrides.reviewCompletedAt ?? overrides.approvedAt,
      clientVersion: "desktop-demo-1.0.0",
      localBundleHash: `hash-${overrides.id}`,
      assistReceiptIds: [],
    },
  };
}

function makeOpsEvent(
  overrides: Partial<OpsEvent> & {
    id: string;
    type: OpsEvent["type"];
    recordedAt: string;
  }
): OpsEvent {
  return {
    localSessionId: `session-${overrides.id}`,
    ...overrides,
  };
}

describe("formatDuration", () => {
  it("reports missing data for null and NaN", () => {
    expect(formatDuration(null)).toBe("No data");
    expect(formatDuration(Number.NaN)).toBe("No data");
  });

  it("clamps negative durations to zero minutes", () => {
    expect(formatDuration(-5_000)).toBe("0m");
  });

  it("formats minutes, hours, and days", () => {
    expect(formatDuration(45 * 60_000)).toBe("45m");
    expect(formatDuration(90 * 60_000)).toBe("1h 30m");
    expect(formatDuration(2 * 60 * 60_000)).toBe("2h");
    expect(formatDuration(26 * 60 * 60_000)).toBe("1d 2h");
    expect(formatDuration(48 * 60 * 60_000)).toBe("2d");
  });
});

describe("formatRelativeAge", () => {
  const now = new Date("2026-03-16T12:00:00Z");

  it("reports minute, hour, and day ages", () => {
    expect(formatRelativeAge("2026-03-16T11:30:00Z", now)).toBe("30m old");
    expect(formatRelativeAge("2026-03-16T07:00:00Z", now)).toBe("5h old");
    expect(formatRelativeAge("2026-03-13T12:00:00Z", now)).toBe("3d old");
  });

  it("never reports less than one minute", () => {
    expect(formatRelativeAge("2026-03-16T11:59:50Z", now)).toBe("1m old");
  });

  it("clamps future timestamps to one minute", () => {
    expect(formatRelativeAge("2026-03-17T12:00:00Z", now)).toBe("1m old");
  });

  it("reports unknown for unparseable timestamps", () => {
    expect(formatRelativeAge("not-a-date", now)).toBe("Unknown age");
  });
});

describe("getExportUpdatedAt", () => {
  it("uses sentAt for sent exports", () => {
    const item = makeExportEnvelope({
      id: "export-sent",
      status: "sent",
      approvedAt: "2026-03-09T11:20:00Z",
      sentAt: "2026-03-09T11:55:00Z",
    });

    expect(getExportUpdatedAt(item)).toBe("2026-03-09T11:55:00Z");
  });

  it("falls back to approvedAt for sent exports missing sentAt", () => {
    const item = makeExportEnvelope({
      id: "export-sent-partial",
      status: "sent",
      approvedAt: "2026-03-09T11:20:00Z",
    });

    expect(getExportUpdatedAt(item)).toBe("2026-03-09T11:20:00Z");
  });

  it("uses reviewCompletedAt for drafts", () => {
    const item = makeExportEnvelope({
      id: "export-draft",
      status: "draft",
      approvedAt: "2026-03-12T09:30:00Z",
      reviewCompletedAt: "2026-03-12T09:25:00Z",
    });

    expect(getExportUpdatedAt(item)).toBe("2026-03-12T09:25:00Z");
  });

  it("uses approvedAt for approved exports", () => {
    const item = makeExportEnvelope({
      id: "export-approved",
      status: "approved",
      approvedAt: "2026-03-15T08:40:00Z",
      reviewCompletedAt: "2026-03-15T08:35:00Z",
    });

    expect(getExportUpdatedAt(item)).toBe("2026-03-15T08:40:00Z");
  });
});

describe("release queue", () => {
  const now = new Date("2026-03-16T12:00:00Z");

  it("excludes sent exports and orders approved before drafts, oldest update first", () => {
    const model = buildOverviewModel(
      {
        approvedExports: [
          makeExportEnvelope({
            id: "export-draft",
            status: "draft",
            approvedAt: "2026-03-16T09:00:00Z",
            reviewCompletedAt: "2026-03-16T09:00:00Z",
          }),
          makeExportEnvelope({
            id: "export-approved-new",
            status: "approved",
            approvedAt: "2026-03-15T06:00:00Z",
          }),
          makeExportEnvelope({
            id: "export-approved-old",
            status: "approved",
            approvedAt: "2026-03-13T12:00:00Z",
          }),
          makeExportEnvelope({
            id: "export-sent",
            status: "sent",
            approvedAt: "2026-03-09T11:20:00Z",
            sentAt: "2026-03-09T11:55:00Z",
          }),
        ],
        opsEvents: [],
      },
      now
    );

    expect(model.releaseQueue.map((row) => row.id)).toEqual([
      "export-approved-old",
      "export-approved-new",
      "export-draft",
    ]);
    expect(model.releaseQueue[0]).toMatchObject({
      status: "approved",
      tone: "attention",
      ageLabel: "3d old",
      destination: "Destination not set",
    });
    expect(model.releaseQueue[2]).toMatchObject({
      status: "draft",
      tone: "active",
      updatedAt: "2026-03-16T09:00:00Z",
    });
  });

  it("caps the queue at six rows", () => {
    const model = buildOverviewModel(
      {
        approvedExports: Array.from({ length: 8 }, (_, index) =>
          makeExportEnvelope({
            id: `export-${index}`,
            status: "draft",
            approvedAt: `2026-03-1${index % 6}T09:00:00Z`,
          })
        ),
        opsEvents: [],
      },
      now
    );

    expect(model.releaseQueue).toHaveLength(6);
  });
});

describe("clinician workload", () => {
  const now = new Date("2026-03-16T12:00:00Z");

  it("aggregates per-clinician counts and keeps the latest touch time", () => {
    const model = buildOverviewModel(
      {
        approvedExports: [
          makeExportEnvelope({
            id: "ada-draft",
            status: "draft",
            clinicianId: "clinician-ada",
            approvedAt: "2026-03-10T09:00:00Z",
          }),
          makeExportEnvelope({
            id: "ada-approved",
            status: "approved",
            clinicianId: "clinician-ada",
            approvedAt: "2026-03-14T09:00:00Z",
          }),
          makeExportEnvelope({
            id: "noor-sent",
            status: "sent",
            clinicianId: "clinician-noor",
            approvedAt: "2026-03-09T11:20:00Z",
            sentAt: "2026-03-09T11:55:00Z",
          }),
        ],
        opsEvents: [],
      },
      now
    );

    expect(model.clinicianWorkload).toHaveLength(2);
    expect(model.clinicianWorkload[0]).toMatchObject({
      clinicianId: "clinician-ada",
      pendingCount: 2,
      draftCount: 1,
      approvedCount: 1,
      sentCount: 0,
      lastTouchedAt: "2026-03-14T09:00:00Z",
    });
    expect(model.clinicianWorkload[1]).toMatchObject({
      clinicianId: "clinician-noor",
      pendingCount: 0,
      sentCount: 1,
    });
  });

  it("breaks pending-count ties by most recent touch", () => {
    const model = buildOverviewModel(
      {
        approvedExports: [
          makeExportEnvelope({
            id: "ada-approved",
            status: "approved",
            clinicianId: "clinician-ada",
            approvedAt: "2026-03-10T09:00:00Z",
          }),
          makeExportEnvelope({
            id: "lin-approved",
            status: "approved",
            clinicianId: "clinician-lin",
            approvedAt: "2026-03-12T09:00:00Z",
          }),
        ],
        opsEvents: [],
      },
      now
    );

    expect(model.clinicianWorkload.map((row) => row.clinicianId)).toEqual([
      "clinician-lin",
      "clinician-ada",
    ]);
  });
});

describe("ops issues", () => {
  const now = new Date("2026-03-16T12:00:00Z");

  it("collects failures and blocks with actionable detail", () => {
    const model = buildOverviewModel(
      {
        approvedExports: [],
        opsEvents: [
          makeOpsEvent({
            id: "ops-failed",
            type: "assist_failed",
            recordedAt: "2026-03-15T08:12:00Z",
            errorCode: "gateway-timeout",
            actorId: "quality-lead-2",
          }),
          makeOpsEvent({
            id: "ops-blocked",
            type: "redaction_blocked",
            recordedAt: "2026-03-15T09:00:00Z",
          }),
          makeOpsEvent({
            id: "ops-ok",
            type: "assist_completed",
            recordedAt: "2026-03-15T10:00:00Z",
          }),
        ],
      },
      now
    );

    expect(model.opsIssues.map((issue) => issue.id)).toEqual([
      "ops-blocked",
      "ops-failed",
    ]);
    expect(model.opsIssues[0]).toMatchObject({
      title: "Redaction blocked",
      detail: "Needs follow-up",
      tone: "attention",
    });
    expect(model.opsIssues[1]).toMatchObject({
      title: "Remote assist failed",
      detail: "Reason: gateway-timeout · Owner: quality-lead-2",
    });
  });

  it("flags approved exports older than two days as overdue releases", () => {
    const model = buildOverviewModel(
      {
        approvedExports: [
          makeExportEnvelope({
            id: "export-overdue",
            status: "approved",
            approvedAt: "2026-03-12T12:00:00Z",
            destination: "claims-review-queue",
          }),
          makeExportEnvelope({
            id: "export-fresh",
            status: "approved",
            approvedAt: "2026-03-15T00:00:00Z",
          }),
          makeExportEnvelope({
            id: "export-draft",
            status: "draft",
            approvedAt: "2026-03-10T00:00:00Z",
          }),
        ],
        opsEvents: [],
      },
      now
    );

    expect(model.opsIssues).toHaveLength(1);
    expect(model.opsIssues[0]).toMatchObject({
      id: "export-overdue-release-overdue",
      title: "Release overdue",
      detail: "claims-review-queue · 4d old",
      sessionId: "session-export-overdue",
      timestamp: "2026-03-12T12:00:00Z",
      tone: "attention",
    });
    expect(model.activeIssuesCount).toBe(1);
  });
});
