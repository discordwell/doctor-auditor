import { describe, expect, it } from "vitest";
import { resolveCloudSyncConfig } from "./cloud-config";

describe("resolveCloudSyncConfig", () => {
  it("uses the hosted API by default", () => {
    const config = resolveCloudSyncConfig({
      env: {},
    });

    expect(config.apiBaseUrl).toBe("https://docaudit.discordwell.com/api");
    expect(config.apiBaseUrlSource).toBe("hosted_default");
  });

  it("accepts an explicit API base URL override", () => {
    const config = resolveCloudSyncConfig({
      env: {
        DOCTOR_AUDITOR_API_URL: "https://assist.discordwell.com/api/",
      },
    });

    expect(config.apiBaseUrl).toBe("https://assist.discordwell.com/api");
    expect(config.apiBaseUrlSource).toBe("environment_override");
  });

  it("appends /api when the override only specifies an origin", () => {
    const config = resolveCloudSyncConfig({
      env: {
        DOCTOR_AUDITOR_API_URL: "https://assist.discordwell.com",
      },
    });

    expect(config.apiBaseUrl).toBe("https://assist.discordwell.com/api");
  });

  it("rejects invalid override URLs", () => {
    expect(() =>
      resolveCloudSyncConfig({
        env: {
          DOCTOR_AUDITOR_API_URL: "not-a-url",
        },
      })
    ).toThrow("DOCTOR_AUDITOR_API_URL must be an absolute http:// or https:// URL.");
  });
});
