import { api, type ApprovedExport, type Finding, type ReviewSession } from "./api";

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

export const EMPTY_REVIEW_SNAPSHOT: ReviewSnapshot = {
  sessions: [],
  findings: [],
  approvedExports: [],
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

export async function loadSessions(
  filter: "all" | ReviewSession["reviewStatus"] = "all"
): Promise<ReviewSession[]> {
  return sortSessions(
    await api.getSessions(filter === "all" ? undefined : { reviewStatus: filter }),
    filter
  );
}

export async function loadFindings(
  filter: "all" | Finding["status"] = "all"
): Promise<Finding[]> {
  return sortFindings(
    await api.getFindings(filter === "all" ? undefined : { status: filter }),
    filter
  );
}

export async function loadApprovedExports(
  filter: "all" | ApprovedExport["status"] = "all"
): Promise<ApprovedExport[]> {
  return sortApprovedExports(
    await api.getApprovedExports(
      filter === "all" ? undefined : { exportStatus: filter }
    ),
    filter
  );
}

export async function loadReviewSnapshot(): Promise<ReviewSnapshot> {
  const [sessions, findings, approvedExports] = await Promise.all([
    api.getSessions(),
    api.getFindings(),
    api.getApprovedExports(),
  ]);

  return {
    sessions: sortSessions(sessions),
    findings: sortFindings(findings),
    approvedExports: sortApprovedExports(approvedExports),
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
