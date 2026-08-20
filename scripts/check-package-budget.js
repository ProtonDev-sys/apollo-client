#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_MAX_ASAR_BYTES = 8 * 1024 * 1024;

function resolveMaxAsarBytes(value = process.env.APOLLO_MAX_ASAR_BYTES) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return DEFAULT_MAX_ASAR_BYTES;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new RangeError("The ASAR byte budget must be a finite positive number.");
  }
  return Math.trunc(parsed);
}

function checkPackageBudget({
  projectRoot = path.resolve(__dirname, ".."),
  maxAsarBytes
} = {}) {
  const resolvedMaxAsarBytes = resolveMaxAsarBytes(maxAsarBytes);
  const asarPath = path.join(projectRoot, "release", "linux-unpacked", "resources", "app.asar");
  if (!fs.existsSync(asarPath)) {
    return {
      ok: false,
      asarPath,
      size: 0,
      error: "Packaged app.asar is missing."
    };
  }

  const size = fs.statSync(asarPath).size;
  if (!size) {
    return {
      ok: false,
      asarPath,
      size,
      error: "Packaged app.asar is empty."
    };
  }
  if (size > resolvedMaxAsarBytes) {
    return {
      ok: false,
      asarPath,
      size,
      error: `Packaged app.asar exceeds the ${resolvedMaxAsarBytes}-byte budget.`
    };
  }

  return { ok: true, asarPath, size, maxAsarBytes: resolvedMaxAsarBytes };
}

function run() {
  let result;
  try {
    result = checkPackageBudget();
  } catch (error) {
    process.stderr.write(`error: ${error?.message || "Invalid ASAR byte budget."}
`);
    process.exitCode = 1;
    return false;
  }

  if (!result.ok) {
    process.stderr.write(`error: ${result.error} size=${result.size}\n`);
    process.exitCode = 1;
    return false;
  }

  process.stdout.write(`Packaged app.asar size verified: ${result.size} / ${result.maxAsarBytes} bytes.\n`);
  return true;
}

if (require.main === module) {
  run();
}

module.exports = {
  DEFAULT_MAX_ASAR_BYTES,
  checkPackageBudget,
  resolveMaxAsarBytes,
  run
};
