import {
  api,
  type ApprovedExportEnvelope,
  type OpsEvent,
} from "./api";

export type StatusTone = "attention" | "active" | "success" | "neutral";

export type WeeklyActivityPoint = {
  period: string;
  exports: number;
  assists: number;
  blocks: number;
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

export type ReleaseQueueRow = {
  id: string;
  clinicianId: string;
  sessionId: string;
  status: ApprovedExportEnvelope["export"]["status"];
  destination: string;
  summary: string;
  findingsCount: number;
  owner: string;
  updatedAt: string;
  ageLabel: string;
  tone: StatusTone;
};

export type ClinicianWorkload = {
  clinicianId: string;
  pendingCount: number;
  draftCount: number;
  approvedCount: number;
  sentCount: number;
  lastTouchedAt: string;
};

export type OpsIssueRow = {
  id: string;
  title: string;
  detail: string;
  sessionId: string;
  timestamp: string;
  tone: StatusTone;
};

export type ActivityFeedItem = {
  id: string;
  label: string;
  title: string;
  detail: string;
  timestamp: string;
  tone: StatusTone;
};

export type OperationsSnapshot = {
  approvedExports: ApprovedExportEnvelope[];
  opsEvents: OpsEvent[];
};

export type OverviewModel = {
  totalExports: number;
  approvedExports: number;
  sentExports: number;
  draftExports: number;
  assistUsageCount: number;
  assistOverrideCount: number;
  redactionBlockCount: number;
  averageSendLatencyMs: number | null;
  activeIssuesCount: number;
  sentLast7Days: number;
  queueLanes: QueueLane[];
  focusItems: FocusItem[];
  weeklyActivity: WeeklyActivityPoint[];
  exportRows: ApprovedExportEnvelope[];
  recentOpsEvents: OpsEvent[];
  releaseQueue: ReleaseQueueRow[];
  clinicianWorkload: ClinicianWorkload[];
  opsIssues: OpsIssueRow[];
  activityFeed: ActivityFeedItem[];
};

export const EMPTY_OPERATIONS_SNAPSHOT: OperationsSnapshot = {
  approvedExports: [],
  opsEvents: [],
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

const STATUS_LABELS: Record<string, string> = {
  assist_requested: "Remote assist requested",
  assist_completed: "Remote assist completed",
  assist_failed: "Remote assist failed",
  assist_overridden: "Remote assist overridden",
  redaction_blocked: "Redaction blocked",
  export_approved: "Export approved",
  export_sent: "Export sent",
};

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDuration(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "No data";
  }

  const totalMinutes = Math.max(Math.round(value / 60_000), 0);

  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours < 24) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;

  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

export function formatRelativeAge(
  value: string,
  now: Date = new Date()
): string {
  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    return "Unknown age";
  }

  const elapsedMs = Math.max(now.getTime() - timestamp, 0);

  if (elapsedMs < 60 * 60 * 1000) {
    return `${Math.max(Math.round(elapsedMs / 60_000), 1)}m old`;
  }

  if (elapsedMs < DAY_MS) {
    return `${Math.max(Math.round(elapsedMs / (60 * 60 * 1000)), 1)}h old`;
  }

  return `${Math.max(Math.round(elapsedMs / DAY_MS), 1)}d old`;
}

export function formatStatusLabel(value: string): string {
  if (value in STATUS_LABELS) {
    return STATUS_LABELS[value];
  }

  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function getExportTone(
  status: ApprovedExportEnvelope["export"]["status"]
): StatusTone {
  if (status === "draft") {
    return "active";
  }

  if (status === "approved") {
    return "attention";
  }

  return "success";
}

export function getOpsTone(eventType: OpsEvent["type"]): StatusTone {
  if (eventType === "redaction_blocked" || eventType === "assist_failed") {
    return "attention";
  }

  if (
    eventType === "assist_requested" ||
    eventType === "assist_completed" ||
    eventType === "assist_overridden"
  ) {
    return "active";
  }

  return "success";
}

export function sortApprovedExports(
  approvedExports: ApprovedExportEnvelope[],
  filter: "all" | ApprovedExportEnvelope["export"]["status"] = "all"
): ApprovedExportEnvelope[] {
  return approvedExports
    .filter((item) => (filter === "all" ? true : item.export.status === filter))
    .sort((left, right) =>
      right.export.approvedAt.localeCompare(left.export.approvedAt)
    );
}

export function sortOpsEvents(
  opsEvents: OpsEvent[],
  filter: "all" | OpsEvent["type"] = "all"
): OpsEvent[] {
  return opsEvents
    .filter((item) => (filter === "all" ? true : item.type === filter))
    .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt));
}

export async function loadApprovedExports(
  filter: "all" | ApprovedExportEnvelope["export"]["status"] = "all"
): Promise<ApprovedExportEnvelope[]> {
  return sortApprovedExports(
    await api.getApprovedExports(
      filter === "all" ? undefined : { exportStatus: filter }
    ),
    filter
  );
}

export async function loadOperationsSnapshot(): Promise<OperationsSnapshot> {
  const [approvedExports, opsEvents] = await Promise.all([
    api.getApprovedExports(),
    api.getOpsEvents(),
  ]);

  return {
    approvedExports: sortApprovedExports(approvedExports),
    opsEvents: sortOpsEvents(opsEvents),
  };
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

function formatWeekLabel(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(value);
}

function buildWeeklyActivity(snapshot: OperationsSnapshot): WeeklyActivityPoint[] {
  const currentWeek = startOfUtcWeek(new Date());
  const weeks = Array.from({ length: 6 }, (_, index) => {
    const week = new Date(currentWeek);
    week.setUTCDate(currentWeek.getUTCDate() + (index - 5) * 7);
    return week;
  });

  const points = weeks.map((week) => ({
    period: formatWeekLabel(week),
    exports: 0,
    assists: 0,
    blocks: 0,
  }));
  const pointByWeek = new Map(
    weeks.map((week, index) => [week.toISOString(), points[index]])
  );

  snapshot.approvedExports.forEach((item) => {
    const point = pointByWeek.get(
      startOfUtcWeek(item.export.approvedAt).toISOString()
    );

    if (point) {
      point.exports += 1;
    }
  });

  snapshot.opsEvents.forEach((item) => {
    const point = pointByWeek.get(startOfUtcWeek(item.recordedAt).toISOString());

    if (!point) {
      return;
    }

    if (item.type.startsWith("assist_")) {
      point.assists += 1;
    }

    if (item.type === "redaction_blocked") {
      point.blocks += 1;
    }
  });

  return points;
}

function averageSendLatencyMs(
  approvedExports: ApprovedExportEnvelope[]
): number | null {
  const latencies = approvedExports
    .filter(
      (item) =>
        item.export.status === "sent" && typeof item.export.sentAt === "string"
    )
    .map((item) => {
      const sentAt = Date.parse(item.export.sentAt ?? "");
      const approvedAt = Date.parse(item.export.approvedAt);

      if (Number.isNaN(sentAt) || Number.isNaN(approvedAt)) {
        return null;
      }

      return Math.max(sentAt - approvedAt, 0);
    })
    .filter((item): item is number => item !== null);

  if (latencies.length === 0) {
    return null;
  }

  return latencies.reduce((sum, value) => sum + value, 0) / latencies.length;
}

function getExportUpdatedAt(item: ApprovedExportEnvelope): string {
  if (item.export.status === "sent" && item.export.sentAt) {
    return item.export.sentAt;
  }

  if (item.export.status === "draft") {
    return item.attestation.reviewCompletedAt;
  }

  return item.export.approvedAt;
}

function getReleaseQueuePriority(
  status: ApprovedExportEnvelope["export"]["status"]
): number {
  if (status === "approved") {
    return 0;
  }

  if (status === "draft") {
    return 1;
  }

  return 2;
}

function buildReleaseQueue(
  snapshot: OperationsSnapshot,
  now: Date
): ReleaseQueueRow[] {
  return snapshot.approvedExports
    .filter((item) => item.export.status !== "sent")
    .map((item) => {
      const updatedAt = getExportUpdatedAt(item);
      const approvedTimestamp = Date.parse(item.export.approvedAt);
      const isAgingApproved =
        item.export.status === "approved" &&
        !Number.isNaN(approvedTimestamp) &&
        now.getTime() - approvedTimestamp > DAY_MS;

      return {
        id: item.id,
        clinicianId: item.session.clinicianId,
        sessionId: item.session.localSessionId,
        status: item.export.status,
        destination: item.export.destination ?? "Destination not set",
        summary: item.export.summary,
        findingsCount: item.export.findings.length,
        owner: item.attestation.reviewedBy,
        updatedAt,
        ageLabel: formatRelativeAge(updatedAt, now),
        tone: isAgingApproved ? "attention" : getExportTone(item.export.status),
      };
    })
    .sort((left, right) => {
      const priorityDelta =
        getReleaseQueuePriority(left.status) - getReleaseQueuePriority(right.status);

      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      return Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
    })
    .slice(0, 6);
}

function buildClinicianWorkload(
  snapshot: OperationsSnapshot
): ClinicianWorkload[] {
  const byClinician = new Map<string, ClinicianWorkload>();

  snapshot.approvedExports.forEach((item) => {
    const clinicianId = item.session.clinicianId;
    const existing = byClinician.get(clinicianId) ?? {
      clinicianId,
      pendingCount: 0,
      draftCount: 0,
      approvedCount: 0,
      sentCount: 0,
      lastTouchedAt: getExportUpdatedAt(item),
    };

    if (item.export.status === "draft") {
      existing.pendingCount += 1;
      existing.draftCount += 1;
    }

    if (item.export.status === "approved") {
      existing.pendingCount += 1;
      existing.approvedCount += 1;
    }

    if (item.export.status === "sent") {
      existing.sentCount += 1;
    }

    if (
      Date.parse(getExportUpdatedAt(item)) > Date.parse(existing.lastTouchedAt)
    ) {
      existing.lastTouchedAt = getExportUpdatedAt(item);
    }

    byClinician.set(clinicianId, existing);
  });

  return Array.from(byClinician.values())
    .sort((left, right) => {
      if (right.pendingCount !== left.pendingCount) {
        return right.pendingCount - left.pendingCount;
      }

      return Date.parse(right.lastTouchedAt) - Date.parse(left.lastTouchedAt);
    })
    .slice(0, 5);
}

function buildOpsIssues(
  snapshot: OperationsSnapshot,
  now: Date
): OpsIssueRow[] {
  const issues: OpsIssueRow[] = snapshot.opsEvents
    .filter(
      (item) => item.type === "assist_failed" || item.type === "redaction_blocked"
    )
    .map((item) => ({
      id: item.id,
      title: formatStatusLabel(item.type),
      detail:
        [
          item.errorCode ? `Reason: ${item.errorCode}` : null,
          item.actorId ? `Owner: ${item.actorId}` : null,
        ]
          .filter(Boolean)
          .join(" · ") || "Needs follow-up",
      sessionId: item.localSessionId,
      timestamp: item.recordedAt,
      tone: "attention",
    }));

  snapshot.approvedExports.forEach((item) => {
    if (item.export.status !== "approved") {
      return;
    }

    const approvedTimestamp = Date.parse(item.export.approvedAt);

    if (Number.isNaN(approvedTimestamp)) {
      return;
    }

    if (now.getTime() - approvedTimestamp <= 2 * DAY_MS) {
      return;
    }

    issues.push({
      id: `${item.id}-release-overdue`,
      title: "Release overdue",
      detail: `${item.export.destination ?? "Destination not set"} · ${formatRelativeAge(
        item.export.approvedAt,
        now
      )}`,
      sessionId: item.session.localSessionId,
      timestamp: item.export.approvedAt,
      tone: "attention",
    });
  });

  return issues
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
    .slice(0, 5);
}

function buildActivityFeed(snapshot: OperationsSnapshot): ActivityFeedItem[] {
  const exportItems = snapshot.approvedExports.map((item) => {
    const updatedAt = getExportUpdatedAt(item);

    return {
      id: `export-${item.id}`,
      label:
        item.export.status === "sent"
          ? "Export sent"
          : item.export.status === "approved"
            ? "Ready to send"
            : "In review",
      title: item.export.summary,
      detail: [
        item.session.clinicianId,
        item.session.localSessionId,
        item.export.destination,
      ]
        .filter(Boolean)
        .join(" · "),
      timestamp: updatedAt,
      tone: getExportTone(item.export.status),
    };
  });

  const opsItems = snapshot.opsEvents.map((item) => ({
    id: `ops-${item.id}`,
    label: formatStatusLabel(item.type),
    title: item.localSessionId,
    detail:
      [
        item.actorId,
        item.errorCode,
        item.provider,
        item.reviewerAction,
      ]
        .filter(Boolean)
        .join(" · ") || "System event",
    timestamp: item.recordedAt,
    tone: getOpsTone(item.type),
  }));

  return [...exportItems, ...opsItems]
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
    .slice(0, 8);
}

export function buildOverviewModel(
  snapshot: OperationsSnapshot,
  now: Date = new Date()
): OverviewModel {
  const approvedExports = snapshot.approvedExports.filter(
    (item) => item.export.status === "approved"
  );
  const sentExports = snapshot.approvedExports.filter(
    (item) => item.export.status === "sent"
  );
  const draftExports = snapshot.approvedExports.filter(
    (item) => item.export.status === "draft"
  );
  const assistUsageEvents = snapshot.opsEvents.filter(
    (item) => item.type === "assist_requested"
  );
  const assistOverrides = snapshot.opsEvents.filter(
    (item) => item.type === "assist_overridden"
  );
  const redactionBlocks = snapshot.opsEvents.filter(
    (item) => item.type === "redaction_blocked"
  );
  const assistFailures = snapshot.opsEvents.filter(
    (item) => item.type === "assist_failed"
  );
  const stuckApprovedExports = approvedExports.filter((item) => {
    const approvedAt = Date.parse(item.export.approvedAt);
    return !Number.isNaN(approvedAt) && now.getTime() - approvedAt > 2 * DAY_MS;
  });
  const sentLast7Days = sentExports.filter((item) => {
    const sentAt = Date.parse(item.export.sentAt ?? item.export.approvedAt);
    return !Number.isNaN(sentAt) && now.getTime() - sentAt <= WEEK_MS;
  });

  return {
    totalExports: snapshot.approvedExports.length,
    approvedExports: approvedExports.length,
    sentExports: sentExports.length,
    draftExports: draftExports.length,
    assistUsageCount: assistUsageEvents.length,
    assistOverrideCount: assistOverrides.length,
    redactionBlockCount: redactionBlocks.length,
    averageSendLatencyMs: averageSendLatencyMs(snapshot.approvedExports),
    activeIssuesCount:
      redactionBlocks.length + assistFailures.length + stuckApprovedExports.length,
    sentLast7Days: sentLast7Days.length,
    queueLanes: [
      {
        title: "In review",
        count: draftExports.length,
        detail: "Reviewed sessions that still need approval before release.",
        tone: "active",
      },
      {
        title: "Ready to send",
        count: approvedExports.length,
        detail: "Approved export packets waiting on downstream delivery.",
        tone: "attention",
      },
      {
        title: "Blocked",
        count: redactionBlocks.length,
        detail: "Sessions blocked by privacy or redaction issues.",
        tone: "attention",
      },
    ],
    focusItems: [
      {
        title: "Assist requests",
        count: assistUsageEvents.length,
        detail: "Sessions where reviewers explicitly asked for remote assist.",
        owner: "Review team",
        tone: assistUsageEvents.length > 0 ? "watch" : "stable",
      },
      {
        title: "Assist overrides",
        count: assistOverrides.length,
        detail: "Calls where a reviewer overrode the assist outcome.",
        owner: "Quality leads",
        tone: assistOverrides.length > 0 ? "watch" : "stable",
      },
      {
        title: "Ops follow-up",
        count: assistFailures.length + stuckApprovedExports.length,
        detail: "Failures and aging releases that still need operator attention.",
        owner: "Operations",
        tone:
          assistFailures.length + stuckApprovedExports.length > 0
            ? "alert"
            : "stable",
      },
    ],
    weeklyActivity: buildWeeklyActivity(snapshot),
    exportRows: sortApprovedExports(snapshot.approvedExports).slice(0, 5),
    recentOpsEvents: sortOpsEvents(snapshot.opsEvents).slice(0, 6),
    releaseQueue: buildReleaseQueue(snapshot, now),
    clinicianWorkload: buildClinicianWorkload(snapshot),
    opsIssues: buildOpsIssues(snapshot, now),
    activityFeed: buildActivityFeed(snapshot),
  };
}
