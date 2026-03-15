import React, { useEffect, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { api, OverviewStats, TrendPoint } from "../services/api";

type ReviewFlowPoint = {
  period: string;
  intake: number;
  ready: number;
  approved: number;
};

type QueueLane = {
  title: string;
  count: string;
  detail: string;
  tone: "attention" | "active" | "success";
};

type FocusItem = {
  title: string;
  count: string;
  detail: string;
  owner: string;
  tone: "alert" | "watch" | "stable";
};

const fallbackFlowSeed: Array<Pick<TrendPoint, "period" | "session_count">> = [
  { period: "2026-01-06", session_count: 12 },
  { period: "2026-01-13", session_count: 15 },
  { period: "2026-01-20", session_count: 19 },
  { period: "2026-01-27", session_count: 17 },
  { period: "2026-02-03", session_count: 22 },
  { period: "2026-02-10", session_count: 24 },
];

const compactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function buildReviewFlow(
  points: Array<Pick<TrendPoint, "period" | "session_count">>
): ReviewFlowPoint[] {
  const source = points.length > 0 ? points.slice(-6) : fallbackFlowSeed;

  return source.map((point, index) => ({
    period: point.period,
    intake: point.session_count,
    ready: Math.max(3, Math.round(point.session_count * 0.72) + (index % 2)),
    approved: Math.max(1, Math.round(point.session_count * 0.38) - (index % 2)),
  }));
}

function formatPeriod(value: string): string {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default function OverviewView() {
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [sourceMode, setSourceMode] = useState<"live" | "preview">("preview");

  useEffect(() => {
    let active = true;

    Promise.allSettled([api.getOverview(), api.getTrends()])
      .then(([overviewResult, trendsResult]) => {
        if (!active) {
          return;
        }

        const hasLiveData =
          overviewResult.status === "fulfilled" ||
          trendsResult.status === "fulfilled";

        if (overviewResult.status === "fulfilled") {
          setStats(overviewResult.value);
        }

        if (trendsResult.status === "fulfilled") {
          setTrends(trendsResult.value);
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

  if (loading) {
    return <div className="empty-state">Loading review operations shell...</div>;
  }

  const flow = buildReviewFlow(trends);
  const connectedSessions =
    stats?.total_sessions ??
    flow.reduce((total, point) => total + point.intake, 0);
  const latestWindow = flow[flow.length - 1];
  const reviewQueue = Math.max(
    8,
    (latestWindow?.ready ?? 0) - (latestWindow?.approved ?? 0) + 6
  );
  const flaggedFindings = Math.max(
    14,
    reviewQueue + Math.round(connectedSessions / 7)
  );
  const approvedExports = Math.max(
    6,
    flow.reduce((total, point) => total + point.approved, 0)
  );
  const agingItems = Math.max(2, Math.round(reviewQueue * 0.3));
  const reviewedToday = Math.max(10, (latestWindow?.approved ?? 0) + 4);

  const queueLanes: QueueLane[] = [
    {
      title: "Needs reviewer assignment",
      count: `${Math.max(4, Math.round(reviewQueue * 0.45))}`,
      detail: "Fresh findings grouped after transcript and evidence packaging.",
      tone: "attention",
    },
    {
      title: "In evidence confirmation",
      count: `${Math.max(3, Math.round(reviewQueue * 0.35))}`,
      detail: "Reviewer is checking quote spans, timestamps, and missing context.",
      tone: "active",
    },
    {
      title: "Approved for export",
      count: `${Math.max(2, Math.round(approvedExports * 0.3))}`,
      detail: "Payload is redacted and waiting for downstream delivery approval.",
      tone: "success",
    },
  ];

  const focusItems: FocusItem[] = [
    {
      title: "Missing follow-up instructions",
      count: `${Math.max(3, Math.round(flaggedFindings * 0.27))}`,
      detail:
        "Shows up most often in short closeouts where the patient leaves without next-step language.",
      owner: "Clinical QA",
      tone: "alert",
    },
    {
      title: "Medication risk not explained",
      count: `${Math.max(2, Math.round(flaggedFindings * 0.2))}`,
      detail:
        "Evidence clips cluster around treatment changes that lack side-effect counseling.",
      owner: "Safety review",
      tone: "watch",
    },
    {
      title: "Patient concern restated incorrectly",
      count: `${Math.max(2, Math.round(flaggedFindings * 0.16))}`,
      detail:
        "Useful for auditing whether the clinician reflected the core symptom accurately.",
      owner: "Communication review",
      tone: "watch",
    },
    {
      title: "Unresolved direct question",
      count: `${Math.max(1, Math.round(flaggedFindings * 0.11))}`,
      detail:
        "Questions remain open at session end and should be either resolved or explicitly deferred.",
      owner: "Operations",
      tone: "stable",
    },
  ];

  return (
    <div className="overview-shell">
      <section className="overview-hero">
        <div>
          <span className="overview-eyebrow">Beacon overview</span>
          <h2>Review activity, evidence backlog, and export readiness</h2>
          <p className="overview-intro">
            This shell reframes the dashboard around auditable review work. Live
            legacy session totals are used when available, while review queue
            and export states stay local until the new server contract lands.
          </p>
        </div>
        <div className="source-card">
          <span className={`source-pill ${sourceMode}`}>
            {sourceMode === "live" ? "Partially connected" : "Preview mode"}
          </span>
          <p>
            {sourceMode === "live"
              ? "Using legacy dashboard totals for intake volume while review queue metrics stay scaffolded locally."
              : "No review-oriented API is available yet, so this overview is using shell data only."}
          </p>
          <dl className="source-details">
            <div>
              <dt>Connected sessions</dt>
              <dd>{compactNumber.format(connectedSessions)}</dd>
            </div>
            <div>
              <dt>Reviewed today</dt>
              <dd>{reviewedToday}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="stats-grid overview-kpis">
        <div className="stat-card kpi-card">
          <div className="stat-label">Open review queue</div>
          <div className="stat-value">{reviewQueue}</div>
          <p>{agingItems} items are aging past the 48-hour review target.</p>
        </div>
        <div className="stat-card kpi-card">
          <div className="stat-label">Flagged findings</div>
          <div className="stat-value attention">{flaggedFindings}</div>
          <p>Evidence-linked issues awaiting a reviewer decision or escalation.</p>
        </div>
        <div className="stat-card kpi-card">
          <div className="stat-label">Approved exports</div>
          <div className="stat-value success">{approvedExports}</div>
          <p>Redacted summaries are ready for downstream delivery once approved.</p>
        </div>
        <div className="stat-card kpi-card">
          <div className="stat-label">Connected intake volume</div>
          <div className="stat-value accent">{compactNumber.format(connectedSessions)}</div>
          <p>Live session totals appear here first while review-specific endpoints catch up.</p>
        </div>
      </section>

      <section className="overview-panels">
        <div className="chart-container panel-card">
          <div className="panel-header">
            <div>
              <span className="overview-eyebrow">Flow</span>
              <h3>Session intake moving toward reviewed evidence</h3>
            </div>
            <p>
              Intake is live when the legacy endpoint responds. Review-ready and
              approved values are shell estimates until queue APIs exist.
            </p>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={flow}>
              <defs>
                <linearGradient id="intakeFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3dd6d0" stopOpacity={0.55} />
                  <stop offset="95%" stopColor="#3dd6d0" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="approvedFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ffd166" stopOpacity={0.45} />
                  <stop offset="95%" stopColor="#ffd166" stopOpacity={0.08} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#233241" />
              <XAxis
                dataKey="period"
                stroke="#7ea0b7"
                tickFormatter={formatPeriod}
              />
              <YAxis stroke="#7ea0b7" />
              <Tooltip
                labelFormatter={formatPeriod}
                contentStyle={{
                  background: "#102330",
                  border: "1px solid #294457",
                  borderRadius: "14px",
                  boxShadow: "0 22px 50px rgba(5, 18, 24, 0.28)",
                }}
              />
              <Area
                type="monotone"
                dataKey="intake"
                stroke="#3dd6d0"
                fill="url(#intakeFill)"
                name="Session intake"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="ready"
                stroke="#8cc9ff"
                fill="transparent"
                name="Ready for review"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="approved"
                stroke="#ffd166"
                fill="url(#approvedFill)"
                name="Approved for export"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="panel-card">
          <div className="panel-header">
            <div>
              <span className="overview-eyebrow">Queue</span>
              <h3>Where reviewers are spending time</h3>
            </div>
            <p>The shell prioritizes aging work, evidence confirmation, and export approval.</p>
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
            <h3>Findings worth a second look</h3>
          </div>
          <p>
            These tiles are intentionally review-oriented: each one assumes
            evidence clips, a human reviewer, and a reversible decision.
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
            Export actions stay explicitly downstream of review approval. The
            shell keeps that separation visible even before the server flow lands.
          </p>
        </div>
        <div className="export-table">
          <div className="export-row export-head">
            <span>Batch</span>
            <span>Destination</span>
            <span>Status</span>
            <span>Notes</span>
          </div>
          <div className="export-row">
            <span>Outpatient follow-up</span>
            <span>Claims review queue</span>
            <span className="status-pill ready">Ready to send</span>
            <span>14 reviewed sessions with approved redactions.</span>
          </div>
          <div className="export-row">
            <span>Escalation subset</span>
            <span>Internal quality review</span>
            <span className="status-pill review">Needs final approval</span>
            <span>3 sessions waiting for a supervisor sign-off.</span>
          </div>
          <div className="export-row">
            <span>Weekly audit sample</span>
            <span>Compliance archive</span>
            <span className="status-pill sent">Sent</span>
            <span>Delivery completed after reviewer approval and redaction check.</span>
          </div>
        </div>
      </section>
    </div>
  );
}
