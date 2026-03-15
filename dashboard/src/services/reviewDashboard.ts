import type { ApprovedExport, Finding, ReviewSession } from "./api";

export type StatusTone = "attention" | "active" | "success" | "neutral";

export type WeeklyActivityPoint = {
  period: string;
  sessions: number;
  findings: number;
  exports: number;
};

export type QueueLane = {
  title: string;
  count: number;
  detail: string;
  tone: "attention" | "active" | "success";
};

export type FocusItem = {
  title: string;
  count: number;
  detail: string;
  owner: string;
  tone: "alert" | "watch" | "stable";
};

export type ReviewSnapshot = {
  sessions: ReviewSession[];
  findings: Finding[];
  approvedExports: ApprovedExport[];
};

export type OverviewModel = {
  sessionsInScope: number;
  openFindings: number;
  reviewedFindings: number;
  approvedExportCount: number;
  agingItems: number;
  queueLanes: QueueLane[];
  focusItems: FocusItem[];
  weeklyActivity: WeeklyActivityPoint[];
  exportRows: ApprovedExport[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const OPEN_STATUSES = new Set<Finding["status"]>([
  "draft",
  "pending_review",
  "uncertain",
  "revised",
]);
const REVIEWED_STATUSES = new Set<Finding["status"]>([
  "accepted",
  "rejected",
  "revised",
]);

export const previewSessions: ReviewSession[] = [
  {
    id: "session-preview-001",
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
    id: "session-preview-002",
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
    id: "session-preview-003",
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
    id: "session-preview-004",
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
];

export const previewFindings: Finding[] = [
  {
    id: "finding-preview-001",
    sessionId: "session-preview-001",
    code: "follow-up-plan",
    title: "Follow-up plan still needs reviewer confirmation",
    summary:
      "The patient left with a follow-up mention, but the timing language is still ambiguous in the export packet.",
    status: "pending_review",
    confidence: 0.82,
    evidenceSpans: [
      {
        id: "evidence-preview-001",
        transcriptSegmentId: "segment-preview-001",
        excerpt: "I'd like to see you again next week if the refill comes through.",
        startOffsetMs: 18000,
        endOffsetMs: 23100,
      },
    ],
    detectedBy: "rules",
    createdAt: "2026-03-10T15:40:00Z",
    updatedAt: "2026-03-12T09:15:00Z",
  },
  {
    id: "finding-preview-002",
    sessionId: "session-preview-001",
    code: "medication-risk",
    title: "Medication side-effect counseling needs evidence trim",
    summary:
      "Evidence spans overlap two adjacent segments and need reviewer cleanup before approval.",
    status: "uncertain",
    confidence: 0.71,
    evidenceSpans: [
      {
        id: "evidence-preview-002",
        transcriptSegmentId: "segment-preview-002",
        excerpt: "It may make you dizzy for the first few days.",
        startOffsetMs: 9200,
        endOffsetMs: 12600,
      },
    ],
    detectedBy: "local_llm",
    createdAt: "2026-03-10T15:42:00Z",
    updatedAt: "2026-03-12T09:20:00Z",
  },
  {
    id: "finding-preview-003",
    sessionId: "session-preview-002",
    code: "empathy-gap",
    title: "Patient concern was acknowledged and approved",
    summary:
      "Reviewer accepted this finding for the final export after confirming the evidence clip.",
    status: "accepted",
    confidence: 0.65,
    evidenceSpans: [
      {
        id: "evidence-preview-003",
        transcriptSegmentId: "segment-preview-003",
        excerpt: "I hear that this has been exhausting for you.",
        startOffsetMs: 6000,
        endOffsetMs: 9100,
      },
    ],
    detectedBy: "human",
    createdAt: "2026-03-08T17:35:00Z",
    updatedAt: "2026-03-09T11:00:00Z",
    reviewDecisionId: "decision-preview-001",
  },
  {
    id: "finding-preview-004",
    sessionId: "session-preview-003",
    code: "direct-question",
    title: "Direct patient question has not been answered yet",
    summary:
      "The patient asked when swelling should trigger a callback, but the answer is missing from the current evidence set.",
    status: "draft",
    confidence: 0.8,
    evidenceSpans: [
      {
        id: "evidence-preview-004",
        transcriptSegmentId: "segment-preview-004",
        excerpt: "When should I call back if the swelling keeps going?",
        startOffsetMs: 14100,
        endOffsetMs: 17600,
      },
    ],
    detectedBy: "rules",
    createdAt: "2026-03-13T19:48:00Z",
    updatedAt: "2026-03-14T07:40:00Z",
  },
  {
    id: "finding-preview-005",
    sessionId: "session-preview-004",
    code: "handoff-clarity",
    title: "Handoff summary was edited during review",
    summary:
      "Reviewer tightened the summary language before export approval.",
    status: "revised",
    confidence: 0.77,
    evidenceSpans: [
      {
        id: "evidence-preview-005",
        transcriptSegmentId: "segment-preview-005",
        excerpt:
          "We'll transfer this plan to your primary team this afternoon.",
        startOffsetMs: 8800,
        endOffsetMs: 11900,
      },
    ],
    detectedBy: "local_llm",
    createdAt: "2026-03-14T13:29:00Z",
    updatedAt: "2026-03-15T08:35:00Z",
    reviewDecisionId: "decision-preview-002",
  },
];

export const previewApprovedExports: ApprovedExport[] = [
  {
    id: "export-preview-001",
    sessionId: "session-preview-002",
    status: "sent",
    summary:
      "Final export covering the reviewed empathy acknowledgement and callback instructions.",
    findings: [],
    approvedBy: "quality-lead-1",
    approvedAt: "2026-03-09T11:20:00Z",
    destination: "compliance-archive",
    sentAt: "2026-03-09T11:55:00Z",
  },
  {
    id: "export-preview-002",
    sessionId: "session-preview-004",
    status: "approved",
    summary:
      "Approved export packet for the updated handoff summary and discharge instructions.",
    findings: [],
    approvedBy: "quality-lead-2",
    approvedAt: "2026-03-15T08:40:00Z",
    destination: "claims-review-queue",
  },
  {
    id: "export-preview-003",
    sessionId: "session-preview-001",
    status: "draft",
    summary:
      "Draft export waiting for final confirmation on medication side-effect counseling.",
    findings: [],
    approvedBy: "quality-lead-3",
    approvedAt: "2026-03-12T09:30:00Z",
    destination: "internal-quality-review",
  },
];

export const previewReviewSnapshot: ReviewSnapshot = {
  sessions: previewSessions,
  findings: previewFindings,
  approvedExports: previewApprovedExports,
};

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatStatusLabel(value: string): string {
  return value.replace(/_/g, " ");
}

export function getSessionStatusTone(
  value:
    | ReviewSession["transcriptStatus"]
    | ReviewSession["reviewStatus"]
    | ReviewSession["exportStatus"]
): StatusTone {
  if (value === "ready") {
    return "attention";
  }

  if (value === "in_review" || value === "draft" || value === "in_progress") {
    return "active";
  }

  if (value === "completed" || value === "approved" || value === "sent") {
    return "success";
  }

  return "neutral";
}

export function getFindingTone(status: Finding["status"]): StatusTone {
  if (status === "accepted") {
    return "success";
  }

  if (status === "pending_review" || status === "uncertain") {
    return "attention";
  }

  if (status === "revised") {
    return "active";
  }

  return "neutral";
}

export function getExportTone(status: ApprovedExport["status"]): StatusTone {
  if (status === "draft") {
    return "active";
  }

  if (status === "approved") {
    return "attention";
  }

  return "success";
}

export function sortSessions(
  sessions: ReviewSession[],
  filter: "all" | ReviewSession["reviewStatus"] = "all"
): ReviewSession[] {
  return sessions
    .filter((session) =>
      filter === "all" ? true : session.reviewStatus === filter
    )
    .sort((left, right) =>
      right.encounterStartedAt.localeCompare(left.encounterStartedAt)
    );
}

export function sortFindings(
  findings: Finding[],
  filter: "all" | Finding["status"] = "all"
): Finding[] {
  const priority: Record<Finding["status"], number> = {
    pending_review: 0,
    draft: 1,
    uncertain: 2,
    revised: 3,
    accepted: 4,
    rejected: 5,
  };

  return findings
    .filter((finding) => (filter === "all" ? true : finding.status === filter))
    .sort((left, right) => {
      if (priority[left.status] !== priority[right.status]) {
        return priority[left.status] - priority[right.status];
      }

      return right.updatedAt.localeCompare(left.updatedAt);
    });
}

export function sortApprovedExports(
  approvedExports: ApprovedExport[],
  filter: "all" | ApprovedExport["status"] = "all"
): ApprovedExport[] {
  return approvedExports
    .filter((approvedExport) =>
      filter === "all" ? true : approvedExport.status === filter
    )
    .sort((left, right) => right.approvedAt.localeCompare(left.approvedAt));
}

function startOfUtcWeek(value: string | Date): Date {
  const date = typeof value === "string" ? new Date(value) : new Date(value);
  const copy = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  const day = copy.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setUTCDate(copy.getUTCDate() + diff);
  return copy;
}

function formatWeekLabel(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function buildWeeklyActivity(snapshot: ReviewSnapshot): WeeklyActivityPoint[] {
  const currentWeek = startOfUtcWeek(new Date());
  const weeks = Array.from({ length: 6 }, (_, index) => {
    const week = new Date(currentWeek);
    week.setUTCDate(currentWeek.getUTCDate() + (index - 5) * 7);
    return week;
  });

  const points = weeks.map((week) => ({
    period: week.toISOString(),
    sessions: 0,
    findings: 0,
    exports: 0,
  }));
  const pointByWeek = new Map(points.map((point) => [point.period, point]));

  snapshot.sessions.forEach((session) => {
    const point = pointByWeek.get(
      startOfUtcWeek(session.encounterStartedAt).toISOString()
    );
    if (point) {
      point.sessions += 1;
    }
  });

  snapshot.findings.forEach((finding) => {
    const point = pointByWeek.get(startOfUtcWeek(finding.updatedAt).toISOString());
    if (point) {
      point.findings += 1;
    }
  });

  snapshot.approvedExports.forEach((approvedExport) => {
    const point = pointByWeek.get(
      startOfUtcWeek(approvedExport.approvedAt).toISOString()
    );
    if (point) {
      point.exports += 1;
    }
  });

  return points.map((point) => ({
    ...point,
    period: formatWeekLabel(new Date(point.period)),
  }));
}

function buildFocusItems(findings: Finding[]): FocusItem[] {
  const grouped = new Map<
    string,
    {
      title: string;
      count: number;
      detail: string;
      owner: string;
      tone: FocusItem["tone"];
      updatedAt: string;
    }
  >();

  findings.forEach((finding) => {
    const key = finding.code || finding.title;
    const tone =
      finding.status === "draft" || finding.status === "pending_review"
        ? "alert"
        : finding.status === "uncertain" || finding.status === "revised"
          ? "watch"
          : "stable";
    const owner = `${formatStatusLabel(finding.detectedBy)} · ${formatStatusLabel(
      finding.status
    )}`;
    const existing = grouped.get(key);

    if (existing) {
      existing.count += 1;
      if (finding.updatedAt > existing.updatedAt) {
        existing.detail = finding.summary;
        existing.owner = owner;
        existing.tone = tone;
        existing.updatedAt = finding.updatedAt;
      }
      return;
    }

    grouped.set(key, {
      title: finding.title,
      count: 1,
      detail: finding.summary,
      owner,
      tone,
      updatedAt: finding.updatedAt,
    });
  });

  return Array.from(grouped.values())
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }

      return right.updatedAt.localeCompare(left.updatedAt);
    })
    .slice(0, 4)
    .map(({ updatedAt, ...item }) => item);
}

export function buildOverviewModel(
  snapshot: ReviewSnapshot,
  now = new Date()
): OverviewModel {
  const openFindings = snapshot.findings.filter((finding) =>
    OPEN_STATUSES.has(finding.status)
  );
  const reviewedFindings = snapshot.findings.filter((finding) =>
    REVIEWED_STATUSES.has(finding.status)
  );
  const approvedExportCount = snapshot.approvedExports.filter(
    (approvedExport) =>
      approvedExport.status === "approved" || approvedExport.status === "sent"
  ).length;
  const agingItems = snapshot.sessions.filter((session) => {
    if (
      session.reviewStatus !== "ready" &&
      session.reviewStatus !== "in_review"
    ) {
      return false;
    }

    return now.getTime() - new Date(session.updatedAt).getTime() > 2 * DAY_MS;
  }).length;

  const queueLanes: QueueLane[] = [
    {
      title: "Awaiting review decision",
      count: snapshot.findings.filter(
        (finding) =>
          finding.status === "draft" || finding.status === "pending_review"
      ).length,
      detail:
        "Findings that still need a human decision before they can move forward.",
      tone: "attention",
    },
    {
      title: "Needs evidence edits",
      count: snapshot.findings.filter(
        (finding) =>
          finding.status === "uncertain" || finding.status === "revised"
      ).length,
      detail:
        "Evidence spans or summaries changed during review and need another pass.",
      tone: "active",
    },
    {
      title: "Export packets in queue",
      count: snapshot.approvedExports.filter(
        (approvedExport) =>
          approvedExport.status === "draft" ||
          approvedExport.status === "approved"
      ).length,
      detail:
        "Export packets stay downstream of review until a lead sends them.",
      tone: "success",
    },
  ];

  return {
    sessionsInScope: snapshot.sessions.length,
    openFindings: openFindings.length,
    reviewedFindings: reviewedFindings.length,
    approvedExportCount,
    agingItems,
    queueLanes,
    focusItems: buildFocusItems(
      openFindings.length > 0 ? openFindings : snapshot.findings
    ),
    weeklyActivity: buildWeeklyActivity(snapshot),
    exportRows: sortApprovedExports(snapshot.approvedExports).slice(0, 4),
  };
}
