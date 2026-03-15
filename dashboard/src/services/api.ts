const API_BASE = "/api";

let authToken: string | null = null;

export function setToken(token: string) {
  authToken = token;
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) ?? {}),
  };

  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Request failed" }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

export interface OverviewStats {
  total_sessions: number;
  high_risk_count: number;
  medium_risk_count: number;
  low_risk_count: number;
  avg_communication: number | null;
  avg_clinical: number | null;
  avg_behavioral: number | null;
  avg_overall: number | null;
}

export interface TrendPoint {
  period: string;
  avg_communication: number;
  avg_clinical: number;
  avg_behavioral: number;
  avg_overall: number;
  session_count: number;
}

export interface DoctorSummary {
  id: string;
  specialty: string | null;
  department_id: string | null;
  organization_id: string;
  total_sessions: number;
  avg_overall_score: number | null;
  latest_risk: string | null;
}

export interface Assessment {
  id: string;
  session_id: string;
  doctor_id: string;
  timestamp: string;
  duration: number;
  communication_score: number;
  communication_flags: string[];
  clinical_score: number;
  clinical_flags: string[];
  behavioral_score: number;
  behavioral_flags: string[];
  overall_score: number;
  overall_risk: string;
  analysis_source: string;
}

export const api = {
  getOverview: () => request<OverviewStats>("/dashboard/overview"),
  getTrends: (doctorId?: string) =>
    request<TrendPoint[]>(
      `/dashboard/trends${doctorId ? `?doctor_id=${doctorId}` : ""}`
    ),
  getDoctors: () => request<DoctorSummary[]>("/doctors/"),
  getAssessments: (params?: { doctor_id?: string; risk_level?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.doctor_id) searchParams.set("doctor_id", params.doctor_id);
    if (params?.risk_level) searchParams.set("risk_level", params.risk_level);
    const qs = searchParams.toString();
    return request<Assessment[]>(`/assessments/${qs ? `?${qs}` : ""}`);
  },
  login: (email: string, password: string) =>
    request<{ access_token: string; role: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
};
