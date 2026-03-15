import React, { useState } from "react";
import RecordingView from "./views/RecordingView";
import HistoryView from "./views/HistoryView";
import SettingsView from "./views/SettingsView";

type View = "recording" | "history" | "settings";

export default function App() {
  const [currentView, setCurrentView] = useState<View>("recording");

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="logo">
          <h1>Doctor Auditor</h1>
          <span className="badge">LOCAL</span>
        </div>
        <ul className="nav-items">
          <li
            className={currentView === "recording" ? "active" : ""}
            onClick={() => setCurrentView("recording")}
          >
            <span className="nav-icon">&#9679;</span>
            Recording
          </li>
          <li
            className={currentView === "history" ? "active" : ""}
            onClick={() => setCurrentView("history")}
          >
            <span className="nav-icon">&#9776;</span>
            History
          </li>
          <li
            className={currentView === "settings" ? "active" : ""}
            onClick={() => setCurrentView("settings")}
          >
            <span className="nav-icon">&#9881;</span>
            Settings
          </li>
        </ul>
        <div className="privacy-indicator">
          <span className="privacy-dot" />
          HIPAA Compliant — Data Stays Local
        </div>
      </nav>
      <main className="content">
        {currentView === "recording" && <RecordingView />}
        {currentView === "history" && <HistoryView />}
        {currentView === "settings" && <SettingsView />}
      </main>
    </div>
  );
}
