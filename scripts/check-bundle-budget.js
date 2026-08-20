#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_MAX_BUNDLE_BYTES = 512 * 1024;
const REQUIRED_BUNDLE_FILES = Object.freeze([
  "main.js",
  "preload.js",
  "discord-presence.js",
  "discord-social-bridge.js",
  "src/index.html",
  "src/renderer.js",
  "src/styles.css",
  "src/listen-along-p2p.js",
  "src/main/async-log-writer.js",
  "src/main/discord-ipc.js",
  "src/preload/listen-along-signaling.js",
  "src/preload/mqtt-websocket.js",
  "src/preload/runtime-assets.js",
  "src/preload/state-store.js"
]);

function walkFiles(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    return [];
  }
  return fs.readdirSync(directoryPath, { withFileTypes: true })
    .flatMap((entry) => {
      const resolved = path.join(directoryPath, entry.name);
      return entry.isDirectory() ? walkFiles(resolved) : [resolved];
    });
}

function resolveMaximum(value = process.env.APOLLO_MAX_BUNDLE_BYTES) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return DEFAULT_MAX_BUNDLE_BYTES;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new RangeError("The runtime bundle byte budget must be a finite positive number.");
  }
  return Math.trunc(parsed);
}

function checkBundleBudget({
  projectRoot = path.resolve(__dirname, ".."),
  maxBundleBytes
} = {}) {
  const outputRoot = path.join(projectRoot, "dist-app");
  const maximum = resolveMaximum(maxBundleBytes);
  const errors = [];

  for (const relativePath of REQUIRED_BUNDLE_FILES) {
    const target = path.join(outputRoot, relativePath);
    if (!fs.existsSync(target) || !fs.statSync(target).isFile() || fs.statSync(target).size === 0) {
      errors.push(`Required runtime bundle file is missing or empty: ${relativePath}`);
    }
  }

  const files = walkFiles(outputRoot);
  const totalBytes = files.reduce((total, filePath) => total + fs.statSync(filePath).size, 0);
  if (totalBytes > maximum) {
    errors.push(`Runtime bundle exceeds its byte budget: ${totalBytes} > ${maximum}`);
  }
  if (files.some((filePath) => filePath.endsWith(".map"))) {
    errors.push("Production runtime bundle must not contain source maps.");
  }
  if (files.some((filePath) => filePath.includes(`${path.sep}node_modules${path.sep}`))) {
    errors.push("Production runtime bundle must not contain node_modules.");
  }

  const htmlPath = path.join(outputRoot, "src", "index.html");
  if (fs.existsSync(htmlPath)) {
    const html = fs.readFileSync(htmlPath, "utf8");
    if (/fonts\.(?:googleapis|gstatic)\.com/i.test(html)) {
      errors.push("Production HTML must not request remote font resources.");
    }
  }

  return {
    errors,
    files: files.length,
    totalBytes,
    maxBundleBytes: maximum
  };
}

function run() {
  let result;
  try {
    result = checkBundleBudget();
  } catch (error) {
    process.stderr.write(`error: ${error?.message || "Invalid runtime bundle budget."}\n`);
    process.exitCode = 1;
    return false;
  }

  if (result.errors.length) {
    result.errors.forEach((error) => process.stderr.write(`error: ${error}\n`));
    process.exitCode = 1;
    return false;
  }

  process.stdout.write(
    `Electron runtime bundle verified: ${result.totalBytes} / ${result.maxBundleBytes} bytes across ${result.files} files.\n`
  );
  return true;
}

if (require.main === module) {
  run();
}

module.exports = {
  DEFAULT_MAX_BUNDLE_BYTES,
  REQUIRED_BUNDLE_FILES,
  checkBundleBudget,
  resolveMaximum,
  run,
  walkFiles
};
