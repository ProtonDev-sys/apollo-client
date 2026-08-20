#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULT_MAX_PORTABLE_BYTES = 78_000_000;
const ARCHIVE_ARGUMENTS = Object.freeze([
  "a",
  "-t7z",
  "-mx=9",
  "-m0=lzma2",
  "-ms=on"
]);

function resolvePositiveLimit(value, fallback = DEFAULT_MAX_PORTABLE_BYTES) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new RangeError("The Windows portable byte budget must be a finite positive number.");
  }
  return Math.trunc(parsed);
}

function resolveSevenZip({
  env = process.env,
  fsImpl = fs,
  pathImpl = path
} = {}) {
  const candidates = [
    env.APOLLO_7ZIP_PATH,
    env.ProgramFiles ? pathImpl.join(env.ProgramFiles, "7-Zip", "7z.exe") : "",
    env["ProgramFiles(x86)"]
      ? pathImpl.join(env["ProgramFiles(x86)"], "7-Zip", "7z.exe")
      : ""
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (fsImpl.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // Continue to the next explicit candidate.
    }
  }

  return "7z.exe";
}

function buildWindowsPortable({
  projectRoot = path.resolve(__dirname, ".."),
  platform = process.platform,
  maxPortableBytes,
  sevenZipPath,
  fsImpl = fs,
  pathImpl = path,
  spawnSyncImpl = spawnSync,
  stdout = process.stdout,
  stderr = process.stderr
} = {}) {
  if (platform !== "win32") {
    throw new Error("The Windows portable archive can only be built on Windows.");
  }

  const packageJson = JSON.parse(
    fsImpl.readFileSync(pathImpl.join(projectRoot, "package.json"), "utf8")
  );
  const sourceDirectory = pathImpl.join(projectRoot, "release", "win-unpacked");
  const archivePath = pathImpl.join(
    projectRoot,
    "release",
    `Apollo-Client-Portable-${packageJson.version}.7z`
  );
  const resolvedLimit = resolvePositiveLimit(
    maxPortableBytes ?? process.env.APOLLO_MAX_PORTABLE_BYTES
  );

  if (!fsImpl.existsSync(sourceDirectory)) {
    throw new Error("The pruned win-unpacked runtime is missing.");
  }

  fsImpl.rmSync(archivePath, { force: true });
  const command = sevenZipPath || resolveSevenZip({
    env: process.env,
    fsImpl,
    pathImpl
  });
  const result = spawnSyncImpl(
    command,
    [...ARCHIVE_ARGUMENTS, archivePath, ".\\*"],
    {
      cwd: sourceDirectory,
      encoding: "utf8",
      stdio: "pipe",
      windowsHide: true
    }
  );

  if (result.stdout) {
    stdout.write(result.stdout);
  }
  if (result.stderr) {
    stderr.write(result.stderr);
  }
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`7-Zip exited with code ${result.status}.`);
  }
  if (!fsImpl.existsSync(archivePath)) {
    throw new Error("7-Zip did not create the portable archive.");
  }

  const size = fsImpl.statSync(archivePath).size;
  if (!size) {
    throw new Error("The Windows portable archive is empty.");
  }
  if (size > resolvedLimit) {
    throw new Error(
      `Windows portable archive exceeds the ${resolvedLimit}-byte budget: ${size} bytes.`
    );
  }

  stdout.write(
    `Windows portable archive verified: ${size} / ${resolvedLimit} bytes at ${archivePath}.\n`
  );
  return {
    archivePath,
    sourceDirectory,
    size,
    maxPortableBytes: resolvedLimit
  };
}

function run() {
  try {
    buildWindowsPortable();
    return true;
  } catch (error) {
    process.stderr.write(`error: ${error?.message || error}\n`);
    process.exitCode = 1;
    return false;
  }
}

if (require.main === module) {
  run();
}

module.exports = {
  ARCHIVE_ARGUMENTS,
  DEFAULT_MAX_PORTABLE_BYTES,
  buildWindowsPortable,
  resolvePositiveLimit,
  resolveSevenZip,
  run
};
