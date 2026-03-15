const API_BASE = "/api";
const AUTH_STORAGE_KEY = "doctor-auditor.dashboard-auth";
const DEMO_CREDENTIALS = {
  email: "reviewer@demo-health.local",
  password: "demo-reviewer",
  role: "reviewer" as const,
  organization_id: "demo-health",
};

type AuthResponse = {
  access_token: string;
  token_type: string;
  role: string;
  organization_id: string;
};

type StoredAuthSession = AuthResponse & {
  email: string;
};

let authToken: string | null = null;
let demoBootstrapPromise: Promise<string | null> | null = null;

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function persistSession(session: StoredAuthSession | null) {
  authToken = session?.access_token ?? null;

  if (!canUseStorage()) {
    return;
  }

  if (session) {
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
    return;
  }

  window.localStorage.removeItem(AUTH_STORAGE_KEY);
}

function restoreStoredToken() {
  if (!canUseStorage()) {
    return;
  }

  const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) {
    return;
  }

  try {
    const parsed = JSON.parse(raw) as StoredAuthSession;
    authToken = parsed.access_token;
  } catch {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
  }
}

async function ensureDemoSession(): Promise<string | null> {
  if (authToken) {
    return authToken;
  }

  if (demoBootstrapPromise) {
    return demoBootstrapPromise;
  }

  demoBootstrapPromise = (async () => {
    try {
      try {
        const loginResponse = await request<AuthResponse>(
          "/auth/login",
          {
            method: "POST",
            body: JSON.stringify({
              email: DEMO_CREDENTIALS.email,
              password: DEMO_CREDENTIALS.password,
            }),
          },
          false
        );

        persistSession({
          ...loginResponse,
          email: DEMO_CREDENTIALS.email,
        });
        return loginResponse.access_token;
      } catch {
        const registerResponse = await request<AuthResponse>(
          "/auth/register",
          {
            method: "POST",
            body: JSON.stringify(DEMO_CREDENTIALS),
          },
          false
        );

        persistSession({
          ...registerResponse,
          email: DEMO_CREDENTIALS.email,
        });
        return registerResponse.access_token;
      }
    } catch {
      persistSession(null);
      return null;
    } finally {
      demoBootstrapPromise = null;
    }
  })();

  return demoBootstrapPromise;
}

restoreStoredToken();

export function setToken(token: string) {
  authToken = token;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  allowRetry = true
): Promise<T> {
  if (!path.startsWith("/auth/") && !authToken) {
    await ensureDemoSession();
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) ?? {}),
  };

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth/") && allowRetry) {
      persistSession(null);
      await ensureDemoSession();
      if (authToken) {
        return request<T>(path, options, false);
      }
    }

    const error = await response.json().catch(() => ({ detail: "Request failed" }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

function buildQuery(
  params: Record<string, string | undefined | null>
): string {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      searchParams.set(key, value);
    }
  });

  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

export type ReviewStatus =
  | "not_started"
  | "ready"
  | "in_review"
  | "completed";

export type ExportStatus =
  | "not_requested"
  | "draft"
  | "approved"
  | "sent";

export type FindingStatus =
  | "draft"
  | "pending_review"
  | "accepted"
  | "rejected"
  | "uncertain"
  | "revised";

export interface SessionConsent {
  recordedWithConsent: boolean;
  exportAllowed: boolean;
  capturedAt?: string;
  capturedBy?: string;
}

export interface ReviewSession {
  id: string;
  clinicianId: string;
  organizationId?: string;
  encounterStartedAt: string;
  encounterEndedAt?: string;
  captureMode: "audio_import" | "live_capture" | "manual_entry";
  transcriptStatus: "not_started" | "in_progress" | "completed" | "failed";
  reviewStatus: ReviewStatus;
  exportStatus: ExportStatus;
  createdAt: string;
  updatedAt: string;
  consent: SessionConsent;
}

export interface EvidenceSpan {
  id: string;
  transcriptSegmentId: string;
  excerpt: string;
  startOffsetMs: number;
  endOffsetMs: number;
  startTextOffset?: number;
  endTextOffset?: number;
}

export interface Finding {
  id: string;
  sessionId: string;
  code: string;
  title: string;
  summary: string;
  status: FindingStatus;
  confidence: number;
  evidenceSpans: EvidenceSpan[];
  detectedBy: "rules" | "local_llm" | "cloud_llm" | "human";
  createdAt: string;
  updatedAt: string;
  reviewDecisionId?: string;
}

export interface ApprovedEvidenceExcerpt {
  sourceEvidenceSpanId: string;
  sourceTranscriptSegmentId: string;
  excerpt: string;
  startOffsetMs: number;
  endOffsetMs: number;
}

export interface ApprovedExportFinding {
  findingId: string;
  code: string;
  title: string;
  summary: string;
  reviewDecisionId: string;
  evidenceExcerpts: ApprovedEvidenceExcerpt[];
}

export interface ApprovedExport {
  id: string;
  sessionId: string;
  status: "draft" | "approved" | "sent";
  summary: string;
  findings: ApprovedExportFinding[];
  approvedBy: string;
  approvedAt: string;
  destination?: string;
  sentAt?: string;
}

export interface ReviewDecisionCreateRequest {
  outcome: "accepted" | "rejected" | "uncertain" | "edited";
  reviewedBy: string;
  rationale?: string;
  editedTitle?: string;
  editedSummary?: string;
  approvedEvidenceSpans?: EvidenceSpan[];
}

export const api = {
  getSessions: (params?: {
    reviewStatus?: string;
    exportStatus?: string;
    clinicianId?: string;
  }) =>
    request<ReviewSession[]>(
      `/sessions/${buildQuery({
        review_status: params?.reviewStatus,
        export_status: params?.exportStatus,
        clinician_id: params?.clinicianId,
      })}`
    ),
  getFindings: (params?: { sessionId?: string; status?: string }) =>
    request<Finding[]>(
      `/findings/${buildQuery({
        session_id: params?.sessionId,
        status: params?.status,
      })}`
    ),
  createReviewDecision: (
    findingId: string,
    payload: ReviewDecisionCreateRequest
  ) =>
    request(`/findings/${findingId}/review-decisions`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getApprovedExports: (params?: {
    sessionId?: string;
    exportStatus?: string;
  }) =>
    request<ApprovedExport[]>(
      `/approved-exports/${buildQuery({
        session_id: params?.sessionId,
        export_status: params?.exportStatus,
      })}`
    ),
  login: (email: string, password: string) =>
    request<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
};
