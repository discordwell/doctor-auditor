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
  formatStatusLabel,
  getExportTone,
  getOpsTone,
  loadOperationsSnapshot,
  type OperationsSnapshot,
} from "../services/opsDashboard";

const compactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

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
    return (
      <div className="empty-state">
        Loading the approved export and safe ops surface...
      </div>
    );
  }

  if (loadIssue) {
    return (
      <section className={`load-issue ${loadIssue.tone}`}>
        <strong>{loadIssue.title}</strong>
        <p>{loadIssue.detail}</p>
      </section>
    );
  }

  if (
    overview.totalExports === 0 &&
    snapshot.opsEvents.length === 0
  ) {
    return (
      <div className="empty-state">
        No approved export or safe ops data is available for this organization yet.
      </div>
    );
  }

  return (
    <div className="overview-shell">
      <section className="overview-hero">
        <div>
          <span className="overview-eyebrow">Cloud boundary</span>
          <h2>Approved exports and safe ops only</h2>
          <p className="overview-intro">
            This console stays focused on approved export envelopes plus non-PHI
            operational signals from assist and delivery flows. Desktop review
            state never becomes a central cloud work queue.
          </p>
        </div>
        <div className="source-card">
          <p>
            Metrics below are derived from approved export envelopes and safe ops
            events only. Raw transcript text, findings, and reviewer notes remain
            desktop-local.
          </p>
          <dl className="source-details">
            <div>
              <dt>Total exports</dt>
              <dd>{compactNumber.format(overview.totalExports)}</dd>
            </div>
            <div>
              <dt>Assist usage</dt>
              <dd>{overview.assistUsageCount}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="stats-grid overview-kpis">
        <div className="stat-card kpi-card">
          <div className="stat-label">Approved exports</div>
          <div className="stat-value attention">{overview.approvedExports}</div>
          <p>Approved packets waiting for downstream delivery or manual release.</p>
        </div>
        <div className="stat-card kpi-card">
          <div className="stat-label">Sent exports</div>
          <div className="stat-value success">{overview.sentExports}</div>
          <p>Exports already delivered after local review and approval.</p>
        </div>
        <div className="stat-card kpi-card">
          <div className="stat-label">Assist overrides</div>
          <div className="stat-value accent">{overview.assistOverrideCount}</div>
          <p>Human reviewers explicitly overrode a remote-assist result.</p>
        </div>
        <div className="stat-card kpi-card">
          <div className="stat-label">Redaction blocks</div>
          <div className="stat-value">{overview.redactionBlockCount}</div>
          <p>Local privacy checks blocked assist or export progress.</p>
        </div>
      </section>

      <section className="overview-panels">
        <div className="chart-container panel-card">
          <div className="panel-header">
            <div>
              <span className="overview-eyebrow">Activity</span>
              <h3>Export and ops signals by week</h3>
            </div>
            <p>
              Exports, assist events, and privacy blocks are tracked separately to
              preserve the local/cloud boundary.
            </p>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={overview.weeklyActivity}>
              <defs>
                <linearGradient id="exportsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ffd166" stopOpacity={0.45} />
                  <stop offset="95%" stopColor="#ffd166" stopOpacity={0.08} />
                </linearGradient>
                <linearGradient id="assistsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3dd6d0" stopOpacity={0.45} />
                  <stop offset="95%" stopColor="#3dd6d0" stopOpacity={0.08} />
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
                dataKey="exports"
                stroke="#ffd166"
                fill="url(#exportsFill)"
                name="Exports"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="assists"
                stroke="#3dd6d0"
                fill="url(#assistsFill)"
                name="Assist events"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="blocks"
                stroke="#ff7b7b"
                fill="transparent"
                name="Privacy blocks"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="panel-card">
          <div className="panel-header">
            <div>
              <span className="overview-eyebrow">Queue</span>
              <h3>Central follow-up lanes</h3>
            </div>
            <p>
              The cloud queue is limited to delivery and safe operational follow-up.
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
            <h3>Ops items that need operator follow-up</h3>
          </div>
          <p>
            These cards stay operational and avoid recreating a centralized clinical
            review queue.
          </p>
        </div>
        <div className="focus-grid">
          {overview.focusItems.map((item) => (
            <article key={item.title} className={`focus-card ${item.tone}`}>
              <div className="focus-count">{item.count}</div>
              <div>
                <h4>{item.title}</h4>
                <p>{item.detail}</p>
                <span>{item.owner}</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="overview-panels">
        <div className="panel-card">
          <div className="panel-header">
            <div>
              <span className="overview-eyebrow">Recent exports</span>
              <h3>Latest boundary-safe export envelopes</h3>
            </div>
            <p>
              Every export row carries only safe session metadata plus the approved packet.
            </p>
          </div>
          <div className="export-list">
            {overview.exportRows.map((item) => (
              <article key={item.id} className="export-row">
                <div>
                  <p className="mono-code">{item.id}</p>
                  <h4>{item.session.clinicianId}</h4>
                  <p>{item.export.summary}</p>
                </div>
                <div className="export-row__meta">
                  <span className={`status-badge ${getExportTone(item.export.status)}`}>
                    {formatStatusLabel(item.export.status)}
                  </span>
                  <span>{item.export.destination ?? "Manual hold"}</span>
                  <span>{formatDateTime(item.export.approvedAt)}</span>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="panel-card">
          <div className="panel-header">
            <div>
              <span className="overview-eyebrow">Recent ops</span>
              <h3>Latest non-PHI operational events</h3>
            </div>
            <p>
              Event rows keep provider, policy, and latency metadata but not prompts or evidence text.
            </p>
          </div>
          <div className="export-list">
            {overview.recentOpsEvents.map((event) => (
              <article key={event.id} className="export-row">
                <div>
                  <p className="mono-code">{event.id}</p>
                  <h4>{formatStatusLabel(event.type)}</h4>
                  <p>{event.localSessionId}</p>
                </div>
                <div className="export-row__meta">
                  <span className={`status-badge ${getOpsTone(event.type)}`}>
                    {formatStatusLabel(event.type)}
                  </span>
                  <span>{event.provider ?? "local desktop"}</span>
                  <span>{formatDateTime(event.recordedAt)}</span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
