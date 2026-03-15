import React from "react";
import { Routes, Route, NavLink } from "react-router-dom";
import OverviewView from "./views/OverviewView";
import DoctorsView from "./views/DoctorsView";
import AssessmentsView from "./views/AssessmentsView";

export default function App() {
  return (
    <div className="dashboard-app">
      <header className="dashboard-header">
        <div className="header-brand">
          <div>
            <h1>Doctor Auditor</h1>
            <p>Review operations overview</p>
          </div>
          <span className="header-badge">BEACON</span>
        </div>
        <nav className="header-nav">
          <NavLink to="/" end>
            Overview
          </NavLink>
          <NavLink to="/doctors">Doctors</NavLink>
          <NavLink to="/assessments">Assessments</NavLink>
        </nav>
      </header>
      <main className="dashboard-content">
        <Routes>
          <Route path="/" element={<OverviewView />} />
          <Route path="/doctors" element={<DoctorsView />} />
          <Route path="/assessments" element={<AssessmentsView />} />
        </Routes>
      </main>
    </div>
  );
}
