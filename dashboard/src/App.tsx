import React from "react";
import { Routes, Route, NavLink } from "react-router-dom";
import OverviewView from "./views/OverviewView";
import ApprovedExportsView from "./views/ApprovedExportsView";

export default function App() {
  return (
    <div className="dashboard-app">
      <header className="dashboard-header">
        <div className="header-brand">
          <div>
            <h1>Doctor Auditor</h1>
            <p>Review operations surface</p>
          </div>
          <span className="header-badge">BEACON</span>
        </div>
        <nav className="header-nav">
          <NavLink to="/" end>
            Overview
          </NavLink>
          <NavLink to="/approved-exports">Exports</NavLink>
        </nav>
      </header>
      <main className="dashboard-content">
        <Routes>
          <Route path="/" element={<OverviewView />} />
          <Route path="/approved-exports" element={<ApprovedExportsView />} />
        </Routes>
      </main>
    </div>
  );
}
