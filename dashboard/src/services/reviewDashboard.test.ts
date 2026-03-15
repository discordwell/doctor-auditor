import { describe, expect, it } from "vitest";

import {
  buildOverviewModel,
  formatStatusLabel,
  getExportTone,
  getFindingTone,
  getSessionStatusTone,
  previewReviewSnapshot,
  sortApprovedExports,
  sortFindings,
  sortSessions,
} from "./reviewDashboard";

describe("reviewDashboard helpers", () => {
  it("builds stable overview metrics from the preview snapshot", () => {
    const model = buildOverviewModel(
      previewReviewSnapshot,
      new Date("2026-03-15T12:00:00Z")
    );

    expect(model.sessionsInScope).toBe(4);
    expect(model.openFindings).toBe(4);
    expect(model.reviewedFindings).toBe(2);
    expect(model.approvedExportCount).toBe(2);
    expect(model.agingItems).toBe(1);
    expect(model.queueLanes.map((lane) => lane.count)).toEqual([2, 2, 2]);
    expect(model.weeklyActivity).toHaveLength(6);
  });

  it("sorts and filters sessions by review status", () => {
    const sessions = sortSessions(previewReviewSnapshot.sessions, "completed");

    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.id).toBe("session-preview-004");
    expect(sessions[1]?.id).toBe("session-preview-002");
  });

  it("orders findings by queue priority before timestamp", () => {
    const findings = sortFindings(previewReviewSnapshot.findings);

    expect(findings[0]?.status).toBe("pending_review");
    expect(findings[1]?.status).toBe("draft");
    expect(findings[findings.length - 1]?.status).toBe("accepted");
  });

  it("sorts approved exports newest first", () => {
    const approvedExports = sortApprovedExports(
      previewReviewSnapshot.approvedExports
    );

    expect(approvedExports[0]?.id).toBe("export-preview-002");
    expect(approvedExports[2]?.id).toBe("export-preview-001");
  });

  it("normalizes labels and tones consistently", () => {
    expect(formatStatusLabel("pending_review")).toBe("pending review");
    expect(getSessionStatusTone("in_review")).toBe("active");
    expect(getFindingTone("accepted")).toBe("success");
    expect(getExportTone("approved")).toBe("attention");
  });
});
