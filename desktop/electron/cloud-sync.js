"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CloudSyncClient = void 0;
class CloudSyncClient {
    apiBaseUrl;
    email;
    password;
    role;
    organizationId;
    authToken = null;
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
    async requestSeriousnessAssessment(payload) {
        return this.request("/assist-gateway/seriousness-assessments", {
            method: "POST",
            body: JSON.stringify(payload),
        }, false);
    }
    async postApprovedExport(payload) {
        return this.request("/approved-exports/", {
            method: "POST",
            body: JSON.stringify(payload),
        }, true);
    }
    async postOpsEvent(payload) {
        return this.request("/ops-events/", {
            method: "POST",
            body: JSON.stringify(payload),
        }, true);
    }
    async request(path, options, authenticated) {
        const headers = {
            "Content-Type": "application/json",
            ...(options.headers ?? {}),
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
        return response.json();
    }
    async ensureToken() {
        if (this.authToken) {
            return;
        }
        try {
            const login = await this.request("/auth/login", {
                method: "POST",
                body: JSON.stringify({
                    email: this.email,
                    password: this.password,
                }),
            }, false);
            this.authToken = login.access_token;
            return;
        }
        catch {
            const register = await this.request("/auth/register", {
                method: "POST",
                body: JSON.stringify({
                    email: this.email,
                    password: this.password,
                    role: this.role,
                    organization_id: this.organizationId,
                }),
            }, false);
            this.authToken = register.access_token;
        }
    }
}
exports.CloudSyncClient = CloudSyncClient;
