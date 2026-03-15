import { spawn } from "child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

async function runStep(args, options = {}) {
  const { allowFailure = false } = options;

  await new Promise((resolve, reject) => {
    const child = spawn(npmCommand, args, {
      cwd: process.cwd(),
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      if (code === 0 || allowFailure) {
        resolve();
        return;
      }

      reject(new Error(`Command failed: npm ${args.join(" ")}`));
    });
    child.on("error", reject);
  });
}

async function main() {
  let buildFailed = false;

  try {
    await runStep(["exec", "tsc", "--", "-p", "electron/tsconfig.json"]);
    await runStep(["exec", "vite", "--", "build"]);
    await runStep(["exec", "electron-builder", "--"]);
  } catch (error) {
    buildFailed = true;
    throw error;
  } finally {
    await runStep(["rebuild", "better-sqlite3"], { allowFailure: true });
  }

  if (buildFailed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
