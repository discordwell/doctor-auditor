import React, { useEffect, useState } from "react";
import { Routes, Route, NavLink } from "react-router-dom";
import {
  getBoundaryStatusSnapshot,
  subscribeToBoundaryStatus,
} from "./services/api";
import OverviewView from "./views/OverviewView";
import ApprovedExportsView from "./views/ApprovedExportsView";

export default function App() {
  const [boundaryStatus, setBoundaryStatus] = useState(() =>
    getBoundaryStatusSnapshot()
  );

  useEffect(() => {
    return subscribeToBoundaryStatus((snapshot) => {
      setBoundaryStatus(snapshot);
    });
  }, []);

  return (
    <div className="dashboard-app">
      <header className="dashboard-header">
        <div className="header-brand">
          <div>
            <h1>Doctor Auditor</h1>
            <p>Approved export and ops boundary</p>
          </div>
          <span className={`header-badge ${boundaryStatus.tone}`}>
            {boundaryStatus.label}
          </span>
        </div>
        <nav className="header-nav">
          <NavLink to="/" end>
            Overview
          </NavLink>
          <NavLink to="/approved-exports">Exports</NavLink>
        </nav>
      </header>
      {boundaryStatus.tone === "attention" ? (
        <div className="boundary-banner-shell">
          <div className={`boundary-banner ${boundaryStatus.tone}`}>
            <strong>{boundaryStatus.title ?? "Boundary attention required"}</strong>
            {boundaryStatus.detail ? <p>{boundaryStatus.detail}</p> : null}
          </div>
        </div>
      ) : null}
      <main className="dashboard-content">
        <Routes>
          <Route path="/" element={<OverviewView />} />
          <Route path="/approved-exports" element={<ApprovedExportsView />} />
        </Routes>
      </main>
    </div>
  );
}
