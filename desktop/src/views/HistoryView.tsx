import React, { useState, useEffect } from "react";

interface SessionSummary {
  id: string;
  doctorId: string;
  startTime: string;
  endTime?: string;
  riskAssessment?: {
    overallRisk: string;
    overallScore: number;
  };
}

export default function HistoryView() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);

  useEffect(() => {
    if (window.doctorAuditor) {
      window.doctorAuditor.session.getAll().then((data) => {
        setSessions(data as SessionSummary[]);
      });
    }
  }, []);

  const formatDate = (iso: string): string => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatDuration = (start: string, end?: string): string => {
    if (!end) return "In progress";
    const seconds =
      (new Date(end).getTime() - new Date(start).getTime()) / 1000;
    const m = Math.floor(seconds / 60);
    return `${m} min`;
  };

  if (sessions.length === 0) {
    return (
      <div className="history-view">
        <h2>Session History</h2>
        <div className="empty-state">
          <p>No recorded sessions yet.</p>
          <p>Start a recording to see sessions here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="history-view">
      <h2>Session History</h2>
      <div className="session-list">
        {sessions.map((session) => (
          <div key={session.id} className="session-card">
            <div className="session-info">
              <h3>Doctor: {session.doctorId}</h3>
              <p>
                {formatDate(session.startTime)} &middot;{" "}
                {formatDuration(session.startTime, session.endTime)}
              </p>
            </div>
            {session.riskAssessment && (
              <span
                className={`risk-badge ${session.riskAssessment.overallRisk}`}
              >
                {session.riskAssessment.overallRisk} risk
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
