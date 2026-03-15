import type {
  ApprovedExportEnvelope,
  OpsEvent,
} from "@doctor-auditor/shared/cloud";
import type {
  ModelAssistRequest,
  SeriousnessAssessment,
} from "@doctor-auditor/shared/local-review";
import {
  toCloudSyncDisplayConfig,
  type CloudSyncConfig,
  type CloudSyncDisplayConfig,
} from "./cloud-config";

interface AuthResponse {
  access_token: string;
}

export class CloudSyncClient {
  private readonly config: CloudSyncConfig;
  private authToken: string | null = null;

  constructor(config: CloudSyncConfig) {
    this.config = config;
  }

  getConfiguration(): CloudSyncDisplayConfig {
    return toCloudSyncDisplayConfig(this.config);
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

    const response = await fetch(`${this.config.apiBaseUrl}${path}`, {
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
            email: this.config.email,
            password: this.config.password,
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
            email: this.config.email,
            password: this.config.password,
            role: this.config.role,
            organization_id: this.config.organizationId,
          }),
        },
        false
      );
      this.authToken = register.access_token;
    }
  }
}
