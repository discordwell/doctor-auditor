import type {
  ApprovedExportEnvelope,
  OpsEvent,
} from "@doctor-auditor/shared/cloud";
import type {
  ModelAssistRequest,
  SeriousnessAssessment,
} from "@doctor-auditor/shared/local-review";

interface AuthResponse {
  access_token: string;
}

export class CloudSyncClient {
  private readonly apiBaseUrl: string;
  private readonly email: string;
  private readonly password: string;
  private readonly role: string;
  private readonly organizationId: string;
  private authToken: string | null = null;

  constructor() {
    this.apiBaseUrl =
      process.env.DOCTOR_AUDITOR_API_URL?.replace(/\/$/, "") ??
      "http://127.0.0.1:8000/api";
    this.email =
      process.env.DOCTOR_AUDITOR_API_EMAIL ?? "reviewer@demo-health.local";
    this.password =
      process.env.DOCTOR_AUDITOR_API_PASSWORD ?? "demo-reviewer";
    this.role = process.env.DOCTOR_AUDITOR_API_ROLE ?? "reviewer";
    this.organizationId =
      process.env.DOCTOR_AUDITOR_API_ORG ?? "demo-health";
  }

  async requestSeriousnessAssessment(
    payload: ModelAssistRequest
  ): Promise<SeriousnessAssessment> {
    return this.request<SeriousnessAssessment>(
      "/assist-gateway/seriousness-assessments",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      false
    );
  }

  async postApprovedExport(
    payload: ApprovedExportEnvelope
  ): Promise<ApprovedExportEnvelope> {
    return this.request<ApprovedExportEnvelope>(
      "/approved-exports/",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      true
    );
  }

  async postOpsEvent(payload: OpsEvent): Promise<OpsEvent> {
    return this.request<OpsEvent>(
      "/ops-events/",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      true
    );
  }

  private async request<T>(
    path: string,
    options: RequestInit,
    authenticated: boolean
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((options.headers as Record<string, string> | undefined) ?? {}),
    };

    if (authenticated) {
      await this.ensureToken();
      if (this.authToken) {
        headers.Authorization = `Bearer ${this.authToken}`;
      }
    }

    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: "Cloud sync request failed" }));
      throw new Error(error.detail || `HTTP ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  private async ensureToken(): Promise<void> {
    if (this.authToken) {
      return;
    }

    try {
      const login = await this.request<AuthResponse>(
        "/auth/login",
        {
          method: "POST",
          body: JSON.stringify({
            email: this.email,
            password: this.password,
          }),
        },
        false
      );
      this.authToken = login.access_token;
      return;
    } catch {
      const register = await this.request<AuthResponse>(
        "/auth/register",
        {
          method: "POST",
          body: JSON.stringify({
            email: this.email,
            password: this.password,
            role: this.role,
            organization_id: this.organizationId,
          }),
        },
        false
      );
      this.authToken = register.access_token;
    }
  }
}
