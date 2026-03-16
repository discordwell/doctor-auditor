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

export type SessionActivityEvent = {
  id: string;
  type: OpsEvent["type"];
  label: string;
  detail: string;
  timestamp: string;
  tone: StatusTone;
};

export type SessionActivityGroup = {
  id: string;
  localSessionId: string;
  clinicianId: string | null;
  captureMode: ApprovedExportEnvelope["session"]["captureMode"] | null;
  encounterStartedAt: string | null;
  encounterEndedAt: string | null;
  exportStatus: ApprovedExportEnvelope["export"]["status"] | null;
  exportSummary: string | null;
  destination: string | null;
  findings: ApprovedExportEnvelope["export"]["findings"];
  approvedBy: string | null;
  reviewedBy: string | null;
  latestTimestamp: string;
  tone: StatusTone;
  eventTypes: OpsEvent["type"][];
  eventCount: number;
  activity: SessionActivityEvent[];
  latestAssistStatus: "completed" | "failed" | null;
  latestAssistDisposition:
    | NonNullable<OpsEvent["assessment"]>["disposition"]
    | null;
  latestAssistConfidence: number | null;
  latestAssistRationale: string | null;
  latestAssistLimitations: string[];
  latestAssistProvider: string | null;
  latestAssistModel: string | null;
  latestAssistPolicyMode: string | null;
  latestAssistLatencyMs: number | null;
  latestAssistReviewerAction: string | null;
  latestAssistRecordedAt: string | null;
  latestAssistErrorCode: string | null;
};

export type AssistAssessmentCard = {
  id: string;
  assistReceiptId: string;
  localSessionId: string;
  actorId: string | null;
  recordedAt: string;
  status: "completed" | "failed";
  disposition: NonNullable<OpsEvent["assessment"]>["disposition"] | null;
  confidence: number | null;
  rationale: string;
  limitations: string[];
  provider: string | null;
  model: string | null;
  policyMode: string | null;
  latencyMs: number | null;
  reviewerAction: string | null;
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

export function formatAssistDisposition(
  value: NonNullable<OpsEvent["assessment"]>["disposition"]
): string {
  switch (value) {
    case "routine_review":
      return "Routine review";
    case "expedited_human_review":
      return "Expedited human review";
    case "insufficient_context":
      return "Insufficient context";
  }
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

export function formatLatency(latencyMs: number | null | undefined): string {
  if (latencyMs === null || latencyMs === undefined) {
    return "Latency unavailable";
  }

  if (latencyMs < 1000) {
    return `${latencyMs} ms`;
  }

  const seconds = latencyMs / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)} s` : `${Math.round(seconds)} s`;
}

function getAssistAssessmentTone(event: OpsEvent): StatusTone {
  if (event.type === "assist_failed") {
    return "attention";
  }

  if (event.assessment?.disposition === "expedited_human_review") {
    return "attention";
  }

  if (event.assessment?.disposition === "insufficient_context") {
    return "neutral";
  }

  return "active";
}

function formatReviewerActionLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function getTimestampValue(value: string | null | undefined): number {
  const timestamp = Date.parse(value ?? "");
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function getTonePriority(tone: StatusTone): number {
  switch (tone) {
    case "attention":
      return 3;
    case "active":
      return 2;
    case "success":
      return 1;
    case "neutral":
      return 0;
  }
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

export function buildAssistAssessmentCards(
  opsEvents: OpsEvent[]
): AssistAssessmentCard[] {
  const reviewerActionsByReceipt = new Map<string, string>();
  const cards: AssistAssessmentCard[] = [];

  sortOpsEvents(opsEvents)
    .filter((item) => item.type === "assist_overridden" && item.assistReceiptId)
    .forEach((item) => {
      if (!item.assistReceiptId || reviewerActionsByReceipt.has(item.assistReceiptId)) {
        return;
      }

      reviewerActionsByReceipt.set(
        item.assistReceiptId,
        item.reviewerAction ?? "overridden"
      );
    });

  sortOpsEvents(opsEvents).forEach((item) => {
    if (item.type === "assist_completed" && item.assessment && item.assistReceiptId) {
      cards.push({
        id: item.id,
        assistReceiptId: item.assistReceiptId,
        localSessionId: item.localSessionId,
        actorId: item.actorId ?? null,
        recordedAt: item.recordedAt,
        status: "completed",
        disposition: item.assessment.disposition,
        confidence: item.assessment.confidence,
        rationale: item.assessment.rationale,
        limitations: item.assessment.limitations,
        provider: item.provider ?? item.assessment.provider,
        model: item.model ?? item.assessment.model,
        policyMode: item.policyMode ?? null,
        latencyMs: item.latencyMs ?? null,
        reviewerAction:
          reviewerActionsByReceipt.get(item.assistReceiptId) ?? item.reviewerAction ?? null,
        tone: getAssistAssessmentTone(item),
      });
      return;
    }

    if (item.type === "assist_failed" && item.assistReceiptId) {
      cards.push({
        id: item.id,
        assistReceiptId: item.assistReceiptId,
        localSessionId: item.localSessionId,
        actorId: item.actorId ?? null,
        recordedAt: item.recordedAt,
        status: "failed",
        disposition: null,
        confidence: null,
        rationale: item.errorCode
          ? `The assist request failed before an assessment was returned: ${item.errorCode}.`
          : "The assist request failed before an assessment was returned.",
        limitations: [],
        provider: item.provider ?? null,
        model: item.model ?? null,
        policyMode: item.policyMode ?? null,
        latencyMs: item.latencyMs ?? null,
        reviewerAction:
          reviewerActionsByReceipt.get(item.assistReceiptId) ?? item.reviewerAction ?? null,
        tone: "attention",
      });
    }
  });

  return cards;
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

type SessionActivityGroupDraft = Omit<
  SessionActivityGroup,
  "eventTypes" | "eventCount" | "tone"
> & {
  eventTypes: Set<OpsEvent["type"]>;
};

function buildOpsActivityDetail(
  item: OpsEvent,
  reviewerActionsByReceipt: Map<string, string>
): string {
  if (item.type === "assist_completed" && item.assessment) {
    return [
      formatAssistDisposition(item.assessment.disposition),
      item.assessment.rationale,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  if (item.type === "assist_requested") {
    return [
      item.actorId ? `Requested by ${item.actorId}` : null,
      item.provider,
      item.model,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  if (item.type === "assist_overridden") {
    return [
      item.reviewerAction
        ? `Reviewer action: ${formatReviewerActionLabel(item.reviewerAction)}`
        : null,
      item.actorId,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  if (item.type === "assist_failed") {
    return [
      item.errorCode ? `Reason: ${item.errorCode}` : null,
      reviewerActionsByReceipt.get(item.assistReceiptId ?? "") ?? null,
      item.provider,
      item.model,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  if (item.type === "redaction_blocked") {
    return [
      item.errorCode ? `Reason: ${item.errorCode}` : null,
      item.actorId,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  if (item.type === "export_approved") {
    return [item.actorId, item.exportId].filter(Boolean).join(" · ");
  }

  if (item.type === "export_sent") {
    return [item.actorId, item.exportId].filter(Boolean).join(" · ");
  }

  return "System event";
}

function buildOpsActivityEvent(
  item: OpsEvent,
  reviewerActionsByReceipt: Map<string, string>
): SessionActivityEvent {
  return {
    id: `ops-${item.id}`,
    type: item.type,
    label: formatStatusLabel(item.type),
    detail: buildOpsActivityDetail(item, reviewerActionsByReceipt),
    timestamp: item.recordedAt,
    tone:
      item.type === "assist_completed"
        ? getAssistAssessmentTone(item)
        : getOpsTone(item.type),
  };
}

function addSessionActivity(
  group: SessionActivityGroupDraft,
  activity: SessionActivityEvent
) {
  group.activity.push(activity);
  group.eventTypes.add(activity.type);

  if (getTimestampValue(activity.timestamp) > getTimestampValue(group.latestTimestamp)) {
    group.latestTimestamp = activity.timestamp;
  }
}

function buildSyntheticExportEvents(
  item: ApprovedExportEnvelope
): SessionActivityEvent[] {
  const events: SessionActivityEvent[] = [];

  if (item.export.status === "approved" || item.export.status === "sent") {
    events.push({
      id: `export-approved-${item.id}`,
      type: "export_approved",
      label: formatStatusLabel("export_approved"),
      detail: [
        `Approved by ${item.export.approvedBy}`,
        item.export.destination,
      ]
        .filter(Boolean)
        .join(" · "),
      timestamp: item.export.approvedAt,
      tone: getExportTone("approved"),
    });
  }

  if (item.export.status === "sent" && item.export.sentAt) {
    events.push({
      id: `export-sent-${item.id}`,
      type: "export_sent",
      label: formatStatusLabel("export_sent"),
      detail: [item.export.destination, item.export.approvedBy]
        .filter(Boolean)
        .join(" · "),
      timestamp: item.export.sentAt,
      tone: getExportTone("sent"),
    });
  }

  return events;
}

export function buildSessionActivityGroups(
  snapshot: OperationsSnapshot
): SessionActivityGroup[] {
  const reviewerActionsByReceipt = new Map<string, string>();
  const latestExportBySession = new Map<string, ApprovedExportEnvelope>();
  const groups = new Map<string, SessionActivityGroupDraft>();

  sortOpsEvents(snapshot.opsEvents)
    .filter((item) => item.type === "assist_overridden" && item.assistReceiptId)
    .forEach((item) => {
      if (!item.assistReceiptId || reviewerActionsByReceipt.has(item.assistReceiptId)) {
        return;
      }

      reviewerActionsByReceipt.set(
        item.assistReceiptId,
        item.reviewerAction
          ? formatReviewerActionLabel(item.reviewerAction)
          : "Overridden"
      );
    });

  snapshot.approvedExports.forEach((item) => {
    const existing = latestExportBySession.get(item.session.localSessionId);

    if (
      !existing ||
      getTimestampValue(getExportUpdatedAt(item)) >
        getTimestampValue(getExportUpdatedAt(existing))
    ) {
      latestExportBySession.set(item.session.localSessionId, item);
    }
  });

  function ensureGroup(localSessionId: string): SessionActivityGroupDraft {
    const existing = groups.get(localSessionId);

    if (existing) {
      return existing;
    }

    const exportEnvelope = latestExportBySession.get(localSessionId);
    const nextGroup: SessionActivityGroupDraft = {
      id: localSessionId,
      localSessionId,
      clinicianId: exportEnvelope?.session.clinicianId ?? null,
      captureMode: exportEnvelope?.session.captureMode ?? null,
      encounterStartedAt: exportEnvelope?.session.encounterStartedAt ?? null,
      encounterEndedAt: exportEnvelope?.session.encounterEndedAt ?? null,
      exportStatus: exportEnvelope?.export.status ?? null,
      exportSummary: exportEnvelope?.export.summary ?? null,
      destination: exportEnvelope?.export.destination ?? null,
      findings: exportEnvelope?.export.findings ?? [],
      approvedBy: exportEnvelope?.export.approvedBy ?? null,
      reviewedBy: exportEnvelope?.attestation.reviewedBy ?? null,
      latestTimestamp: exportEnvelope ? getExportUpdatedAt(exportEnvelope) : "",
      eventTypes: new Set<OpsEvent["type"]>(),
      activity: [],
      latestAssistStatus: null,
      latestAssistDisposition: null,
      latestAssistConfidence: null,
      latestAssistRationale: null,
      latestAssistLimitations: [],
      latestAssistProvider: null,
      latestAssistModel: null,
      latestAssistPolicyMode: null,
      latestAssistLatencyMs: null,
      latestAssistReviewerAction: null,
      latestAssistRecordedAt: null,
      latestAssistErrorCode: null,
    };

    groups.set(localSessionId, nextGroup);
    return nextGroup;
  }

  latestExportBySession.forEach((_, localSessionId) => {
    ensureGroup(localSessionId);
  });

  sortOpsEvents(snapshot.opsEvents).forEach((item) => {
    const group = ensureGroup(item.localSessionId);
    addSessionActivity(group, buildOpsActivityEvent(item, reviewerActionsByReceipt));

    if (
      item.type !== "assist_completed" &&
      item.type !== "assist_failed"
    ) {
      return;
    }

    if (
      group.latestAssistRecordedAt &&
      getTimestampValue(item.recordedAt) <=
        getTimestampValue(group.latestAssistRecordedAt)
    ) {
      return;
    }

    if (item.type === "assist_completed" && item.assessment) {
      group.latestAssistStatus = "completed";
      group.latestAssistDisposition = item.assessment.disposition;
      group.latestAssistConfidence = item.assessment.confidence;
      group.latestAssistRationale = item.assessment.rationale;
      group.latestAssistLimitations = item.assessment.limitations;
      group.latestAssistProvider = item.provider ?? item.assessment.provider;
      group.latestAssistModel = item.model ?? item.assessment.model;
      group.latestAssistPolicyMode = item.policyMode ?? null;
      group.latestAssistLatencyMs = item.latencyMs ?? null;
      group.latestAssistReviewerAction =
        reviewerActionsByReceipt.get(item.assistReceiptId ?? "") ??
        (item.reviewerAction
          ? formatReviewerActionLabel(item.reviewerAction)
          : null);
      group.latestAssistRecordedAt = item.recordedAt;
      group.latestAssistErrorCode = null;
      return;
    }

    if (item.type === "assist_failed") {
      group.latestAssistStatus = "failed";
      group.latestAssistDisposition = null;
      group.latestAssistConfidence = null;
      group.latestAssistRationale = item.errorCode
        ? `The assist request failed before an assessment was returned: ${item.errorCode}.`
        : "The assist request failed before an assessment was returned.";
      group.latestAssistLimitations = [];
      group.latestAssistProvider = item.provider ?? null;
      group.latestAssistModel = item.model ?? null;
      group.latestAssistPolicyMode = item.policyMode ?? null;
      group.latestAssistLatencyMs = item.latencyMs ?? null;
      group.latestAssistReviewerAction =
        reviewerActionsByReceipt.get(item.assistReceiptId ?? "") ??
        (item.reviewerAction
          ? formatReviewerActionLabel(item.reviewerAction)
          : null);
      group.latestAssistRecordedAt = item.recordedAt;
      group.latestAssistErrorCode = item.errorCode ?? null;
    }
  });

  latestExportBySession.forEach((item, localSessionId) => {
    const group = ensureGroup(localSessionId);

    buildSyntheticExportEvents(item).forEach((event) => {
      if (group.eventTypes.has(event.type)) {
        return;
      }

      addSessionActivity(group, event);
    });
  });

  return Array.from(groups.values())
    .map((group) => {
      const activity = [...group.activity].sort(
        (left, right) =>
          getTimestampValue(right.timestamp) - getTimestampValue(left.timestamp)
      );
      const tone = activity.reduce<StatusTone>(
        (current, item) =>
          getTonePriority(item.tone) > getTonePriority(current) ? item.tone : current,
        group.exportStatus ? getExportTone(group.exportStatus) : "neutral"
      );

      return {
        ...group,
        latestTimestamp:
          activity[0]?.timestamp ?? group.latestTimestamp ?? group.latestAssistRecordedAt ?? "",
        tone,
        eventTypes: Array.from(group.eventTypes),
        eventCount: activity.length,
        activity,
      };
    })
    .sort(
      (left, right) =>
        getTimestampValue(right.latestTimestamp) - getTimestampValue(left.latestTimestamp)
    );
}

function buildActivityFeed(snapshot: OperationsSnapshot): ActivityFeedItem[] {
  return buildSessionActivityGroups(snapshot)
    .map((group) => {
      const latestActivity = group.activity[0];

      return {
        id: group.id,
        label:
          latestActivity?.label ??
          (group.exportStatus ? formatStatusLabel(group.exportStatus) : "Session activity"),
        title: group.exportSummary ?? group.localSessionId,
        detail: [
          group.clinicianId,
          group.localSessionId,
          latestActivity?.detail ?? group.destination,
        ]
          .filter(Boolean)
          .join(" · "),
        timestamp: group.latestTimestamp,
        tone: latestActivity?.tone ?? group.tone,
      };
    })
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
