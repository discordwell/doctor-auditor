import { describe, expect, it } from "vitest";

import {
  DashboardApiError,
  describeDashboardLoadIssue,
  getBoundaryStatusSnapshot,
} from "./api";

describe("api boundary helpers", () => {
  it("starts in demo bootstrap mode before requests run", () => {
    expect(getBoundaryStatusSnapshot()).toMatchObject({
      label: "Demo bootstrap",
      tone: "neutral",
    });
  });

  it("classifies bootstrap, auth, and seed failures for the dashboard UI", () => {
    expect(
      describeDashboardLoadIssue(
        new DashboardApiError("bootstrap", "Bootstrap could not reach auth.")
      )
    ).toEqual({
      title: "Demo bootstrap failed",
      detail: "Bootstrap could not reach auth.",
      tone: "attention",
    });

    expect(
      describeDashboardLoadIssue(
        new DashboardApiError("auth", "Session refresh was rejected.")
      )
    ).toEqual({
      title: "Dashboard authentication failed",
      detail: "Session refresh was rejected.",
      tone: "attention",
    });

    expect(
      describeDashboardLoadIssue(
        new DashboardApiError("seed", "Demo seed did not complete.")
      )
    ).toEqual({
      title: "Demo dataset unavailable",
      detail: "Demo seed did not complete.",
      tone: "attention",
    });
  });
});
