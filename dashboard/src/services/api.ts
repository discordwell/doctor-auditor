import type {
  ApprovedExport,
  ApprovedExportEnvelope,
  OpsEvent,
  OpsSummary,
} from "@doctor-auditor/shared/cloud";

const API_BASE = "/api";
const AUTH_STORAGE_KEY = "doctor-auditor.dashboard-auth";
const DEMO_CREDENTIALS = {
  email: "reviewer@demo-health.local",
  password: "demo-reviewer",
  role: "reviewer" as const,
  organization_id: "demo-health",
};
const DEMO_BOOTSTRAP_COOLDOWN_MS = 15_000;
const DEFAULT_BOUNDARY_DETAIL =
  "Dashboard establishes a boundary-safe demo session before loading approved exports and ops events.";

type AuthResponse = {
  access_token: string;
  token_type: string;
  role: string;
  organization_id: string;
};

type StoredAuthSession = AuthResponse & {
  email: string;
};

type DemoSeedResponse = {
  seeded: boolean;
  approvedExports: number;
  opsEvents: number;
};

export type BoundaryStatusTone = "neutral" | "active" | "attention";

export type BoundaryStatusSnapshot = {
  label: string;
  tone: BoundaryStatusTone;
  title: string | null;
  detail: string | null;
};

type DashboardApiErrorKind = "bootstrap" | "auth" | "seed" | "request";

export type DashboardLoadIssue = {
  title: string;
  detail: string;
  tone: BoundaryStatusTone;
};

export class DashboardApiError extends Error {
  kind: DashboardApiErrorKind;

  constructor(kind: DashboardApiErrorKind, message: string) {
    super(message);
    this.name = "DashboardApiError";
    this.kind = kind;
  }
}

let authToken: string | null = null;
let demoBootstrapPromise: Promise<string | null> | null = null;
let demoSeedPromise: Promise<void> | null = null;
let lastBootstrapFailureAt = 0;
let lastBootstrapFailureMessage: string | null = null;
let currentOrganizationId: string | null = null;
let currentEmail: string | null = null;
let demoDatasetReady = false;
let boundaryStatus: BoundaryStatusSnapshot = {
  label: "Demo bootstrap",
  tone: "neutral",
  title: null,
  detail: DEFAULT_BOUNDARY_DETAIL,
};
const boundaryStatusListeners = new Set<
  (snapshot: BoundaryStatusSnapshot) => void
>();

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function setBoundaryStatus(snapshot: BoundaryStatusSnapshot) {
  boundaryStatus = { ...snapshot };
  boundaryStatusListeners.forEach((listener) => {
    listener(boundaryStatus);
  });
}

function updateBoundaryStatusForSession() {
  if (!authToken) {
    setBoundaryStatus({
      label: "Demo bootstrap",
      tone: "neutral",
      title: null,
      detail: DEFAULT_BOUNDARY_DETAIL,
    });
    return;
  }

  const usingDemoDataset =
    currentOrganizationId === DEMO_CREDENTIALS.organization_id &&
    currentEmail === DEMO_CREDENTIALS.email;

  setBoundaryStatus({
    label: usingDemoDataset
      ? demoDatasetReady
        ? "Demo boundary ready"
        : "Demo boundary"
      : "Authenticated boundary",
    tone: "active",
    title: null,
    detail: usingDemoDataset
      ? demoDatasetReady
        ? "Approved exports and safe ops are loading from the demo organization dataset."
        : "Using the demo organization session. The seed dataset will load on the first boundary request."
      : "Using the current organization session for approved exports and safe ops.",
  });
}

function setBoundaryFailure(
  label: string,
  title: string,
  detail: string
) {
  setBoundaryStatus({
    label,
    tone: "attention",
    title,
    detail,
  });
}

function persistSession(session: StoredAuthSession | null) {
  authToken = session?.access_token ?? null;
  currentOrganizationId = session?.organization_id ?? null;
  currentEmail = session?.email ?? null;
  demoDatasetReady = false;
  updateBoundaryStatusForSession();

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
    currentOrganizationId = parsed.organization_id;
    currentEmail = parsed.email;
    updateBoundaryStatusForSession();
  } catch {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    updateBoundaryStatusForSession();
  }
}

async function ensureDemoSession(): Promise<string | null> {
  if (authToken) {
    return authToken;
  }

  if (
    lastBootstrapFailureAt > 0 &&
    Date.now() - lastBootstrapFailureAt < DEMO_BOOTSTRAP_COOLDOWN_MS
  ) {
    setBoundaryFailure(
      "Bootstrap blocked",
      "Demo bootstrap failed",
      lastBootstrapFailureMessage ??
        "Dashboard could not bootstrap the demo organization session."
    );
    return null;
  }

  if (demoBootstrapPromise) {
    return demoBootstrapPromise;
  }

  setBoundaryStatus({
    label: "Bootstrapping",
    tone: "neutral",
    title: null,
    detail:
      "Establishing a demo organization session for approved exports and safe ops.",
  });

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
        lastBootstrapFailureAt = 0;
        lastBootstrapFailureMessage = null;
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
        lastBootstrapFailureAt = 0;
        lastBootstrapFailureMessage = null;
        return registerResponse.access_token;
      }
    } catch (error) {
      lastBootstrapFailureAt = Date.now();
      lastBootstrapFailureMessage =
        error instanceof Error
          ? error.message
          : "Dashboard could not bootstrap the demo session.";
      persistSession(null);
      setBoundaryFailure(
        "Bootstrap blocked",
        "Demo bootstrap failed",
        lastBootstrapFailureMessage
      );
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
  currentOrganizationId = null;
  currentEmail = null;
  demoDatasetReady = false;
  lastBootstrapFailureMessage = null;
  setBoundaryStatus({
    label: "Authenticated boundary",
    tone: "active",
    title: null,
    detail: "Using an injected dashboard session for approved exports and safe ops.",
  });
}

function shouldSeedDemoDataset(): boolean {
  return (
    authToken !== null &&
    currentOrganizationId === DEMO_CREDENTIALS.organization_id &&
    currentEmail === DEMO_CREDENTIALS.email
  );
}

async function ensureDemoDataset(): Promise<void> {
  if (!shouldSeedDemoDataset() || demoDatasetReady) {
    return;
  }

  if (demoSeedPromise) {
    return demoSeedPromise;
  }

  setBoundaryStatus({
    label: "Seeding demo data",
    tone: "neutral",
    title: null,
    detail: "Loading approved exports and safe ops demo data for the dashboard.",
  });

  demoSeedPromise = request<DemoSeedResponse>(
    "/demo/seed",
    {
      method: "POST",
    },
    true,
    false
  )
    .then(() => {
      demoDatasetReady = true;
      updateBoundaryStatusForSession();
    })
    .catch((error) => {
      const message =
        error instanceof Error
          ? error.message
          : "Dashboard could not prepare the demo dataset.";

      if (error instanceof DashboardApiError && error.kind === "auth") {
        setBoundaryFailure("Auth blocked", "Session refresh failed", message);
        throw error;
      }

      setBoundaryFailure("Seed blocked", "Demo dataset unavailable", message);
      throw new DashboardApiError("seed", message);
    })
    .finally(() => {
      demoSeedPromise = null;
    });

  return demoSeedPromise;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  allowRetry = true,
  ensureSeed = true
): Promise<T> {
  if (!path.startsWith("/auth/") && !authToken) {
    await ensureDemoSession();
    if (!authToken) {
      throw new DashboardApiError(
        "bootstrap",
        lastBootstrapFailureMessage ??
          "Dashboard could not bootstrap the demo organization session."
      );
    }
  }

  if (!path.startsWith("/auth/") && ensureSeed && path !== "/demo/seed") {
    await ensureDemoDataset();
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) ?? {}),
  };

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  let response: Response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });
  } catch (error) {
    throw new DashboardApiError(
      "request",
      error instanceof Error ? error.message : "Request failed"
    );
  }

  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth/") && allowRetry) {
      persistSession(null);
      setBoundaryStatus({
        label: "Refreshing session",
        tone: "neutral",
        title: null,
        detail:
          "Refreshing the dashboard session before retrying the approved export or ops request.",
      });
      await ensureDemoSession();
      if (authToken) {
        return request<T>(path, options, false, ensureSeed);
      }
      const message =
        lastBootstrapFailureMessage ??
        "Dashboard could not refresh the demo organization session.";
      setBoundaryFailure("Auth blocked", "Session refresh failed", message);
      throw new DashboardApiError("auth", message);
    }

    const error = await response.json().catch(() => ({ detail: "Request failed" }));
    throw new DashboardApiError(
      "request",
      error.detail || `HTTP ${response.status}`
    );
  }

  return response.json();
}

function buildQuery(params: Record<string, string | undefined | null>): string {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      searchParams.set(key, value);
    }
  });

  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

export type {
  ApprovedExport,
  ApprovedExportEnvelope,
  OpsEvent,
  OpsSummary,
};

export function getBoundaryStatusSnapshot(): BoundaryStatusSnapshot {
  return { ...boundaryStatus };
}

export function subscribeToBoundaryStatus(
  listener: (snapshot: BoundaryStatusSnapshot) => void
): () => void {
  boundaryStatusListeners.add(listener);
  return () => {
    boundaryStatusListeners.delete(listener);
  };
}

export function describeDashboardLoadIssue(
  error: unknown
): DashboardLoadIssue {
  if (error instanceof DashboardApiError) {
    if (error.kind === "bootstrap") {
      return {
        title: "Demo bootstrap failed",
        detail: error.message,
        tone: "attention",
      };
    }

    if (error.kind === "auth") {
      return {
        title: "Dashboard authentication failed",
        detail: error.message,
        tone: "attention",
      };
    }

    if (error.kind === "seed") {
      return {
        title: "Demo dataset unavailable",
        detail: error.message,
        tone: "attention",
      };
    }
  }

  if (error instanceof Error) {
    return {
      title: "Boundary request failed",
      detail: error.message,
      tone: "attention",
    };
  }

  return {
    title: "Boundary request failed",
    detail:
      "Dashboard could not load approved exports and safe ops from the cloud boundary.",
    tone: "attention",
  };
}

export const api = {
  getApprovedExports: (params?: {
    exportStatus?: string;
    clinicianId?: string;
  }) =>
    request<ApprovedExportEnvelope[]>(
      `/approved-exports/${buildQuery({
        export_status: params?.exportStatus,
        clinician_id: params?.clinicianId,
      })}`
    ),
  releaseApprovedExport: (exportId: string) =>
    request<ApprovedExportEnvelope>(`/approved-exports/${exportId}/release`, {
      method: "POST",
    }),
  getOpsEvents: (params?: {
    localSessionId?: string;
    eventType?: string;
  }) =>
    request<OpsEvent[]>(
      `/ops-events/${buildQuery({
        local_session_id: params?.localSessionId,
        event_type: params?.eventType,
      })}`
    ),
  getOpsSummary: () => request<OpsSummary>("/ops-events/summary"),
  login: (email: string, password: string) =>
    request<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
};
