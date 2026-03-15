import React, { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { describeDashboardLoadIssue } from "../services/api";
import {
  buildOverviewModel,
  EMPTY_OPERATIONS_SNAPSHOT,
  formatDateTime,
  formatDuration,
  formatRelativeAge,
  formatStatusLabel,
  getExportTone,
  loadOperationsSnapshot,
  type OperationsSnapshot,
} from "../services/opsDashboard";

export default function OverviewView() {
  const [snapshot, setSnapshot] = useState<OperationsSnapshot>(
    EMPTY_OPERATIONS_SNAPSHOT
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let active = true;

    setLoading(true);
    setError(null);

    loadOperationsSnapshot()
      .then((data) => {
        if (active) {
          setSnapshot(data);
        }
      })
      .catch((fetchError) => {
        if (active) {
          setError(fetchError);
        }
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
  const loadIssue = error ? describeDashboardLoadIssue(error) : null;

  if (loading) {
    return <div className="empty-state">Loading dashboard data...</div>;
  }

  if (loadIssue) {
    return (
      <section className={`load-issue ${loadIssue.tone}`}>
        <strong>{loadIssue.title}</strong>
        <p>{loadIssue.detail}</p>
      </section>
    );
  }

  if (overview.totalExports === 0 && snapshot.opsEvents.length === 0) {
    return (
      <div className="empty-state">
        No reviewed exports or operations events are available for this
        organization yet.
      </div>
    );
  }

  return (
    <div className="page-shell overview-shell">
      <section className="page-header">
        <div>
          <p className="section-kicker">Overview</p>
          <h2>What needs attention today</h2>
          <p className="page-copy">
            Release backlog, operator issues, and recent activity across the
            reviewed session queue.
          </p>
        </div>
        <div className="hero-stats">
          <div className="hero-stat">
            <span>Average release time</span>
            <strong>{formatDuration(overview.averageSendLatencyMs)}</strong>
            <p>Approval to downstream delivery.</p>
          </div>
          <div className="hero-stat">
            <span>Sent in the last 7 days</span>
            <strong>{overview.sentLast7Days}</strong>
            <p>Completed releases during the current weekly window.</p>
          </div>
        </div>
      </section>

      <section className="stats-grid">
        <article className="stat-card">
          <div className="stat-label">Ready to send</div>
          <div className="stat-value attention">{overview.approvedExports}</div>
          <p className="stat-detail">
            Approved exports waiting on manual or downstream release.
          </p>
        </article>
        <article className="stat-card">
          <div className="stat-label">In review</div>
          <div className="stat-value active">{overview.draftExports}</div>
          <p className="stat-detail">
            Sessions reviewed locally but not approved yet.
          </p>
        </article>
        <article className="stat-card">
          <div className="stat-label">Sent</div>
          <div className="stat-value success">{overview.sentExports}</div>
          <p className="stat-detail">
            Exports already handed off after approval.
          </p>
        </article>
        <article className="stat-card">
          <div className="stat-label">Active issues</div>
          <div className="stat-value attention">{overview.activeIssuesCount}</div>
          <p className="stat-detail">
            Failed assists, redaction blocks, and aging release backlog.
          </p>
        </article>
      </section>

      <section className="overview-main">
        <div className="panel-card">
          <div className="panel-header">
            <div>
              <p className="section-kicker">Trend</p>
              <h3>Weekly release and assist activity</h3>
            </div>
            <p>
              Compare export volume against assist traffic and privacy blocks to
              spot backlog pressure quickly.
            </p>
          </div>
          <div className="chart-shell">
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={overview.weeklyActivity}>
                <defs>
                  <linearGradient id="exportsFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0.04} />
                  </linearGradient>
                  <linearGradient id="assistsFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0891b2" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#0891b2" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#dbe5f0" vertical={false} />
                <XAxis
                  dataKey="period"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#64748b", fontSize: 12 }}
                />
                <YAxis
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#64748b", fontSize: 12 }}
                />
                <Tooltip
                  cursor={{ stroke: "#bfdbfe", strokeWidth: 1 }}
                  contentStyle={{
                    background: "#ffffff",
                    border: "1px solid #d6dee8",
                    borderRadius: "14px",
                    boxShadow: "0 14px 34px rgba(15, 23, 42, 0.08)",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="exports"
                  stroke="#2563eb"
                  fill="url(#exportsFill)"
                  strokeWidth={2}
                  name="Exports"
                />
                <Area
                  type="monotone"
                  dataKey="assists"
                  stroke="#0891b2"
                  fill="url(#assistsFill)"
                  strokeWidth={2}
                  name="Assist events"
                />
                <Area
                  type="monotone"
                  dataKey="blocks"
                  stroke="#c2410c"
                  fill="transparent"
                  strokeWidth={2}
                  name="Blocks"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel-card">
          <div className="panel-header">
            <div>
              <p className="section-kicker">Backlog</p>
              <h3>Clinician workload</h3>
            </div>
            <p>Pending reviewed sessions grouped by clinician.</p>
          </div>
          {overview.clinicianWorkload.length === 0 ? (
            <div className="empty-state compact">No workload to show.</div>
          ) : (
            <div className="workload-list">
              {overview.clinicianWorkload.map((item) => {
                const totalPending = Math.max(item.pendingCount, 1);
                const approvedWidth = (item.approvedCount / totalPending) * 100;
                const draftWidth = (item.draftCount / totalPending) * 100;

                return (
                  <article key={item.clinicianId} className="workload-row">
                    <div className="workload-row__meta">
                      <div>
                        <h4>{item.clinicianId}</h4>
                        <p>
                          {item.pendingCount} pending · {item.sentCount} sent
                        </p>
                      </div>
                      <span className="mini-meta">
                        Updated {formatDateTime(item.lastTouchedAt)}
                      </span>
                    </div>
                    <div className="workload-bar">
                      <span
                        className="workload-bar__segment ready"
                        style={{ width: `${approvedWidth}%` }}
                      />
                      <span
                        className="workload-bar__segment review"
                        style={{ width: `${draftWidth}%` }}
                      />
                    </div>
                    <div className="workload-row__stats">
                      <span>Ready {item.approvedCount}</span>
                      <span>In review {item.draftCount}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="split-panels">
        <div className="panel-card">
          <div className="panel-header">
            <div>
              <p className="section-kicker">Queue</p>
              <h3>Release queue</h3>
            </div>
            <p>Oldest approved exports rise to the top, followed by drafts.</p>
          </div>
          {overview.releaseQueue.length === 0 ? (
            <div className="empty-state compact">No releases are waiting.</div>
          ) : (
            <div className="queue-list">
              {overview.releaseQueue.map((item) => (
                <article key={item.id} className={`queue-row ${item.tone}`}>
                  <div className="queue-row__main">
                    <div className="queue-row__title">
                      <div>
                        <h4>{item.clinicianId}</h4>
                        <p>
                          {item.sessionId} · {item.destination}
                        </p>
                      </div>
                      <span
                        className={`status-badge ${getExportTone(item.status)}`}
                      >
                        {formatStatusLabel(item.status)}
                      </span>
                    </div>
                    <p className="queue-row__summary">{item.summary}</p>
                    <div className="queue-row__meta">
                      <span>{item.findingsCount} findings</span>
                      <span>{item.owner}</span>
                      <span>{formatDateTime(item.updatedAt)}</span>
                    </div>
                  </div>
                  <div className="queue-row__aside">
                    <strong>{item.ageLabel}</strong>
                    <span>
                      {item.status === "approved" ? "Since approval" : "Since review"}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="panel-card">
          <div className="panel-header">
            <div>
              <p className="section-kicker">Issues</p>
              <h3>Operator follow-up</h3>
            </div>
            <p>Failures, blocks, and release delays that still need action.</p>
          </div>
          {overview.opsIssues.length === 0 ? (
            <div className="empty-state compact">
              No operator issues are open right now.
            </div>
          ) : (
            <div className="issue-list">
              {overview.opsIssues.map((item) => (
                <article key={item.id} className="issue-row">
                  <div className="issue-row__top">
                    <span className={`status-badge ${item.tone}`}>
                      {item.title}
                    </span>
                    <time>{formatDateTime(item.timestamp)}</time>
                  </div>
                  <p>{item.detail}</p>
                  <div className="issue-row__meta">
                    <span>{item.sessionId}</span>
                    <span>{formatRelativeAge(item.timestamp)}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="panel-card">
        <div className="panel-header">
          <div>
            <p className="section-kicker">Recent activity</p>
            <h3>Latest export and ops events</h3>
          </div>
          <p>The most recent queue changes across approvals, releases, and ops.</p>
        </div>
        <div className="activity-list">
          {overview.activityFeed.map((item) => (
            <article key={item.id} className="activity-row">
              <div className="activity-row__badge">
                <span className={`status-dot ${item.tone}`} />
                <span>{item.label}</span>
              </div>
              <div className="activity-row__content">
                <h4>{item.title}</h4>
                <p>{item.detail}</p>
              </div>
              <time>{formatDateTime(item.timestamp)}</time>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
