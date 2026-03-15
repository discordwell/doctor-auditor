import React, { useEffect, useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

import { api, ApprovedExport, Finding, ReviewSession } from "../services/api";

type WeeklyActivityPoint = {
  period: string;
  sessions: number;
  findings: number;
  exports: number;
};

type QueueLane = {
  title: string;
  count: number;
  detail: string;
  tone: "attention" | "active" | "success";
};

type FocusItem = {
  title: string;
  count: number;
  detail: string;
  owner: string;
  tone: "alert" | "watch" | "stable";
};

const previewSessions: ReviewSession[] = [
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

const previewFindings: Finding[] = [
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

const previewApprovedExports: ApprovedExport[] = [
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
const compactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

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

function buildWeeklyActivity(
  sessions: ReviewSession[],
  findings: Finding[],
  approvedExports: ApprovedExport[]
): WeeklyActivityPoint[] {
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

  sessions.forEach((session) => {
    const point = pointByWeek.get(startOfUtcWeek(session.encounterStartedAt).toISOString());
    if (point) {
      point.sessions += 1;
    }
  });

  findings.forEach((finding) => {
    const point = pointByWeek.get(startOfUtcWeek(finding.updatedAt).toISOString());
    if (point) {
      point.findings += 1;
    }
  });

  approvedExports.forEach((approvedExport) => {
    const point = pointByWeek.get(startOfUtcWeek(approvedExport.approvedAt).toISOString());
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
    const owner = `${finding.detectedBy.replace(/_/g, " ")} · ${finding.status.replace(
      /_/g,
      " "
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

export default function OverviewView() {
  const [sessions, setSessions] = useState<ReviewSession[]>(previewSessions);
  const [findings, setFindings] = useState<Finding[]>(previewFindings);
  const [approvedExports, setApprovedExports] =
    useState<ApprovedExport[]>(previewApprovedExports);
  const [loading, setLoading] = useState(true);
  const [sourceMode, setSourceMode] = useState<"live" | "preview">("preview");

  useEffect(() => {
    let active = true;

    Promise.allSettled([
      api.getSessions(),
      api.getFindings(),
      api.getApprovedExports(),
    ])
      .then(([sessionsResult, findingsResult, exportsResult]) => {
        if (!active) {
          return;
        }

        const hasLiveData =
          sessionsResult.status === "fulfilled" ||
          findingsResult.status === "fulfilled" ||
          exportsResult.status === "fulfilled";

        if (hasLiveData) {
          setSessions(
            sessionsResult.status === "fulfilled"
              ? sessionsResult.value
              : previewSessions
          );
          setFindings(
            findingsResult.status === "fulfilled"
              ? findingsResult.value
              : previewFindings
          );
          setApprovedExports(
            exportsResult.status === "fulfilled"
              ? exportsResult.value
              : previewApprovedExports
          );
        }

        setSourceMode(hasLiveData ? "live" : "preview");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const openFindings = useMemo(
    () => findings.filter((finding) => OPEN_STATUSES.has(finding.status)),
    [findings]
  );
  const reviewedFindings = useMemo(
    () => findings.filter((finding) => REVIEWED_STATUSES.has(finding.status)),
    [findings]
  );
  const agingItems = useMemo(
    () =>
      sessions.filter((session) => {
        if (
          session.reviewStatus !== "ready" &&
          session.reviewStatus !== "in_review"
        ) {
          return false;
        }

        return Date.now() - new Date(session.updatedAt).getTime() > 2 * DAY_MS;
      }).length,
    [sessions]
  );

  const queueLanes: QueueLane[] = useMemo(
    () => [
      {
        title: "Awaiting review decision",
        count: findings.filter(
          (finding) =>
            finding.status === "draft" || finding.status === "pending_review"
        ).length,
        detail:
          "Findings that still need a human decision before they can move forward.",
        tone: "attention",
      },
      {
        title: "Needs evidence edits",
        count: findings.filter(
          (finding) =>
            finding.status === "uncertain" || finding.status === "revised"
        ).length,
        detail:
          "Evidence spans or summaries changed during review and need another pass.",
        tone: "active",
      },
      {
        title: "Export packets in queue",
        count: approvedExports.filter(
          (approvedExport) =>
            approvedExport.status === "draft" ||
            approvedExport.status === "approved"
        ).length,
        detail:
          "Export packets stay downstream of review until a lead sends them.",
        tone: "success",
      },
    ],
    [approvedExports, findings]
  );

  const focusItems = useMemo(
    () => buildFocusItems(openFindings.length > 0 ? openFindings : findings),
    [findings, openFindings]
  );
  const weeklyActivity = useMemo(
    () => buildWeeklyActivity(sessions, findings, approvedExports),
    [approvedExports, findings, sessions]
  );
  const sessionsById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions]
  );
  const exportRows = useMemo(
    () =>
      [...approvedExports]
        .sort((left, right) => right.approvedAt.localeCompare(left.approvedAt))
        .slice(0, 4),
    [approvedExports]
  );

  if (loading) {
    return <div className="empty-state">Loading review operations surface...</div>;
  }

  return (
    <div className="overview-shell">
      <section className="overview-hero">
        <div>
          <span className="overview-eyebrow">Beacon overview</span>
          <h2>Sessions, findings, and approved exports in one review surface</h2>
          <p className="overview-intro">
            The overview is now wired to the live review endpoints. A demo
            reviewer token is bootstrapped automatically so the dashboard can
            read session, finding, and export data without manual setup.
          </p>
        </div>
        <div className="source-card">
          <span className={`source-pill ${sourceMode}`}>
            {sourceMode === "live" ? "Live review data" : "Preview fallback"}
          </span>
          <p>
            {sourceMode === "live"
              ? "Connected to the active review surface. Metrics are derived from live sessions, findings, and approved exports."
              : "The review API is unavailable, so the dashboard is rendering preview data instead of an empty shell."}
          </p>
          <dl className="source-details">
            <div>
              <dt>Sessions in scope</dt>
              <dd>{compactNumber.format(sessions.length)}</dd>
            </div>
            <div>
              <dt>Reviewed findings</dt>
              <dd>{reviewedFindings.length}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="stats-grid overview-kpis">
        <div className="stat-card kpi-card">
          <div className="stat-label">Open findings</div>
          <div className="stat-value attention">{openFindings.length}</div>
          <p>{agingItems} active sessions have been sitting in review for more than 48 hours.</p>
        </div>
        <div className="stat-card kpi-card">
          <div className="stat-label">Approved exports</div>
          <div className="stat-value success">
            {
              approvedExports.filter(
                (approvedExport) =>
                  approvedExport.status === "approved" ||
                  approvedExport.status === "sent"
              ).length
            }
          </div>
          <p>Only approved or sent packets count here. Draft exports stay visible in the queue lane.</p>
        </div>
        <div className="stat-card kpi-card">
          <div className="stat-label">Reviewed findings</div>
          <div className="stat-value accent">{reviewedFindings.length}</div>
          <p>Accepted, rejected, and revised findings stay auditable instead of collapsing into a score.</p>
        </div>
        <div className="stat-card kpi-card">
          <div className="stat-label">Session coverage</div>
          <div className="stat-value">{sessions.length}</div>
          <p>Every card in this overview is anchored to a session, finding, or approved export record.</p>
        </div>
      </section>

      <section className="overview-panels">
        <div className="chart-container panel-card">
          <div className="panel-header">
            <div>
              <span className="overview-eyebrow">Activity</span>
              <h3>How review work is moving week to week</h3>
            </div>
            <p>
              Sessions, findings, and exports are tracked independently so the
              overview tells a workflow story instead of a risk-average story.
            </p>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={weeklyActivity}>
              <defs>
                <linearGradient id="sessionsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3dd6d0" stopOpacity={0.55} />
                  <stop offset="95%" stopColor="#3dd6d0" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="exportsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ffd166" stopOpacity={0.45} />
                  <stop offset="95%" stopColor="#ffd166" stopOpacity={0.08} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#233241" />
              <XAxis dataKey="period" stroke="#7ea0b7" />
              <YAxis stroke="#7ea0b7" allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  background: "#102330",
                  border: "1px solid #294457",
                  borderRadius: "14px",
                  boxShadow: "0 22px 50px rgba(5, 18, 24, 0.28)",
                }}
              />
              <Area
                type="monotone"
                dataKey="sessions"
                stroke="#3dd6d0"
                fill="url(#sessionsFill)"
                name="Sessions"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="findings"
                stroke="#8cc9ff"
                fill="transparent"
                name="Findings"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="exports"
                stroke="#ffd166"
                fill="url(#exportsFill)"
                name="Approved exports"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="panel-card">
          <div className="panel-header">
            <div>
              <span className="overview-eyebrow">Queue</span>
              <h3>Where the review backlog is collecting</h3>
            </div>
            <p>
              These lanes come directly from finding and export statuses instead
              of from inferred risk buckets.
            </p>
          </div>
          <div className="queue-lanes">
            {queueLanes.map((lane) => (
              <article key={lane.title} className={`queue-lane ${lane.tone}`}>
                <div className="queue-count">{lane.count}</div>
                <div>
                  <h4>{lane.title}</h4>
                  <p>{lane.detail}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="focus-section">
        <div className="panel-header">
          <div>
            <span className="overview-eyebrow">Focus areas</span>
            <h3>Findings that deserve a second look</h3>
          </div>
          <p>
            Tiles are grouped from the current finding set, with status and
            detection source kept visible.
          </p>
        </div>
        <div className="focus-grid">
          {focusItems.map((item) => (
            <article key={item.title} className={`focus-card ${item.tone}`}>
              <div className="focus-card-top">
                <span className="focus-count">{item.count}</span>
                <span className="focus-owner">{item.owner}</span>
              </div>
              <h4>{item.title}</h4>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="panel-card export-section">
        <div className="panel-header">
          <div>
            <span className="overview-eyebrow">Exports</span>
            <h3>Approved export lane</h3>
          </div>
          <p>
            Export packets remain explicitly downstream of review. Draft,
            approved, and sent states stay visible as separate steps.
          </p>
        </div>
        <div className="export-table">
          <div className="export-row export-head">
            <span>Approved</span>
            <span>Clinician</span>
            <span>Destination</span>
            <span>Status</span>
            <span>Summary</span>
          </div>
          {exportRows.map((approvedExport) => (
            <div key={approvedExport.id} className="export-row">
              <span>
                {new Date(approvedExport.approvedAt).toLocaleDateString(
                  "en-US",
                  {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  }
                )}
              </span>
              <span>
                {sessionsById.get(approvedExport.sessionId)?.clinicianId ??
                  "unassigned"}
              </span>
              <span>{approvedExport.destination ?? "manual-review-hold"}</span>
              <span className={`status-pill ${approvedExport.status}`}>
                {approvedExport.status.replace(/_/g, " ")}
              </span>
              <span>{approvedExport.summary}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
