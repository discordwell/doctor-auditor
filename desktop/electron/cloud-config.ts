export type CloudSyncConfigSource = "environment_override" | "hosted_default";

export interface CloudSyncConfig {
  apiBaseUrl: string;
  apiBaseUrlSource: CloudSyncConfigSource;
  email: string;
  password: string;
  role: string;
  organizationId: string;
}

export interface CloudSyncDisplayConfig {
  apiBaseUrl: string;
  apiBaseUrlSource: CloudSyncConfigSource;
  email: string;
  role: string;
  organizationId: string;
}

interface ResolveCloudSyncConfigOptions {
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_API_ORIGIN = "https://docaudit.discordwell.com";

export function resolveCloudSyncConfig({
  env = process.env,
}: ResolveCloudSyncConfigOptions): CloudSyncConfig {
  const configuredApiUrl = env.DOCTOR_AUDITOR_API_URL?.trim();
  const apiBaseUrlSource: CloudSyncConfigSource = configuredApiUrl
    ? "environment_override"
    : "hosted_default";

  return {
    apiBaseUrl: normalizeApiBaseUrl(configuredApiUrl ?? DEFAULT_API_ORIGIN),
    apiBaseUrlSource,
    email: env.DOCTOR_AUDITOR_API_EMAIL ?? "reviewer@demo-health.local",
    password: env.DOCTOR_AUDITOR_API_PASSWORD ?? "demo-reviewer",
    role: env.DOCTOR_AUDITOR_API_ROLE ?? "reviewer",
    organizationId: env.DOCTOR_AUDITOR_API_ORG ?? "demo-health",
  };
}

export function toCloudSyncDisplayConfig(
  config: CloudSyncConfig
): CloudSyncDisplayConfig {
  return {
    apiBaseUrl: config.apiBaseUrl,
    apiBaseUrlSource: config.apiBaseUrlSource,
    email: config.email,
    role: config.role,
    organizationId: config.organizationId,
  };
}

function normalizeApiBaseUrl(rawUrl: string): string {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error(
      "DOCTOR_AUDITOR_API_URL must be an absolute http:// or https:// URL."
    );
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(
      "DOCTOR_AUDITOR_API_URL must use the http or https scheme."
    );
  }

  parsedUrl.search = "";
  parsedUrl.hash = "";

  const pathname = parsedUrl.pathname.replace(/\/+$/g, "");
  parsedUrl.pathname =
    pathname === "" || pathname === "/" ? "/api" : pathname;

  return parsedUrl.toString().replace(/\/$/, "");
}
