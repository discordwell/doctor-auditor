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

import { api } from "../services/api";
import {
  buildOverviewModel,
  previewReviewSnapshot,
  type ReviewSnapshot,
} from "../services/reviewDashboard";

const compactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export default function OverviewView() {
  const [snapshot, setSnapshot] = useState<ReviewSnapshot>(previewReviewSnapshot);
  const [loading, setLoading] = useState(true);
  const [sourceMode, setSourceMode] = useState<"live" | "preview">("preview");
  const [notice, setNotice] = useState("");

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

        setSnapshot({
          sessions:
            sessionsResult.status === "fulfilled"
              ? sessionsResult.value
              : previewReviewSnapshot.sessions,
          findings:
            findingsResult.status === "fulfilled"
              ? findingsResult.value
              : previewReviewSnapshot.findings,
          approvedExports:
            exportsResult.status === "fulfilled"
              ? exportsResult.value
              : previewReviewSnapshot.approvedExports,
        });
        setSourceMode(hasLiveData ? "live" : "preview");

        if (!hasLiveData) {
          setNotice(
            "Review API unavailable. Showing resilient preview data instead of an empty shell."
          );
          return;
        }

        const fallbackParts = [
          sessionsResult.status === "rejected" ? "sessions" : "",
          findingsResult.status === "rejected" ? "findings" : "",
          exportsResult.status === "rejected" ? "approved exports" : "",
        ].filter(Boolean);

        setNotice(
          fallbackParts.length > 0
            ? `Using preview fallback for ${fallbackParts.join(", ")} while other review data stays live.`
            : ""
        );
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

  const overview = useMemo(() => buildOverviewModel(snapshot), [snapshot]);
  const sessionsById = useMemo(
    () => new Map(snapshot.sessions.map((session) => [session.id, session])),
    [snapshot.sessions]
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
            The overview is wired to the review endpoints and degrades
            intentionally when part of the surface is unavailable.
          </p>
        </div>
        <div className="source-card">
          <span className={`source-pill ${sourceMode}`}>
            {sourceMode === "live" ? "Live review data" : "Preview fallback"}
          </span>
          <p>
            {sourceMode === "live"
              ? "Connected to the active review surface. Metrics are derived from sessions, findings, and approved exports."
              : "The review API is unavailable, so the dashboard is rendering preview data instead of failing closed."}
          </p>
          <dl className="source-details">
            <div>
              <dt>Sessions in scope</dt>
              <dd>{compactNumber.format(overview.sessionsInScope)}</dd>
            </div>
            <div>
              <dt>Reviewed findings</dt>
              <dd>{overview.reviewedFindings}</dd>
            </div>
          </dl>
        </div>
      </section>

      {notice ? <div className="notice-card">{notice}</div> : null}

      <section className="stats-grid overview-kpis">
        <div className="stat-card kpi-card">
          <div className="stat-label">Open findings</div>
          <div className="stat-value attention">{overview.openFindings}</div>
          <p>{overview.agingItems} active sessions have been sitting in review for more than 48 hours.</p>
        </div>
        <div className="stat-card kpi-card">
          <div className="stat-label">Approved exports</div>
          <div className="stat-value success">{overview.approvedExportCount}</div>
          <p>Only approved or sent packets count here. Draft exports stay visible in the queue lane.</p>
        </div>
        <div className="stat-card kpi-card">
          <div className="stat-label">Reviewed findings</div>
          <div className="stat-value accent">{overview.reviewedFindings}</div>
          <p>Accepted, rejected, and revised findings stay auditable instead of collapsing into a score.</p>
        </div>
        <div className="stat-card kpi-card">
          <div className="stat-label">Session coverage</div>
          <div className="stat-value">{overview.sessionsInScope}</div>
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
            <AreaChart data={overview.weeklyActivity}>
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
            {overview.queueLanes.map((lane) => (
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
          {overview.focusItems.map((item) => (
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
          {overview.exportRows.map((approvedExport) => (
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
