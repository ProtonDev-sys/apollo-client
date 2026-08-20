#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_MAX_ASAR_BYTES = 8 * 1024 * 1024;

function checkPackageBudget({
  projectRoot = path.resolve(__dirname, ".."),
  maxAsarBytes = Number(process.env.APOLLO_MAX_ASAR_BYTES) || DEFAULT_MAX_ASAR_BYTES
} = {}) {
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
  if (size > maxAsarBytes) {
    return {
      ok: false,
      asarPath,
      size,
      error: `Packaged app.asar exceeds the ${maxAsarBytes}-byte budget.`
    };
  }

  return { ok: true, asarPath, size, maxAsarBytes };
}

function run() {
  const result = checkPackageBudget();
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
  run
};
