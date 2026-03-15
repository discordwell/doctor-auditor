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

export type OperationsSnapshot = {
  approvedExports: ApprovedExportEnvelope[];
  opsEvents: OpsEvent[];
};

export type OverviewModel = {
  totalExports: number;
  approvedExports: number;
  sentExports: number;
  assistUsageCount: number;
  assistOverrideCount: number;
  redactionBlockCount: number;
  averageSendLatencyMs: number | null;
  queueLanes: QueueLane[];
  focusItems: FocusItem[];
  weeklyActivity: WeeklyActivityPoint[];
  exportRows: ApprovedExportEnvelope[];
  recentOpsEvents: OpsEvent[];
};

export const EMPTY_OPERATIONS_SNAPSHOT: OperationsSnapshot = {
  approvedExports: [],
  opsEvents: [],
};

const DAY_MS = 24 * 60 * 60 * 1000;

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

function buildWeeklyActivity(snapshot: OperationsSnapshot): WeeklyActivityPoint[] {
  const currentWeek = startOfUtcWeek(new Date());
  const weeks = Array.from({ length: 6 }, (_, index) => {
    const week = new Date(currentWeek);
    week.setUTCDate(currentWeek.getUTCDate() + (index - 5) * 7);
    return week;
  });

  const points = weeks.map((week) => ({
    period: week.toISOString(),
    exports: 0,
    assists: 0,
    blocks: 0,
  }));
  const pointByWeek = new Map(points.map((point) => [point.period, point]));

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
      (item) => item.export.status === "sent" && typeof item.export.sentAt === "string"
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

  return {
    totalExports: snapshot.approvedExports.length,
    approvedExports: approvedExports.length,
    sentExports: sentExports.length,
    assistUsageCount: assistUsageEvents.length,
    assistOverrideCount: assistOverrides.length,
    redactionBlockCount: redactionBlocks.length,
    averageSendLatencyMs: averageSendLatencyMs(snapshot.approvedExports),
    queueLanes: [
      {
        title: "Draft exports",
        count: draftExports.length,
        detail: "Desktop-reviewed packets that have not been approved for downstream delivery yet.",
        tone: "active",
      },
      {
        title: "Approved not sent",
        count: approvedExports.length,
        detail: "Approved envelopes waiting on manual downstream delivery or compliance release.",
        tone: "attention",
      },
      {
        title: "Privacy blocks",
        count: redactionBlocks.length,
        detail: "Redaction or minimization issues blocked export or assist work and require local review.",
        tone: "attention",
      },
    ],
    focusItems: [
      {
        title: "Assist requests",
        count: assistUsageEvents.length,
        detail: "Reviewer-invoked second-opinion calls recorded without raw PHI.",
        owner: "Desktop reviewers",
        tone: assistUsageEvents.length > 0 ? "watch" : "stable",
      },
      {
        title: "Assist overrides",
        count: assistOverrides.length,
        detail: "Human reviewers overruled an assist recommendation and preserved the local decision.",
        owner: "Quality leads",
        tone: assistOverrides.length > 0 ? "watch" : "stable",
      },
      {
        title: "Assist or delivery failures",
        count: assistFailures.length + stuckApprovedExports.length,
        detail: "Failures and aging approved exports are the main centralized follow-up queue.",
        owner: "Ops and compliance",
        tone:
          assistFailures.length + stuckApprovedExports.length > 0 ? "alert" : "stable",
      },
    ],
    weeklyActivity: buildWeeklyActivity(snapshot),
    exportRows: sortApprovedExports(snapshot.approvedExports).slice(0, 5),
    recentOpsEvents: sortOpsEvents(snapshot.opsEvents).slice(0, 6),
  };
}
