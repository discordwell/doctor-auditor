import React, { useState, useEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { api, OverviewStats, TrendPoint } from "../services/api";

export default function OverviewView() {
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.getOverview(), api.getTrends()])
      .then(([overviewData, trendsData]) => {
        setStats(overviewData);
        setTrends(trendsData);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="empty-state">Loading...</div>;
  }

  if (!stats) {
    return <div className="empty-state">Unable to load dashboard data.</div>;
  }

  const getRiskClass = (score: number | null): string => {
    if (score === null) return "";
    if (score >= 7) return "high";
    if (score >= 4) return "medium";
    return "low";
  };

  return (
    <div>
      <h2>Overview</h2>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Sessions</div>
          <div className="stat-value">{stats.total_sessions}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">High Risk</div>
          <div className="stat-value high">{stats.high_risk_count}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Medium Risk</div>
          <div className="stat-value medium">{stats.medium_risk_count}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Low Risk</div>
          <div className="stat-value low">{stats.low_risk_count}</div>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Avg Communication</div>
          <div className={`stat-value ${getRiskClass(stats.avg_communication)}`}>
            {stats.avg_communication ?? "—"}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Avg Clinical</div>
          <div className={`stat-value ${getRiskClass(stats.avg_clinical)}`}>
            {stats.avg_clinical ?? "—"}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Avg Behavioral</div>
          <div className={`stat-value ${getRiskClass(stats.avg_behavioral)}`}>
            {stats.avg_behavioral ?? "—"}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Avg Overall</div>
          <div className={`stat-value ${getRiskClass(stats.avg_overall)}`}>
            {stats.avg_overall ?? "—"}
          </div>
        </div>
      </div>

      {trends.length > 0 && (
        <div className="chart-container">
          <h3>Risk Trends Over Time</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={trends}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d3040" />
              <XAxis
                dataKey="period"
                stroke="#9ca3af"
                tickFormatter={(v) =>
                  new Date(v).toLocaleDateString("en-US", {
                    month: "short",
                    year: "2-digit",
                  })
                }
              />
              <YAxis stroke="#9ca3af" domain={[0, 10]} />
              <Tooltip
                contentStyle={{
                  background: "#21242f",
                  border: "1px solid #2d3040",
                  borderRadius: "8px",
                }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="avg_communication"
                stroke="#3b82f6"
                name="Communication"
                strokeWidth={2}
              />
              <Line
                type="monotone"
                dataKey="avg_clinical"
                stroke="#ef4444"
                name="Clinical"
                strokeWidth={2}
              />
              <Line
                type="monotone"
                dataKey="avg_behavioral"
                stroke="#f59e0b"
                name="Behavioral"
                strokeWidth={2}
              />
              <Line
                type="monotone"
                dataKey="avg_overall"
                stroke="#22c55e"
                name="Overall"
                strokeWidth={2}
                strokeDasharray="5 5"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
