import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelAssistRequest } from "@doctor-auditor/shared/local-review";
import { CloudSyncClient } from "./cloud-sync";
import { resolveCloudSyncConfig } from "./cloud-config";

const TEST_CONFIG = resolveCloudSyncConfig({
  env: { DOCTOR_AUDITOR_API_URL: "https://cloud.test/api" },
});

const ASSIST_REQUEST = {
  id: "assist-request-001",
  sessionId: "session-local-001",
  findingId: "finding-local-001",
  requestedBy: "desktop",
  requestedAt: "2026-03-15T10:28:30Z",
  policyVersion: "policy-v1",
  policyMode: "minimized_no_raw_phi",
  concern: {
    findingCode: "medication-risk",
    findingStatus: "accepted",
    findingConfidence: 0.82,
    evidenceSpanCount: 1,
    speakerLabels: ["clinician", "patient"],
    captureMode: "audio_import",
    encounterDurationMs: 1320000,
  },
} as ModelAssistRequest;

const ASSESSMENT_RESPONSE = {
  disposition: "routine_review",
  confidence: 0.4,
  rationale: "The minimized packet supports routine review.",
  limitations: [],
  provider: "openai",
  model: "gpt-5.4-test",
  assessedAt: "2026-03-15T10:29:00Z",
};

interface RecordedCall {
  path: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

interface StubResponse {
  status: number;
  body: unknown;
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

// Installs a fetch stub that records every call and answers via the route
// handler, which receives the recorded call (path, headers, body) and the
// per-path invocation count.
function stubFetch(
  calls: RecordedCall[],
  routes: (call: RecordedCall, pathCallCount: number) => StubResponse
) {
  const pathCounts = new Map<string, number>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init: RequestInit) => {
      const url = new URL(String(input));
      const call: RecordedCall = {
        path: url.pathname,
        method: init.method ?? "GET",
        headers: (init.headers as Record<string, string>) ?? {},
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      const count = (pathCounts.get(call.path) ?? 0) + 1;
      pathCounts.set(call.path, count);
      const { status, body } = routes(call, count);
      return jsonResponse(status, body);
    })
  );
}

describe("CloudSyncClient", () => {
  let calls: RecordedCall[];

  beforeEach(() => {
    calls = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("authenticates before requesting a seriousness assessment", async () => {
    stubFetch(calls, (call) => {
      if (call.path === "/api/auth/login") {
        return { status: 200, body: { access_token: "token-1" } };
      }
      return { status: 200, body: ASSESSMENT_RESPONSE };
    });

    const client = new CloudSyncClient(TEST_CONFIG);
    const assessment = await client.requestSeriousnessAssessment(ASSIST_REQUEST);

    expect(assessment.disposition).toBe("routine_review");
    expect(calls.map((call) => call.path)).toEqual([
      "/api/auth/login",
      "/api/assist-gateway/seriousness-assessments",
    ]);
    expect(calls[1].headers.Authorization).toBe("Bearer token-1");
  });

  it("re-authenticates once and retries when the cached token is rejected", async () => {
    stubFetch(calls, (call, count) => {
      if (call.path === "/api/auth/login") {
        return { status: 200, body: { access_token: `token-${count}` } };
      }
      if (call.headers.Authorization === "Bearer token-1") {
        return { status: 401, body: { detail: "Invalid or expired token" } };
      }
      return { status: 200, body: ASSESSMENT_RESPONSE };
    });

    const client = new CloudSyncClient(TEST_CONFIG);
    const assessment = await client.requestSeriousnessAssessment(ASSIST_REQUEST);

    expect(assessment.disposition).toBe("routine_review");
    expect(calls.map((call) => call.path)).toEqual([
      "/api/auth/login",
      "/api/assist-gateway/seriousness-assessments",
      "/api/auth/login",
      "/api/assist-gateway/seriousness-assessments",
    ]);
    expect(calls[3].headers.Authorization).toBe("Bearer token-2");
  });

  it("surfaces the server error when the retried request still fails", async () => {
    stubFetch(calls, (call) => {
      if (call.path === "/api/auth/login") {
        return { status: 200, body: { access_token: "token-1" } };
      }
      return { status: 401, body: { detail: "Invalid or expired token" } };
    });

    const client = new CloudSyncClient(TEST_CONFIG);

    await expect(
      client.requestSeriousnessAssessment(ASSIST_REQUEST)
    ).rejects.toThrow("Invalid or expired token");
    // One login + one attempt, one re-login + one retry — never more.
    expect(calls).toHaveLength(4);
  });

  it("falls back to registration when login fails", async () => {
    stubFetch(calls, (call) => {
      if (call.path === "/api/auth/login") {
        return { status: 401, body: { detail: "Invalid credentials" } };
      }
      if (call.path === "/api/auth/register") {
        return { status: 200, body: { access_token: "registered-token" } };
      }
      return { status: 200, body: ASSESSMENT_RESPONSE };
    });

    const client = new CloudSyncClient(TEST_CONFIG);
    await client.requestSeriousnessAssessment(ASSIST_REQUEST);

    expect(calls.map((call) => call.path)).toEqual([
      "/api/auth/login",
      "/api/auth/register",
      "/api/assist-gateway/seriousness-assessments",
    ]);
    expect(calls[1].body).toMatchObject({
      email: TEST_CONFIG.email,
      role: TEST_CONFIG.role,
      organization_id: TEST_CONFIG.organizationId,
    });
    expect(calls[2].headers.Authorization).toBe("Bearer registered-token");
  });

  it("shares a single login between concurrent authenticated requests", async () => {
    stubFetch(calls, (call) => {
      if (call.path === "/api/auth/login") {
        return { status: 200, body: { access_token: "token-1" } };
      }
      return { status: 200, body: ASSESSMENT_RESPONSE };
    });

    const client = new CloudSyncClient(TEST_CONFIG);
    await Promise.all([
      client.requestSeriousnessAssessment(ASSIST_REQUEST),
      client.requestSeriousnessAssessment(ASSIST_REQUEST),
    ]);

    const loginCalls = calls.filter((call) => call.path === "/api/auth/login");
    expect(loginCalls).toHaveLength(1);
    expect(calls).toHaveLength(3);
  });

  it("rejects an auth response that lacks an access token", async () => {
    stubFetch(calls, (call) => {
      if (
        call.path === "/api/auth/login" ||
        call.path === "/api/auth/register"
      ) {
        return { status: 200, body: {} };
      }
      return { status: 200, body: ASSESSMENT_RESPONSE };
    });

    const client = new CloudSyncClient(TEST_CONFIG);

    await expect(
      client.requestSeriousnessAssessment(ASSIST_REQUEST)
    ).rejects.toThrow("Cloud auth response did not include an access token");
    // Login (missing token) then the register fallback (missing token) —
    // the data request itself must never have been sent without auth.
    expect(calls.map((call) => call.path)).toEqual([
      "/api/auth/login",
      "/api/auth/register",
    ]);
  });
});
