import React, { lazy, Suspense, useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";

import {
  getBoundaryStatusSnapshot,
  subscribeToBoundaryStatus,
  type BoundaryStatusSnapshot,
} from "./services/api";
const OverviewView = lazy(() => import("./views/OverviewView"));
const ApprovedExportsView = lazy(() => import("./views/ApprovedExportsView"));
const OperationsView = lazy(() => import("./views/OperationsView"));

type DashboardStatus = {
  label: string;
  detail: string | null;
  tone: BoundaryStatusSnapshot["tone"];
};

function mapDashboardStatus(snapshot: BoundaryStatusSnapshot): DashboardStatus {
  if (snapshot.tone === "attention") {
    return {
      label: "Action required",
      detail:
        snapshot.detail ??
        "The dashboard session needs attention before data can load.",
      tone: snapshot.tone,
    };
  }

  if (snapshot.tone === "active") {
    return {
      label: "Connected",
      detail: null,
      tone: snapshot.tone,
    };
  }

  return {
    label: "Connecting",
    detail: null,
    tone: snapshot.tone,
  };
}

export default function App() {
  const [boundaryStatus, setBoundaryStatus] = useState(() =>
    getBoundaryStatusSnapshot()
  );

  useEffect(() => {
    return subscribeToBoundaryStatus((snapshot) => {
      setBoundaryStatus(snapshot);
    });
  }, []);

  const status = mapDashboardStatus(boundaryStatus);

  return (
    <div className="dashboard-app">
      <header className="dashboard-header">
        <div className="header-brand">
          <div className="brand-mark">DA</div>
          <div>
            <h1>Doctor Auditor</h1>
            <p>Operations dashboard</p>
          </div>
        </div>
        <div className="header-controls">
          <nav className="header-nav">
            <NavLink to="/" end>
              Overview
            </NavLink>
            <NavLink to="/approved-exports">Exports</NavLink>
            <NavLink to="/operations">Operations</NavLink>
          </nav>
          <div className={`system-pill ${status.tone}`}>
            <span className="system-pill__dot" />
            <span>{status.label}</span>
          </div>
        </div>
      </header>

      {status.detail ? (
        <div className="status-banner-shell">
          <section className={`status-banner ${status.tone}`}>
            <strong>{status.label}</strong>
            <p>{status.detail}</p>
          </section>
        </div>
      ) : null}

      <main className="dashboard-content">
        <Suspense fallback={<div className="empty-state">Loading view...</div>}>
          <Routes>
            <Route path="/" element={<OverviewView />} />
            <Route path="/approved-exports" element={<ApprovedExportsView />} />
            <Route path="/operations" element={<OperationsView />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}
