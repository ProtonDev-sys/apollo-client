#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const {
  PRUNED_RUNTIME_FILES,
  resolveElectronPlatform
} = require("./prune-electron-runtime");

const DEFAULT_MAX_ASAR_BYTES = 1024 * 1024;
const DEFAULT_MAX_UNPACKED_BYTES = Object.freeze({
  linux: 275_000_000,
  win32: 295_000_000
});
const PACKAGE_DIRECTORIES = Object.freeze({
  linux: "linux-unpacked",
  win32: "win-unpacked"
});

function resolvePositiveLimit(value, fallback, label) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new RangeError(`${label} must be a finite positive number.`);
  }
  return Math.trunc(parsed);
}

function resolveMaxAsarBytes(value = process.env.APOLLO_MAX_ASAR_BYTES) {
  return resolvePositiveLimit(value, DEFAULT_MAX_ASAR_BYTES, "The ASAR byte budget");
}

function resolvePackagePlatform(projectRoot, value = process.env.APOLLO_PACKAGE_PLATFORM) {
  const requestedPlatform = resolveElectronPlatform(value);
  if (PACKAGE_DIRECTORIES[requestedPlatform]) {
    return requestedPlatform;
  }

  const preferredPlatforms = process.platform === "win32"
    ? ["win32", "linux"]
    : ["linux", "win32"];
  for (const platform of preferredPlatforms) {
    if (fs.existsSync(path.join(projectRoot, "release", PACKAGE_DIRECTORIES[platform]))) {
      return platform;
    }
  }

  return PACKAGE_DIRECTORIES[process.platform] ? process.platform : "linux";
}

function sumDirectoryBytes(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    return 0;
  }

  return fs.readdirSync(directoryPath, { withFileTypes: true })
    .reduce((total, entry) => {
      const resolvedPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        return total + sumDirectoryBytes(resolvedPath);
      }
      return total + (entry.isFile() ? fs.statSync(resolvedPath).size : 0);
    }, 0);
}

function checkPackageBudget({
  projectRoot = path.resolve(__dirname, ".."),
  maxAsarBytes,
  maxUnpackedBytes,
  packagePlatform
} = {}) {
  const platform = resolvePackagePlatform(projectRoot, packagePlatform);
  const resolvedMaxAsarBytes = resolveMaxAsarBytes(maxAsarBytes);
  const resolvedMaxUnpackedBytes = resolvePositiveLimit(
    maxUnpackedBytes ?? process.env.APOLLO_MAX_UNPACKED_BYTES,
    DEFAULT_MAX_UNPACKED_BYTES[platform],
    "The unpacked Electron runtime byte budget"
  );
  const packageDirectory = path.join(
    projectRoot,
    "release",
    PACKAGE_DIRECTORIES[platform]
  );
  const asarPath = path.join(packageDirectory, "resources", "app.asar");
  const errors = [];

  if (!fs.existsSync(packageDirectory)) {
    errors.push(`Packaged ${platform} Electron runtime is missing.`);
  }

  let asarSize = 0;
  if (!fs.existsSync(asarPath)) {
    errors.push("Packaged app.asar is missing.");
  } else {
    asarSize = fs.statSync(asarPath).size;
    if (!asarSize) {
      errors.push("Packaged app.asar is empty.");
    } else if (asarSize > resolvedMaxAsarBytes) {
      errors.push(`Packaged app.asar exceeds the ${resolvedMaxAsarBytes}-byte budget.`);
    }
  }

  const unpackedSize = sumDirectoryBytes(packageDirectory);
  if (unpackedSize > resolvedMaxUnpackedBytes) {
    errors.push(
      `Packaged ${platform} Electron runtime exceeds the `
        + `${resolvedMaxUnpackedBytes}-byte budget.`
    );
  }

  const remainingPrunableFiles = (PRUNED_RUNTIME_FILES[platform] || [])
    .filter((relativePath) => fs.existsSync(path.join(packageDirectory, relativePath)));
  if (remainingPrunableFiles.length) {
    errors.push(
      `Unused Electron graphics files remain: ${remainingPrunableFiles.join(", ")}`
    );
  }

  return {
    ok: errors.length === 0,
    error: errors.join(" "),
    errors,
    platform,
    packageDirectory,
    asarPath,
    asarSize,
    unpackedSize,
    maxAsarBytes: resolvedMaxAsarBytes,
    maxUnpackedBytes: resolvedMaxUnpackedBytes,
    remainingPrunableFiles
  };
}

function run() {
  let result;
  try {
    result = checkPackageBudget();
  } catch (error) {
    process.stderr.write(`error: ${error?.message || "Invalid package byte budget."}\n`);
    process.exitCode = 1;
    return false;
  }

  if (!result.ok) {
    result.errors.forEach((error) => process.stderr.write(`error: ${error}\n`));
    process.exitCode = 1;
    return false;
  }

  process.stdout.write(
    `Packaged Electron runtime verified: platform=${result.platform}, `
      + `app.asar=${result.asarSize}/${result.maxAsarBytes}, `
      + `unpacked=${result.unpackedSize}/${result.maxUnpackedBytes} bytes.\n`
  );
  return true;
}

if (require.main === module) {
  run();
}

module.exports = {
  DEFAULT_MAX_ASAR_BYTES,
  DEFAULT_MAX_UNPACKED_BYTES,
  PACKAGE_DIRECTORIES,
  checkPackageBudget,
  resolveMaxAsarBytes,
  resolvePackagePlatform,
  resolvePositiveLimit,
  run,
  sumDirectoryBytes
};
