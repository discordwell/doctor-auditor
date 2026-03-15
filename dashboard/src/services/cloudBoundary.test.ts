import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("dashboard contract boundary", () => {
  it("does not import the local-review shared surface", () => {
    const files = collectSourceFiles(SRC_ROOT);
    const offenders = files.filter((filePath) =>
      readFileSync(filePath, "utf8").includes("@doctor-auditor/shared/local-review")
    );

    expect(offenders).toEqual([]);
  });
});

function collectSourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const fullPath = path.join(root, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      return collectSourceFiles(fullPath);
    }

    if (!fullPath.endsWith(".ts") && !fullPath.endsWith(".tsx")) {
      return [];
    }

    if (fullPath.endsWith(".test.ts") || fullPath.endsWith(".test.tsx")) {
      return [];
    }

    return [fullPath];
  });
}
