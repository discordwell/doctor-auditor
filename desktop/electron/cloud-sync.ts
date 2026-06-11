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

interface AttemptResult {
  response: Response;
  tokenUsed: string | null;
}

export class CloudSyncClient {
  private readonly config: CloudSyncConfig;
  private authToken: string | null = null;
  private pendingAuth: Promise<void> | null = null;

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
      }
    );
  }

  async postApprovedExport(
    payload: ApprovedExportEnvelope
  ): Promise<ApprovedExportEnvelope> {
    return this.request<ApprovedExportEnvelope>("/approved-exports/", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async postOpsEvent(payload: OpsEvent): Promise<OpsEvent> {
    return this.request<OpsEvent>("/ops-events/", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  // Requests authenticate unless a call site explicitly opts out; only the
  // login/register calls inside authenticate() do.
  private async request<T>(
    path: string,
    options: RequestInit,
    authenticated = true
  ): Promise<T> {
    let attempt = await this.sendRequest(path, options, authenticated);

    if (authenticated && attempt.response.status === 401) {
      // The cached token can expire during a long-running desktop session;
      // drain the rejected response so its connection can be reused, drop the
      // token (unless a concurrent request already refreshed it), and retry
      // once with fresh credentials.
      await attempt.response.arrayBuffer().catch(() => undefined);
      if (this.authToken === attempt.tokenUsed) {
        this.authToken = null;
      }
      attempt = await this.sendRequest(path, options, authenticated);
    }

    const response = attempt.response;
    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: "Cloud sync request failed" }));
      throw new Error(error?.detail || `HTTP ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  private async sendRequest(
    path: string,
    options: RequestInit,
    authenticated: boolean
  ): Promise<AttemptResult> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((options.headers as Record<string, string> | undefined) ?? {}),
    };

    let tokenUsed: string | null = null;
    if (authenticated) {
      await this.ensureToken();
      if (this.authToken) {
        tokenUsed = this.authToken;
        headers.Authorization = `Bearer ${tokenUsed}`;
      }
    }

    const response = await fetch(`${this.config.apiBaseUrl}${path}`, {
      ...options,
      headers,
    });
    return { response, tokenUsed };
  }

  private async ensureToken(): Promise<void> {
    if (this.authToken) {
      return;
    }

    // Single-flight: concurrent requests share one login instead of each
    // issuing their own.
    if (!this.pendingAuth) {
      this.pendingAuth = this.authenticate().finally(() => {
        this.pendingAuth = null;
      });
    }
    return this.pendingAuth;
  }

  private async authenticate(): Promise<void> {
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
      this.setAuthToken(login.access_token);
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
      this.setAuthToken(register.access_token);
    }
  }

  private setAuthToken(token: string | undefined): void {
    if (!token) {
      throw new Error("Cloud auth response did not include an access token");
    }
    this.authToken = token;
  }
}
