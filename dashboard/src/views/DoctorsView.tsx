import React, { useState, useEffect } from "react";
import { api, DoctorSummary } from "../services/api";

export default function DoctorsView() {
  const [doctors, setDoctors] = useState<DoctorSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getDoctors()
      .then(setDoctors)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="empty-state">Loading...</div>;

  if (doctors.length === 0) {
    return (
      <div>
        <h2>Doctors</h2>
        <div className="empty-state">
          No doctor data received yet. Risk assessments will appear here as
          desktop clients submit de-identified data.
        </div>
      </div>
    );
  }

  const getRiskClass = (score: number | null): string => {
    if (score === null) return "";
    if (score >= 7) return "high";
    if (score >= 4) return "medium";
    return "low";
  };

  return (
    <div>
      <h2>Doctors</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Doctor ID</th>
            <th>Specialty</th>
            <th>Sessions</th>
            <th>Avg Score</th>
            <th>Latest Risk</th>
          </tr>
        </thead>
        <tbody>
          {doctors.map((doctor) => (
            <tr key={doctor.id}>
              <td>{doctor.id}</td>
              <td>{doctor.specialty ?? "—"}</td>
              <td>{doctor.total_sessions}</td>
              <td>
                {doctor.avg_overall_score ?? "—"}
                {doctor.avg_overall_score !== null && (
                  <span className="score-bar">
                    <span
                      className={`score-bar-fill ${getRiskClass(doctor.avg_overall_score)}`}
                      style={{
                        width: `${(doctor.avg_overall_score / 10) * 100}%`,
                      }}
                    />
                  </span>
                )}
              </td>
              <td>
                {doctor.latest_risk ? (
                  <span className={`risk-badge ${doctor.latest_risk}`}>
                    {doctor.latest_risk}
                  </span>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
