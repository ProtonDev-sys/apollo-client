#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_BUDGETS = Object.freeze({
  mainBytes: 32 * 1024,
  preloadBytes: 12 * 1024,
  rendererBytes: 347000,
  packagedSourceBytes: 1200 * 1024
});
const ALLOWED_PRODUCTION_DEPENDENCIES = new Set(["discord-rpc"]);
const FORBIDDEN_PACKAGED_PATHS = Object.freeze([
  "src/desktop/listen-along-signaling.js",
  "src/desktop/runtime-assets.js",
  "src-tauri"
]);

function getFileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function walkFiles(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    return [];
  }

  return fs.readdirSync(directoryPath, { withFileTypes: true })
    .flatMap((entry) => {
      const resolvedPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        return walkFiles(resolvedPath);
      }
      return entry.isFile() ? [resolvedPath] : [];
    });
}

function calculatePackagedSourceBytes(projectRoot) {
  const rootFiles = [
    "main.js",
    "preload.js",
    "discord-presence.js",
    "discord-social-bridge.js",
    "package.json"
  ];
  return rootFiles.reduce(
    (total, relativePath) => total + getFileSize(path.join(projectRoot, relativePath)),
    0
  ) + walkFiles(path.join(projectRoot, "src"))
    .reduce((total, filePath) => total + getFileSize(filePath), 0);
}

function collectResourceBudgetErrors(projectRoot, budgets = DEFAULT_BUDGETS) {
  const errors = [];
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  const packageLock = JSON.parse(fs.readFileSync(path.join(projectRoot, "package-lock.json"), "utf8"));
  const dependencies = Object.keys(packageJson.dependencies || {});
  const lockedDependencies = Object.keys(packageLock.packages?.[""]?.dependencies || {});

  for (const dependencyName of dependencies) {
    if (!ALLOWED_PRODUCTION_DEPENDENCIES.has(dependencyName)) {
      errors.push(`Production dependency is outside the Electron resource allowlist: ${dependencyName}`);
    }
  }
  if (dependencies.includes("mqtt") || lockedDependencies.includes("mqtt") || packageLock.packages?.["node_modules/mqtt"]) {
    errors.push("The external MQTT package is not allowed; use the native WebSocket signaling adapter.");
  }

  if (packageJson.build?.asar === false) {
    errors.push("Electron packaging must keep ASAR enabled.");
  }
  if (packageJson.build?.compression !== "maximum") {
    errors.push('Electron Builder compression must be set to "maximum".');
  }

  const buildFiles = Array.isArray(packageJson.build?.files) ? packageJson.build.files : [];
  if (!buildFiles.includes("src/**/*")) {
    errors.push("Electron Builder must package the explicit src tree.");
  }
  if (buildFiles.some((entry) => ["**/*", "*"].includes(String(entry).trim()))) {
    errors.push("Electron Builder must not package the repository with an unrestricted wildcard.");
  }

  for (const relativePath of FORBIDDEN_PACKAGED_PATHS) {
    if (fs.existsSync(path.join(projectRoot, relativePath))) {
      errors.push(`Forbidden packaged path remains: ${relativePath}`);
    }
  }

  const measured = {
    mainBytes: getFileSize(path.join(projectRoot, "main.js")),
    preloadBytes: getFileSize(path.join(projectRoot, "preload.js")),
    rendererBytes: getFileSize(path.join(projectRoot, "src", "renderer.js")),
    packagedSourceBytes: calculatePackagedSourceBytes(projectRoot)
  };

  for (const [name, limit] of Object.entries(budgets)) {
    if (measured[name] > limit) {
      errors.push(`${name} exceeds its resource budget: ${measured[name]} > ${limit} bytes`);
    }
  }

  return { errors, measured };
}

function run(projectRoot = path.resolve(__dirname, "..")) {
  const result = collectResourceBudgetErrors(projectRoot);
  if (result.errors.length) {
    result.errors.forEach((error) => process.stderr.write(`error: ${error}\n`));
    process.exitCode = 1;
    return false;
  }

  process.stdout.write(
    `Electron resource budget verified: main=${result.measured.mainBytes}, `
      + `preload=${result.measured.preloadBytes}, renderer=${result.measured.rendererBytes}, `
      + `packaged-source=${result.measured.packagedSourceBytes} bytes.\n`
  );
  return true;
}

if (require.main === module) {
  run();
}

module.exports = {
  ALLOWED_PRODUCTION_DEPENDENCIES,
  DEFAULT_BUDGETS,
  FORBIDDEN_PACKAGED_PATHS,
  calculatePackagedSourceBytes,
  collectResourceBudgetErrors,
  run,
  walkFiles
};
