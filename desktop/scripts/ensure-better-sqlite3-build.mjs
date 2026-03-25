import { createRequire } from "node:module";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";

const require = createRequire(import.meta.url);

const runtime = process.argv[2];

if (runtime !== "node" && runtime !== "electron") {
  console.error(
    'Usage: node scripts/ensure-better-sqlite3-build.mjs <node|electron>'
  );
  process.exit(1);
}

const betterSqlitePackagePath = require.resolve("better-sqlite3/package.json");
const betterSqlitePackage = require(betterSqlitePackagePath);
const betterSqliteRoot = dirname(betterSqlitePackagePath);
const nodeGypPath = require.resolve("node-gyp/bin/node-gyp.js");
const electronPackage =
  runtime === "electron" ? require("electron/package.json") : null;
const targetVersion =
  runtime === "electron" ? electronPackage.version : process.versions.node;
const markerPath = join(betterSqliteRoot, ".doctor-auditor-target.json");
const buildReleasePath = join(betterSqliteRoot, "build", "Release");
const binaryFileNames = ["better_sqlite3.node", "test_extension.node"];
const binaryPath = join(buildReleasePath, binaryFileNames[0]);
const cacheKey = [
  runtime,
  targetVersion,
  process.platform,
  process.arch,
  betterSqlitePackage.version,
].join("-");
const cachePath = join(
  betterSqliteRoot,
  ".doctor-auditor-cache",
  cacheKey
);
const desiredBuild = {
  runtime,
  targetVersion,
  platform: process.platform,
  arch: process.arch,
  betterSqlite3Version: betterSqlitePackage.version,
};

if (await canSkipRebuild(markerPath, binaryPath, desiredBuild)) {
  console.log(
    `better-sqlite3 already built for ${runtime} ${targetVersion} (${process.platform}-${process.arch}).`
  );
  process.exit(0);
}

if (await restoreCachedBuild(cachePath, buildReleasePath, binaryFileNames)) {
  await mkdir(dirname(markerPath), { recursive: true });
  await writeFile(markerPath, JSON.stringify(desiredBuild, null, 2) + "\n");
  console.log(
    `Restored cached better-sqlite3 build for ${runtime} ${targetVersion} (${process.platform}-${process.arch}).`
  );
  process.exit(0);
}

console.log(
  `Rebuilding better-sqlite3 for ${runtime} ${targetVersion} (${process.platform}-${process.arch})...`
);

const nodeGypArgs = [nodeGypPath, "rebuild", "--release"];

if (runtime === "electron") {
  nodeGypArgs.push(
    "--runtime=electron",
    `--target=${targetVersion}`,
    "--dist-url=https://electronjs.org/headers"
  );
}

await runCommand(process.execPath, nodeGypArgs, betterSqliteRoot);

await cacheBuildArtifacts(cachePath, buildReleasePath, binaryFileNames);
await mkdir(dirname(markerPath), { recursive: true });
await writeFile(markerPath, JSON.stringify(desiredBuild, null, 2) + "\n");

console.log(`better-sqlite3 ready for ${runtime} ${targetVersion}.`);

async function canSkipRebuild(markerFile, nativeBinary, nextBuild) {
  try {
    await access(nativeBinary);
    const currentMarker = JSON.parse(await readFile(markerFile, "utf8"));

    return (
      currentMarker.runtime === nextBuild.runtime &&
      currentMarker.targetVersion === nextBuild.targetVersion &&
      currentMarker.platform === nextBuild.platform &&
      currentMarker.arch === nextBuild.arch &&
      currentMarker.betterSqlite3Version === nextBuild.betterSqlite3Version
    );
  } catch {
    return false;
  }
}

async function restoreCachedBuild(cacheDir, releaseDir, fileNames) {
  try {
    await access(join(cacheDir, fileNames[0]));
  } catch {
    return false;
  }

  await mkdir(releaseDir, { recursive: true });

  for (const fileName of fileNames) {
    const cachedFile = join(cacheDir, fileName);

    try {
      await access(cachedFile);
      await copyFile(cachedFile, join(releaseDir, fileName));
    } catch {
      // Optional artifacts such as test_extension.node may not exist.
    }
  }

  return true;
}

async function cacheBuildArtifacts(cacheDir, releaseDir, fileNames) {
  await mkdir(cacheDir, { recursive: true });

  for (const fileName of fileNames) {
    const sourceFile = join(releaseDir, fileName);

    try {
      await access(sourceFile);
      await copyFile(sourceFile, join(cacheDir, fileName));
    } catch {
      // Optional artifacts such as test_extension.node may not exist.
    }
  }
}

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Command failed with exit code ${code ?? "unknown"}.`));
    });
  });
}
