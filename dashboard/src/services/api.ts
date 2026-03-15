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

let authToken: string | null = null;
let demoBootstrapPromise: Promise<string | null> | null = null;
let demoSeedPromise: Promise<void> | null = null;
let lastBootstrapFailureAt = 0;
let currentOrganizationId: string | null = null;
let currentEmail: string | null = null;
let demoDatasetReady = false;

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function persistSession(session: StoredAuthSession | null) {
  authToken = session?.access_token ?? null;
  currentOrganizationId = session?.organization_id ?? null;
  currentEmail = session?.email ?? null;
  demoDatasetReady = false;

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
  } catch {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
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
    return null;
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
        lastBootstrapFailureAt = 0;
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
        return registerResponse.access_token;
      }
    } catch {
      lastBootstrapFailureAt = Date.now();
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
  currentOrganizationId = null;
  currentEmail = null;
  demoDatasetReady = false;
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

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth/") && allowRetry) {
      persistSession(null);
      await ensureDemoSession();
      if (authToken) {
        return request<T>(path, options, false, ensureSeed);
      }
    }

    const error = await response.json().catch(() => ({ detail: "Request failed" }));
    throw new Error(error.detail || `HTTP ${response.status}`);
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
